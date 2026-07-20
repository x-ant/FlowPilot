import { Button } from "antd"
import { useEffect, useMemo, useState } from "react"

import {
  fetchDuckEmail,
  type FetchDuckEmailOptions
} from "../../background/integrations/duck-email"
import { REGISTER_STEP_COUNT } from "../../background/register/batch-runner"
import {
  clickRegisterAndSubmitEmail,
  clickRegisterReadyContinue,
  completeRegisterOAuthLogin,
  completeRegisterPhoneVerification,
  fetchAndSubmitRegisterVerificationCode,
  openChatGptRegisterEntry,
  prepareRegisterAccountEmail,
  refreshRegisterOAuthAndLogin,
  submitRegisterOAuthCallback,
  submitRegisterProfile
} from "../../background/register/steps"
import {
  buildAccountInvalidLastMessage,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  matchesManagedAccountVisibilityFilter,
  type AccountVisibilityFilter,
  type ManagedAccountProgress,
  type ManagedAccountStatus
} from "../../shared/account-state"
import type { CodexRegisterStepResponse } from "../../shared/flow-contracts"
import {
  REGISTER_ACCOUNT_FORM_DRAFT_STORAGE_KEY,
  REGISTER_STORAGE_KEYS
} from "../../shared/storage-keys"
import {
  createOAuthIntegrationConfig,
  hasRequiredOAuthIntegrationConfig,
  type OAuthBinding
} from "../../shared/sub2api"
import {
  AccountFormPanel,
  AccountListPanel,
  useAccountPageState
} from "../account-management"
import { OAuthConfigPanel, useOAuthTargetConfig } from "../cpa-config"
import { HeroSmsConfigPanel, useHeroSmsConfig } from "../hero-sms-config"
import { RegisterDebugPanel, type RegisterDebugStep } from "../register-debug"
import {
  RegisterAutomationPanel,
  RegisterOrphanRunLockAlert,
  RegisterStopStrategyModal,
  useRegisterTaskControl,
  validateRegisterBatchStart
} from "../register-task"
import type { PageProps } from "./types"

const REGISTER_PHONE_MAX_OAUTH_ATTEMPTS = 3
const REGISTER_FLOW_STEPS = {
  1: {
    label: "1 打开 GPT 页面"
  },
  2: {
    label: "2 点击注册并提交邮箱"
  },
  3: {
    label: "3 提交验证码"
  },
  4: {
    label: "4 填写名称年龄并继续"
  },
  5: {
    label: "5 完成 OAuth 登录"
  },
  6: {
    label: "6 手机号验证"
  },
  7: {
    label: "7 提交 OAuth callback"
  }
}

type RegisterDebugStepOptions = {
  step: number
  runningStatus: string
  runningMessage: string
  runningProgress: ManagedAccountProgress
  action: (tabId: number) => Promise<CodexRegisterStepResponse>
  failureStatus: string
  successStatus: string
  successProgress: ManagedAccountProgress
  successAccountStatus: ManagedAccountStatus
  exceptionStatus: string
  exceptionMessage: string
  beforeRun?: () => void
}

const closeTabQuietly = async (tabId?: number) => {
  if (typeof tabId !== "number") {
    return false
  }

  try {
    await chrome.tabs.remove(tabId)
    return true
  } catch {
    return false
  }
}

export function CodexRegisterPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: REGISTER_STORAGE_KEYS,
    log,
    setStatus,
    requireEmailGenerator: true,
    stepCount: REGISTER_STEP_COUNT
  })
  const {
    accounts,
    cpaManagementKey,
    cpaUrl,
    selectedEmails,
    selectedCount,
    syncAccounts,
    patchAccountState,
    setRunningEmail
  } = accountPage
  const oauthTarget = useOAuthTargetConfig("register")
  const integration = useMemo(() => {
    return createOAuthIntegrationConfig(
      oauthTarget.settings,
      cpaUrl,
      cpaManagementKey
    )
  }, [cpaManagementKey, cpaUrl, oauthTarget.settings])
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [debugEmail, setDebugEmail] = useState("")
  const [debugAccountFilter, setDebugAccountFilter] =
    useState<AccountVisibilityFilter>("pending")
  const [debugRegisterTabId, setDebugRegisterTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState(0)
  const [debugRunningStep, setDebugRunningStep] = useState(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [debugOAuthStartedAt, setDebugOAuthStartedAt] = useState(0)
  const [debugOAuthBinding, setDebugOAuthBinding] =
    useState<OAuthBinding | null>(null)
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const heroSms = useHeroSmsConfig({ log, setStatus })
  const registerTask = useRegisterTaskControl({
    log,
    setStatus,
    setRunningEmail
  })
  const {
    alarmConfig,
    setAlarmConfig,
    appliedAlarmConfig,
    registerRunLock,
    isBatchRunning,
    hasOrphanRegisterRunLock,
    isClearingRunLock,
    isAlarmSaving,
    isAlarmTesting,
    isBatchStopping,
    isStopStrategyModalOpen
  } = registerTask

  const filteredDebugAccounts = useMemo(() => {
    return accounts.filter((account) => {
      return matchesManagedAccountVisibilityFilter(
        account,
        debugAccountFilter,
        REGISTER_STEP_COUNT
      )
    })
  }, [accounts, debugAccountFilter])

  const selectedDebugAccount = useMemo(() => {
    return (
      filteredDebugAccounts.find((account) => {
        return getManagedAccountKey(account) === debugEmail
      }) || null
    )
  }, [debugEmail, filteredDebugAccounts])
  useEffect(() => {
    if (filteredDebugAccounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugAccountId = debugEmail
    const hasCurrentDebugAccount = filteredDebugAccounts.some((account) => {
      return getManagedAccountKey(account) === currentDebugAccountId
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(getManagedAccountKey(filteredDebugAccounts[0]))
    }
  }, [debugEmail, filteredDebugAccounts])

  useEffect(() => {
    onBusyChange?.(isBatchRunning || isDebugRunning)
    return () => {
      onBusyChange?.(false)
    }
  }, [isBatchRunning, isDebugRunning, onBusyChange])

  const handleOpenRegisterEntry = async () => {
    if (isBatchRunning || isDebugRunning) {
      return
    }

    setIsDebugRunning(true)
    setDebugRunningStep(1)
    setStatus("正在打开 GPT 页面")
    log.info("[注册调试] Step 1 开始打开 GPT 页面")

    try {
      const result = await openChatGptRegisterEntry()
      if (!result.ok) {
        setStatus("打开 GPT 页面失败")
        log.warn(`[注册调试] ${result.message}`)
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || ""))
      setDebugProgress(1)
      setStatus("已打开 GPT 页面")
      log.info(
        `[注册调试] Step 1 ${result.message}；tab=${result.targetTab?.id || "unknown"}；url=${
          result.targetTab?.url || "unknown"
        }`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "打开 GPT 页面异常"
      setStatus("打开 GPT 页面异常")
      log.warn(`[注册调试] ${message}`)
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
    }
  }

  const handleUseActiveTabAsDebugRegisterTab = async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (!activeTab?.id) {
      setStatus("未找到当前激活标签页")
      log.warn("未找到当前激活标签页，无法设置注册 tab")
      return
    }

    setDebugRegisterTabId(String(activeTab.id))
    setStatus(`已使用当前标签页作为注册 tab：${activeTab.id}`)
    log.debug(
      `注册调试 tab 已设置为 ${activeTab.id}（${activeTab.url || "unknown"}）`
    )
  }

  const handleClearDebugState = () => {
    setDebugRegisterTabId("")
    setDebugProgress(0)
    setDebugRunningStep(0)
    setDebugVerificationRequestedAt(0)
    setDebugOAuthStartedAt(0)
    setDebugOAuthBinding(null)
    setDebugCallbackUrl("")
    setStatus("注册调试状态已清空")
  }

  const handleDebugAccountChange = (accountId: string) => {
    setDebugEmail(accountId)
    setDebugProgress(0)
    setDebugRunningStep(0)
    setDebugVerificationRequestedAt(0)
    setDebugOAuthStartedAt(0)
    setDebugOAuthBinding(null)
    setDebugCallbackUrl("")
  }

  const runRegisterDebugStep = async (options: RegisterDebugStepOptions) => {
    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    if (!Number.isFinite(parsedTabId) || parsedTabId <= 0) {
      setStatus("请先执行 Step 1 打开 GPT 页面")
      log.warn(
        `[注册调试] Step ${options.step} 缺少注册 tabId，请先执行 Step 1`
      )
      return
    }

    const accountKey = getManagedAccountKey(selectedDebugAccount)
    const accountLabel = getManagedAccountDisplayLabel(selectedDebugAccount)
    setIsDebugRunning(true)
    setDebugRunningStep(options.step)
    setDebugProgress((current) => {
      return Math.max(current, options.runningProgress)
    })
    setRunningEmail(accountKey)
    setStatus(options.runningStatus)
    log.info(`[注册调试][${accountLabel}] Step ${options.step} 开始`)
    options.beforeRun?.()
    patchAccountState(accountKey, {
      progress: options.runningProgress,
      status: "running",
      lastMessage: options.runningMessage
    })

    try {
      const result = await options.action(parsedTabId)

      if (!result.ok) {
        if (result.accountInvalid) {
          setStatus("账号已失效")
          log.warn(`[注册调试][${accountLabel}] ${result.message}`)
          patchAccountState(accountKey, {
            status: "invalid",
            lastMessage: buildAccountInvalidLastMessage(result.message)
          })
          return
        }

        setStatus(options.failureStatus)
        log.warn(`[注册调试][${accountLabel}] ${result.message}`)
        patchAccountState(accountKey, {
          status: "failed",
          lastMessage: result.message
        })
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || parsedTabId))
      setDebugProgress(options.successProgress)
      setStatus(options.successStatus)
      log.info(
        `[注册调试][${accountLabel}] Step ${options.step} ${result.message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(accountKey, {
        progress: options.successProgress,
        status: options.successAccountStatus,
        lastMessage: result.message
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : options.exceptionMessage
      setStatus(options.exceptionStatus)
      log.warn(`[注册调试][${accountLabel}] ${message}`)
      patchAccountState(accountKey, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
      setRunningEmail("")
    }
  }

  const handleSubmitRegisterEmail = async () => {
    const verificationRequestedAt = Date.now()
    const accountLabel = selectedDebugAccount
      ? getManagedAccountDisplayLabel(selectedDebugAccount)
      : ""
    await runRegisterDebugStep({
      step: 2,
      runningStatus: `正在提交注册邮箱 ${accountLabel}`,
      runningMessage: "正在点击注册并提交邮箱",
      runningProgress: 1,
      beforeRun: () => {
        setDebugVerificationRequestedAt(verificationRequestedAt)
      },
      action: async (tabId) => {
        if (!selectedDebugAccount) {
          return {
            ok: false,
            message: "未选择账号"
          }
        }
        const preparedResult =
          await prepareRegisterAccountEmail(selectedDebugAccount)
        if (!preparedResult.ok || !preparedResult.account?.email) {
          return preparedResult
        }
        patchAccountState(getManagedAccountKey(selectedDebugAccount), {
          mailProvider: preparedResult.account.mailProvider,
          emailGenerator: preparedResult.account.emailGenerator,
          email: preparedResult.account.email,
          mailboxEmail: preparedResult.account.mailboxEmail,
          password: preparedResult.account.password,
          lastMessage: preparedResult.message
        })
        const submitResult = await clickRegisterAndSubmitEmail(
          preparedResult.account.email,
          preparedResult.account.password,
          tabId
        )
        if (submitResult.verificationRequestedAt) {
          setDebugVerificationRequestedAt(submitResult.verificationRequestedAt)
        }
        return submitResult
      },
      failureStatus: "提交注册邮箱失败",
      successStatus: "已提交注册邮箱",
      successProgress: 2,
      successAccountStatus: "running",
      exceptionStatus: "提交注册邮箱异常",
      exceptionMessage: "提交注册邮箱异常"
    })
  }

  const handleSubmitRegisterVerificationCode = async () => {
    const accountLabel = selectedDebugAccount
      ? getManagedAccountDisplayLabel(selectedDebugAccount)
      : ""
    await runRegisterDebugStep({
      step: 3,
      runningStatus: `正在读取并提交验证码 ${accountLabel}`,
      runningMessage: "正在读取并提交验证码",
      runningProgress: 2,
      action: (tabId) => {
        if (!selectedDebugAccount) {
          return Promise.resolve({
            ok: false,
            message: "未选择账号"
          })
        }
        return fetchAndSubmitRegisterVerificationCode(
          tabId,
          selectedDebugAccount,
          debugVerificationRequestedAt
        )
      },
      failureStatus: "提交注册验证码失败",
      successStatus: "已提交注册验证码",
      successProgress: 3,
      successAccountStatus: "running",
      exceptionStatus: "提交注册验证码异常",
      exceptionMessage: "提交注册验证码异常"
    })
  }

  const handleSubmitRegisterProfile = async () => {
    await runRegisterDebugStep({
      step: 4,
      runningStatus: "正在填写名称年龄并继续",
      runningMessage: "正在填写名称和年龄/生日并点击继续",
      runningProgress: 3,
      action: async (tabId) => {
        const profileResult = await submitRegisterProfile(tabId)
        if (!profileResult.ok) {
          return profileResult
        }

        const continueResult = await clickRegisterReadyContinue(tabId)
        return {
          ok: continueResult.ok,
          message: `${profileResult.message}；${continueResult.message}`,
          targetTab: continueResult.targetTab || profileResult.targetTab
        }
      },
      failureStatus: "填写名称年龄失败",
      successStatus: "已填写名称年龄并点击继续",
      successProgress: 4,
      successAccountStatus: "running",
      exceptionStatus: "填写名称年龄异常",
      exceptionMessage: "填写名称年龄异常"
    })
  }

  const handleCompleteRegisterOAuthLogin = async () => {
    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    if (!hasRequiredOAuthIntegrationConfig(integration)) {
      setStatus("请先完善 OAuth 接入配置")
      log.warn("[注册调试] Step 5 OAuth 接入配置不完整")
      return
    }

    const accountKey = getManagedAccountKey(selectedDebugAccount)
    const accountLabel = getManagedAccountDisplayLabel(selectedDebugAccount)
    setIsDebugRunning(true)
    setDebugRunningStep(5)
    setDebugProgress((current) => Math.max(current, 4))
    setRunningEmail(accountKey)
    setDebugOAuthBinding(null)
    setDebugCallbackUrl("")
    setStatus("正在完成 OAuth 登录")
    log.info(`[注册调试][${accountLabel}] Step 5 开始`)
    patchAccountState(accountKey, {
      progress: 4,
      status: "running",
      lastMessage: "正在刷新 OAuth 并选择账号卡片"
    })

    try {
      const refreshResult = await refreshRegisterOAuthAndLogin(integration)
      if (
        !refreshResult.ok ||
        typeof refreshResult.targetTab?.id !== "number"
      ) {
        setStatus("OAuth 登录失败")
        log.warn(`[注册调试][${accountLabel}] ${refreshResult.message}`)
        patchAccountState(accountKey, {
          status: "failed",
          lastMessage: refreshResult.message
        })
        return
      }

      const result = await completeRegisterOAuthLogin(
        refreshResult.targetTab.id,
        selectedDebugAccount,
        integration,
        (message) => {
          log.info(`[注册调试][${accountLabel}] ${message}`)
        }
      )
      const message = `${refreshResult.message}；${result.message}`

      if (!result.ok) {
        setStatus("OAuth 登录失败")
        log.warn(`[注册调试][${accountLabel}] ${message}`)
        patchAccountState(accountKey, {
          status: "failed",
          lastMessage: message
        })
        return
      }

      setDebugRegisterTabId(
        String(result.targetTab?.id || refreshResult.targetTab.id)
      )
      setDebugOAuthStartedAt(
        result.oauthStartedAt || refreshResult.oauthStartedAt || Date.now()
      )
      setDebugOAuthBinding(
        result.oauthBinding || refreshResult.oauthBinding || null
      )
      setDebugCallbackUrl("")
      setDebugProgress(5)
      setStatus("已完成 OAuth 登录")
      log.info(
        `[注册调试][${accountLabel}] Step 5 ${message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(accountKey, {
        progress: 5,
        status: "running",
        lastMessage: message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth 登录异常"
      setStatus("OAuth 登录异常")
      log.warn(`[注册调试][${accountLabel}] ${message}`)
      patchAccountState(accountKey, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
      setRunningEmail("")
    }
  }

  const handleCompleteRegisterPhoneVerification = async () => {
    const heroSmsOptions = heroSms.buildOptions()
    if (!heroSmsOptions) {
      return
    }

    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    if (!Number.isFinite(parsedTabId) || parsedTabId <= 0) {
      setStatus("请先执行 Step 5 完成 OAuth 登录")
      log.warn("[注册调试] Step 6 缺少注册 tabId，请先执行 Step 5")
      return
    }

    const accountKey = getManagedAccountKey(selectedDebugAccount)
    const accountLabel = getManagedAccountDisplayLabel(selectedDebugAccount)
    setIsDebugRunning(true)
    setDebugRunningStep(6)
    setDebugProgress((current) => Math.max(current, 5))
    setRunningEmail(accountKey)
    setStatus("正在执行手机号验证")
    log.info(`[注册调试][${accountLabel}] Step 6 开始`)
    patchAccountState(accountKey, {
      progress: 5,
      status: "running",
      lastMessage: "正在获取手机号并等待短信验证码"
    })

    try {
      let tabId = parsedTabId
      let oauthStartedAt = debugOAuthStartedAt || Date.now()
      let oauthAttemptCount = 1

      while (true) {
        const result = await completeRegisterPhoneVerification(
          tabId,
          heroSmsOptions,
          oauthStartedAt
        )

        if (result.ok) {
          setDebugRegisterTabId(String(result.targetTab?.id || tabId))
          setDebugCallbackUrl(result.callbackUrl || result.targetTab?.url || "")
          setDebugProgress(6)
          setStatus("已完成手机号验证")
          log.info(
            `[注册调试][${accountLabel}] Step 6 ${
              result.message
            }；tab=${result.targetTab?.id || "unknown"}；url=${
              result.targetTab?.url || "unknown"
            }`
          )
          patchAccountState(accountKey, {
            progress: 6,
            status: "running",
            lastMessage: result.message
          })
          return
        }

        if (!result.needRefreshOAuth) {
          if (result.needsManualReview) {
            setStatus("手机号验证结果需要人工判断")
            log.warn(`[注册调试][${accountLabel}] ${result.message}`)
            patchAccountState(accountKey, {
              progress: 6,
              status: "needs_review",
              lastMessage: `${result.message}；手机号验证码已经提交但跳转结果无法判断，为避免重复浪费手机号，请人工检查`
            })
            return
          }

          setStatus("手机号验证失败")
          log.warn(`[注册调试][${accountLabel}] ${result.message}`)
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: result.message
          })
          return
        }

        if (oauthAttemptCount >= REGISTER_PHONE_MAX_OAUTH_ATTEMPTS) {
          const closedAuthTab = await closeTabQuietly(tabId)
          const message = `${result.message}；已达到 OAuth URL 获取上限 ${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS} 次；${
            closedAuthTab
              ? "已关闭当前 OAuth 页面"
              : "当前 OAuth 页面未关闭或已不存在"
          }`
          setStatus("手机号验证失败")
          log.warn(`[注册调试][${accountLabel}] ${message}`)
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: message
          })
          return
        }

        if (!hasRequiredOAuthIntegrationConfig(integration)) {
          const message = `${result.message}；OAuth 接入配置不完整，无法重新执行 Step 5`
          setStatus("手机号验证失败")
          log.warn(`[注册调试][${accountLabel}] ${message}`)
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: message
          })
          return
        }

        oauthAttemptCount += 1
        setStatus("正在重新执行 Step 5")
        setDebugOAuthBinding(null)
        setDebugCallbackUrl("")
        log.warn(
          `[注册调试][${accountLabel}] ${result.message}；正在重新执行 Step 5（OAuth URL ${oauthAttemptCount}/${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS}）`
        )
        patchAccountState(accountKey, {
          progress: 5,
          status: "running",
          lastMessage: "正在重新执行 Step 5"
        })

        const refreshResult = await refreshRegisterOAuthAndLogin(
          integration,
          tabId
        )
        if (
          !refreshResult.ok ||
          typeof refreshResult.targetTab?.id !== "number"
        ) {
          const message = `${result.message}；${refreshResult.message}`
          setStatus("OAuth 登录失败")
          log.warn(`[注册调试][${accountLabel}] ${message}`)
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: message
          })
          return
        }

        const loginResult = await completeRegisterOAuthLogin(
          refreshResult.targetTab.id,
          selectedDebugAccount,
          integration,
          (message) => {
            log.info(`[注册调试][${accountLabel}] ${message}`)
          }
        )
        const step5Message = `${refreshResult.message}；${loginResult.message}`
        if (!loginResult.ok || typeof loginResult.targetTab?.id !== "number") {
          setStatus("OAuth 登录失败")
          log.warn(`[注册调试][${accountLabel}] ${step5Message}`)
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: step5Message
          })
          return
        }

        tabId = loginResult.targetTab.id
        oauthStartedAt =
          loginResult.oauthStartedAt ||
          refreshResult.oauthStartedAt ||
          Date.now()
        setDebugRegisterTabId(String(tabId))
        setDebugOAuthStartedAt(oauthStartedAt)
        setDebugOAuthBinding(
          loginResult.oauthBinding || refreshResult.oauthBinding || null
        )
        setDebugCallbackUrl("")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "手机号验证异常"
      setStatus("手机号验证异常")
      log.warn(`[注册调试][${accountLabel}] ${message}`)
      patchAccountState(accountKey, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
      setRunningEmail("")
    }
  }

  const handleSubmitRegisterOAuthCallback = async () => {
    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    if (!hasRequiredOAuthIntegrationConfig(integration)) {
      setStatus("请先完善 OAuth 接入配置")
      log.warn("[注册调试] Step 7 OAuth 接入配置不完整")
      return
    }
    if (!debugOAuthBinding) {
      setStatus("请先执行 Step 5 获取 OAuth 会话")
      log.warn("[注册调试] Step 7 缺少 OAuth 来源绑定信息")
      return
    }

    const normalizedCallbackUrl = String(debugCallbackUrl || "").trim()
    if (!normalizedCallbackUrl) {
      setStatus("请先执行 Step 6 获取 OAuth 回调地址")
      log.warn("[注册调试] Step 7 缺少 OAuth 回调地址")
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    const callbackTabId =
      Number.isFinite(parsedTabId) && parsedTabId > 0 ? parsedTabId : undefined

    const accountKey = getManagedAccountKey(selectedDebugAccount)
    const accountLabel = getManagedAccountDisplayLabel(selectedDebugAccount)
    setIsDebugRunning(true)
    setDebugRunningStep(7)
    setDebugProgress((current) => Math.max(current, 6))
    setRunningEmail(accountKey)
    setStatus("正在提交 OAuth callback")
    log.info(`[注册调试][${accountLabel}] Step 7 开始`)
    patchAccountState(accountKey, {
      progress: 6,
      status: "running",
      lastMessage: "正在向管理端提交 OAuth callback"
    })

    try {
      const result = await submitRegisterOAuthCallback(
        integration,
        debugOAuthBinding,
        normalizedCallbackUrl,
        callbackTabId,
        selectedDebugAccount.email
      )

      if (!result.ok) {
        const message = `OAuth callback 提交失败；手机号验证可能已经完成，请人工检查管理端；${result.message}`
        setStatus("OAuth callback 需要人工处理")
        log.warn(`[注册调试][${accountLabel}] ${message}`)
        patchAccountState(accountKey, {
          progress: 7,
          status: "needs_review",
          lastMessage: message
        })
        return
      }

      setDebugProgress(REGISTER_STEP_COUNT)
      setStatus("已提交 OAuth callback")
      log.info(`[注册调试][${accountLabel}] Step 7 ${result.message}`)
      patchAccountState(accountKey, {
        progress: REGISTER_STEP_COUNT as ManagedAccountProgress,
        status: "done",
        lastMessage: result.message
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OAuth callback 提交异常"
      setStatus("OAuth callback 提交异常")
      log.warn(`[注册调试][${accountLabel}] ${message}`)
      patchAccountState(accountKey, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
      setRunningEmail("")
    }
  }

  const handleRunRegisterDebugStep = (step: RegisterDebugStep) => {
    const actions: Record<RegisterDebugStep, () => Promise<void>> = {
      1: handleOpenRegisterEntry,
      2: handleSubmitRegisterEmail,
      3: handleSubmitRegisterVerificationCode,
      4: handleSubmitRegisterProfile,
      5: handleCompleteRegisterOAuthLogin,
      6: handleCompleteRegisterPhoneVerification,
      7: handleSubmitRegisterOAuthCallback
    }
    void actions[step]()
  }

  /**
   * 注册页账号管理里手动生成 Duck 邮箱。
   *
   * 这里生成后只回填账号表单；保存账号后，注册执行流程仍然从账号列表读取邮箱。
   *
   * @param options Duck 邮箱生成选项。
   * @param options.previousEmail 点击生成前表单里的邮箱，用于避免重复返回旧值。
   * @param options.generateNew 是否要求 DuckDuckGo 生成新邮箱。
   * @return 生成成功的 Duck 邮箱和展示消息。
   */
  const handleFetchDuckEmail = async (options: FetchDuckEmailOptions) => {
    setStatus("正在获取 Duck 邮箱")
    log.info("[注册账号管理] 正在从 DuckDuckGo 获取注册邮箱")

    try {
      const result = await fetchDuckEmail(options)

      setStatus(result.message)
      log.info(`[注册账号管理] ${result.message}`)

      return result
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Duck 邮箱生成失败"
      setStatus(message)
      log.warn(`[注册账号管理] ${message}`)
      throw error
    }
  }

  const handleStartBatch = async () => {
    const validation = validateRegisterBatchStart({
      hasOAuthConfig: hasRequiredOAuthIntegrationConfig(integration),
      accounts,
      isBatchRunning,
      registerRunLock,
      isDebugRunning,
      selectedAccountIds: selectedEmails,
      hasHeroSmsConfig: heroSms.hasRequiredConfig,
      stepCount: REGISTER_STEP_COUNT
    })
    if (!validation.ok) {
      if (validation.statusMessage) {
        setStatus(validation.statusMessage)
      }
      if (validation.log) {
        log[validation.log.level](validation.log.message)
      }
      return
    }

    await registerTask.startBatch({
      selectedEmails,
      runnableCount: validation.runnableCount
    })
  }

  const handleMarkSelectedRegisterStage = (stage: "start" | "phone") => {
    if (selectedEmails.length === 0) {
      setStatus("请先选择要标记阶段的账号")
      log.warn("请先选择要标记阶段的账号")
      return
    }

    const selectedSet = new Set(selectedEmails)
    const nextProgress = stage === "phone" ? 4 : 0
    const nextMessage =
      stage === "phone"
        ? "已手动标记为从手机号验证开始（下一步从 Step 5 刷新 OAuth 开始）"
        : "已手动标记为从头开始"
    let changedCount = 0
    const now = Date.now()
    const nextAccounts = accounts.map((account) => {
      if (!selectedSet.has(getManagedAccountKey(account))) {
        return account
      }

      changedCount += 1
      return {
        ...account,
        progress: nextProgress as ManagedAccountProgress,
        status: "idle" as const,
        lastMessage: nextMessage,
        updatedAt: now
      }
    })

    if (changedCount === 0) {
      setStatus("未找到选中的账号")
      log.warn("未找到选中的账号，无法标记阶段")
      return
    }

    syncAccounts(nextAccounts, cpaUrl, cpaManagementKey)
    setStatus(`已标记 ${changedCount} 个账号阶段`)
    log.info(`已标记 ${changedCount} 个账号：${nextMessage}`)
  }

  const disabled = isBatchRunning || isDebugRunning
  const hasBatchConfig = Boolean(
    hasRequiredOAuthIntegrationConfig(integration) && heroSms.hasRequiredConfig
  )
  return (
    <>
      <RegisterStopStrategyModal
        open={isStopStrategyModalOpen}
        isStopping={isBatchStopping}
        onChoose={registerTask.chooseStopStrategy}
      />
      <AccountListPanel
        accountPage={accountPage}
        disabled={disabled}
        stepCount={REGISTER_STEP_COUNT}
        stepLabels={REGISTER_FLOW_STEPS}
        extraMoreItems={[
          {
            key: "register-stage-start",
            label: "标记：从头开始"
          },
          {
            key: "register-stage-phone",
            label: "标记：从手机号验证开始"
          }
        ]}
        onExtraMoreClick={(key) => {
          if (
            key !== "register-stage-start" &&
            key !== "register-stage-phone"
          ) {
            return false
          }

          handleMarkSelectedRegisterStage(
            key === "register-stage-phone" ? "phone" : "start"
          )
          return true
        }}
        toolbarActions={
          isBatchRunning ? (
            <Button
              danger
              disabled={isBatchStopping}
              loading={isBatchStopping}
              onClick={registerTask.stopBatch}>
              {isBatchStopping ? "正在停止" : "停止当前流程"}
            </Button>
          ) : (
            <Button
              type="primary"
              disabled={
                !hasBatchConfig ||
                selectedCount === 0 ||
                hasOrphanRegisterRunLock
              }
              onClick={() => {
                void handleStartBatch()
              }}>
              执行
            </Button>
          )
        }
      />

      <RegisterOrphanRunLockAlert
        visible={hasOrphanRegisterRunLock}
        registerRunLock={registerRunLock}
        isClearing={isClearingRunLock}
        onClear={registerTask.clearRunLock}
      />

      <RegisterAutomationPanel
        config={alarmConfig}
        appliedConfig={appliedAlarmConfig}
        disabled={disabled}
        isSaving={isAlarmSaving}
        isTesting={isAlarmTesting}
        hasOrphanRunLock={hasOrphanRegisterRunLock}
        onConfigChange={setAlarmConfig}
        onSave={registerTask.saveAlarmConfig}
        onRunNow={registerTask.runAlarmNow}
      />

      <HeroSmsConfigPanel heroSms={heroSms} disabled={isDebugRunning} />

      <OAuthConfigPanel
        target={oauthTarget}
        cpaUrl={cpaUrl}
        cpaManagementKey={cpaManagementKey}
        disabled={disabled}
        onCpaConfigChange={accountPage.handleCpaConfigChange}
      />

      <AccountFormPanel
        accountPage={accountPage}
        disabled={disabled}
        allowEmailGenerator
        draftStorageKey={REGISTER_ACCOUNT_FORM_DRAFT_STORAGE_KEY}
        onFetchDuckEmail={handleFetchDuckEmail}
      />

      <RegisterDebugPanel
        disabled={disabled}
        accountFilter={debugAccountFilter}
        onAccountFilterChange={setDebugAccountFilter}
        accountOptions={filteredDebugAccounts.map((account) => {
          return {
            label: getManagedAccountDisplayLabel(account),
            value: getManagedAccountKey(account)
          }
        })}
        selectedAccountId={debugEmail}
        onSelectedAccountChange={handleDebugAccountChange}
        tabId={debugRegisterTabId}
        onTabIdChange={setDebugRegisterTabId}
        onUseActiveTab={handleUseActiveTabAsDebugRegisterTab}
        onClear={handleClearDebugState}
        progress={debugProgress}
        isRunning={isDebugRunning}
        runningStep={debugRunningStep}
        hasSelectedAccount={Boolean(selectedDebugAccount)}
        hasOAuthConfig={hasRequiredOAuthIntegrationConfig(integration)}
        canSubmitCallback={Boolean(
          selectedDebugAccount &&
            debugCallbackUrl &&
            hasRequiredOAuthIntegrationConfig(integration) &&
            debugOAuthBinding
        )}
        onRunStep={handleRunRegisterDebugStep}
      />
    </>
  )
}
