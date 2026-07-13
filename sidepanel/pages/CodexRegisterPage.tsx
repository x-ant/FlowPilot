import {
  Alert,
  Button,
  Collapse,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Tag
} from "antd"
import { useEffect, useMemo, useState } from "react"

import {
  clickRegisterAndSubmitEmail,
  clickRegisterReadyContinue,
  completeRegisterOAuthLogin,
  completeRegisterPhoneVerification,
  fetchAndSubmitRegisterVerificationCode,
  openChatGptRegisterEntry,
  prepareRegisterAccountEmail,
  refreshRegisterOAuthAndLogin,
  submitRegisterOAuthCallbackToCpa,
  submitRegisterProfile,
  type CodexRegisterStepResponse
} from "../../background/register/steps"
import {
  fetchDuckEmail,
  type FetchDuckEmailOptions
} from "../../background/integrations/duck-email"
import {
  REGISTER_STEP_COUNT,
  type RegisterStopStrategy
} from "../../background/register/batch-runner"
import {
  AccountFormPanel,
  AccountListPanel,
  useAccountPageState
} from "../account-management"
import { CpaConfigPanel } from "../cpa-config"
import { DebugTabControl } from "../components/DebugTabControl"
import { HeroSmsConfigPanel, useHeroSmsConfig } from "../hero-sms-config"
import type { PageProps } from "./types"
import {
  buildAccountInvalidLastMessage,
  DEFAULT_REGISTER_ALARM_CONFIG,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  matchesManagedAccountVisibilityFilter,
  normalizeRegisterAlarmConfig,
  normalizeRegisterRunLock,
  REGISTER_ACCOUNT_FORM_DRAFT_STORAGE_KEY,
  REGISTER_ALARM_STORAGE_KEY,
  REGISTER_RUN_LOCK_STALE_MS,
  REGISTER_RUN_LOCK_STORAGE_KEY,
  REGISTER_STORAGE_KEYS,
  type AccountVisibilityFilter,
  type ManagedAccount,
  type ManagedAccountProgress,
  type ManagedAccountStatus,
  type RegisterAlarmConfig,
  type RegisterRunLock
} from "../../shared/account-state"

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
    label: "7 回填 CPA"
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

type RegisterRunStatus = {
  lock: RegisterRunLock | null
  activeInMemory: boolean
  stale: boolean
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

const isRegisterAccountDone = (account: ManagedAccount) => {
  return account.status === "done" || account.progress >= REGISTER_STEP_COUNT
}

const sendRegisterAlarmMessage = <T,>(message: unknown) => {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(response as T)
    })
  })
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
    selectedEmailSet,
    selectedCount,
    syncAccounts,
    patchAccountState,
    setRunningEmail
  } = accountPage
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
  const [debugCpaOAuthState, setDebugCpaOAuthState] = useState("")
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const heroSms = useHeroSmsConfig({ log, setStatus })
  const [alarmConfig, setAlarmConfig] = useState<RegisterAlarmConfig>(
    DEFAULT_REGISTER_ALARM_CONFIG
  )
  const [appliedAlarmConfig, setAppliedAlarmConfig] =
    useState<RegisterAlarmConfig>(DEFAULT_REGISTER_ALARM_CONFIG)
  const [registerRunLock, setRegisterRunLock] =
    useState<RegisterRunLock | null>(null)
  const [registerRunStatus, setRegisterRunStatus] =
    useState<RegisterRunStatus | null>(null)
  const [isClearingRunLock, setIsClearingRunLock] = useState(false)
  const [isAlarmSaving, setIsAlarmSaving] = useState(false)
  const [isAlarmTesting, setIsAlarmTesting] = useState(false)
  const [isBatchStopping, setIsBatchStopping] = useState(false)
  const [isStopStrategyModalOpen, setIsStopStrategyModalOpen] = useState(false)

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
  const isRegisterRunLockFresh = Boolean(
    registerRunLock &&
      Date.now() - registerRunLock.startedAt < REGISTER_RUN_LOCK_STALE_MS
  )
  const isRegisterRunStatusMatched = Boolean(
    registerRunStatus &&
      registerRunLock &&
      registerRunStatus.lock?.runId === registerRunLock.runId
  )
  const isBatchRunning = isRegisterRunStatusMatched
    ? Boolean(registerRunStatus?.activeInMemory)
    : isRegisterRunLockFresh
  const hasOrphanRegisterRunLock = Boolean(
    registerRunLock &&
      registerRunStatus &&
      isRegisterRunStatusMatched &&
      !registerRunStatus.activeInMemory
  )
  const getDebugStepButtonType = (step: number) => {
    return step <= debugProgress ? "primary" : "default"
  }

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

  const refreshRegisterRunStatus = async () => {
    try {
      const response = await sendRegisterAlarmMessage<
        RegisterRunStatus & { ok: boolean }
      >({
        type: "flowpilot:register:run-status"
      })
      setRegisterRunStatus({
        lock: response.lock,
        activeInMemory: Boolean(response.activeInMemory),
        stale: Boolean(response.stale)
      })
      setRegisterRunLock(response.lock)
    } catch (error) {
      log.warn(error instanceof Error ? error.message : "读取注册任务状态失败")
    }
  }

  useEffect(() => {
    chrome.storage.local.get(
      [REGISTER_ALARM_STORAGE_KEY, REGISTER_RUN_LOCK_STORAGE_KEY],
      (result) => {
        const nextAlarmConfig = normalizeRegisterAlarmConfig(
          result[REGISTER_ALARM_STORAGE_KEY]
        )
        setAlarmConfig(nextAlarmConfig)
        setAppliedAlarmConfig(nextAlarmConfig)
        setRegisterRunLock(
          normalizeRegisterRunLock(result[REGISTER_RUN_LOCK_STORAGE_KEY])
        )
        void refreshRegisterRunStatus()
      }
    )
  }, [])

  useEffect(() => {
    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") {
        return
      }

      if (changes[REGISTER_ALARM_STORAGE_KEY]) {
        const nextAlarmConfig = normalizeRegisterAlarmConfig(
          changes[REGISTER_ALARM_STORAGE_KEY].newValue
        )
        setAlarmConfig(nextAlarmConfig)
        setAppliedAlarmConfig(nextAlarmConfig)
      }

      if (changes[REGISTER_RUN_LOCK_STORAGE_KEY]) {
        setRegisterRunLock(
          normalizeRegisterRunLock(
            changes[REGISTER_RUN_LOCK_STORAGE_KEY].newValue
          )
        )
        void refreshRegisterRunStatus()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChanged)
    }
  }, [])

  useEffect(() => {
    setRunningEmail(isBatchRunning ? registerRunLock?.currentEmail || "" : "")
  }, [isBatchRunning, registerRunLock?.currentEmail, setRunningEmail])

  useEffect(() => {
    if (!isBatchRunning) {
      setIsBatchStopping(false)
      setIsStopStrategyModalOpen(false)
    }
  }, [isBatchRunning])

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
    setDebugCpaOAuthState("")
    setDebugCallbackUrl("")
    setStatus("注册调试状态已清空")
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
    log.info(
      `[注册调试][${accountLabel}] Step ${options.step} 开始`
    )
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
        const preparedResult = await prepareRegisterAccountEmail(
          selectedDebugAccount
        )
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
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()

    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("[注册调试] Step 5 缺少 CPA 地址")
      return
    }

    if (!normalizedCpaManagementKey) {
      setStatus("请先填写 CPA 管理密钥")
      log.warn("[注册调试] Step 5 缺少 CPA 管理密钥")
      return
    }

    const accountKey = getManagedAccountKey(selectedDebugAccount)
    const accountLabel = getManagedAccountDisplayLabel(selectedDebugAccount)
    setIsDebugRunning(true)
    setDebugRunningStep(5)
    setDebugProgress((current) => Math.max(current, 4))
    setRunningEmail(accountKey)
    setStatus("正在完成 OAuth 登录")
    log.info(`[注册调试][${accountLabel}] Step 5 开始`)
    patchAccountState(accountKey, {
      progress: 4,
      status: "running",
      lastMessage: "正在刷新 OAuth 并选择账号卡片"
    })

    try {
      const refreshResult = await refreshRegisterOAuthAndLogin(
        normalizedCpaUrl,
        normalizedCpaManagementKey
      )
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
        normalizedCpaUrl,
        normalizedCpaManagementKey,
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
      setDebugCpaOAuthState(
        result.cpaOAuthState || refreshResult.cpaOAuthState || ""
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

        const normalizedCpaUrl = String(cpaUrl || "").trim()
        const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()
        if (!normalizedCpaUrl || !normalizedCpaManagementKey) {
          const message = `${result.message}；缺少 CPA 地址或管理密钥，无法重新执行 Step 5`
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
        log.warn(
          `[注册调试][${accountLabel}] ${result.message}；正在重新执行 Step 5（OAuth URL ${oauthAttemptCount}/${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS}）`
        )
        patchAccountState(accountKey, {
          progress: 5,
          status: "running",
          lastMessage: "正在重新执行 Step 5"
        })

        const refreshResult = await refreshRegisterOAuthAndLogin(
          normalizedCpaUrl,
          normalizedCpaManagementKey,
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
          normalizedCpaUrl,
          normalizedCpaManagementKey,
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
        setDebugCpaOAuthState(
          loginResult.cpaOAuthState || refreshResult.cpaOAuthState || ""
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

  const handleSubmitRegisterOAuthCallbackToCpa = async () => {
    if (isBatchRunning || isDebugRunning || !selectedDebugAccount) {
      return
    }

    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()
    if (!normalizedCpaUrl || !normalizedCpaManagementKey) {
      setStatus("请先填写 CPA 地址和管理密钥")
      log.warn("[注册调试] Step 7 缺少 CPA 地址或管理密钥")
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
    setStatus("正在回填 CPA")
    log.info(`[注册调试][${accountLabel}] Step 7 开始`)
    patchAccountState(accountKey, {
      progress: 6,
      status: "running",
      lastMessage: "正在把 OAuth 回调地址提交回 CPA"
    })

    try {
      const result = await submitRegisterOAuthCallbackToCpa(
        normalizedCpaUrl,
        normalizedCpaManagementKey,
        normalizedCallbackUrl,
        callbackTabId,
        debugCpaOAuthState
      )

      if (!result.ok) {
        const message = `CPA 回填失败；手机号验证码已提交，手机号验证可能已经完成，请人工处理 CPA 回填；${result.message}`
        setStatus("CPA 回填需要人工处理")
        log.warn(`[注册调试][${accountLabel}] ${message}`)
        patchAccountState(accountKey, {
          progress: 7,
          status: "needs_review",
          lastMessage: message
        })
        return
      }

      setDebugProgress(REGISTER_STEP_COUNT)
      setStatus("已完成 CPA 回填")
      log.info(`[注册调试][${accountLabel}] Step 7 ${result.message}`)
      patchAccountState(accountKey, {
        progress: REGISTER_STEP_COUNT as ManagedAccountProgress,
        status: "done",
        lastMessage: result.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "CPA 回填异常"
      setStatus("CPA 回填异常")
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

  const handleSaveAlarmConfig = async () => {
    const nextConfig = normalizeRegisterAlarmConfig({
      ...alarmConfig,
      selectedEmails: []
    })

    setIsAlarmSaving(true)
    try {
      const response = await sendRegisterAlarmMessage<{
        ok: boolean
        message: string
        config?: RegisterAlarmConfig
      }>({
        type: "flowpilot:register:alarm-save",
        config: nextConfig
      })
      const savedConfig = normalizeRegisterAlarmConfig(
        response.config || nextConfig
      )
      setAlarmConfig(savedConfig)
      setAppliedAlarmConfig(savedConfig)
      setStatus(response.message)
      log.info(
        `${response.message}；模式 ${
          savedConfig.mode === "interval"
            ? `${savedConfig.intervalMinutes} 分钟间隔`
            : `每天 ${savedConfig.dailyTime}`
        }；账号间隔 ${savedConfig.accountIntervalMinSeconds}~${savedConfig.accountIntervalMaxSeconds} 秒`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "保存自动触发配置失败"
      setStatus("保存自动触发配置失败")
      log.warn(message)
    } finally {
      setIsAlarmSaving(false)
    }
  }

  const handleTestAlarmRun = async () => {
    setIsAlarmTesting(true)
    setStatus("正在触发单次注册")
    log.info("[注册流程] 正在触发单次注册")
    try {
      const response = await sendRegisterAlarmMessage<{
        ok: boolean
        message: string
      }>({
        type: "flowpilot:register:alarm-run-now"
      })
      if (!response?.ok) {
        throw new Error(response?.message || "单次注册触发失败")
      }

      setStatus(response.message)
      log.info(response.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "触发单次注册失败"
      setStatus("触发单次注册失败")
      log.warn(message)
    } finally {
      setIsAlarmTesting(false)
    }
  }

  const handleClearRegisterRunLock = async () => {
    setIsClearingRunLock(true)
    try {
      const response = await sendRegisterAlarmMessage<{
        ok: boolean
        message: string
      }>({
        type: "flowpilot:register:clear-run-lock"
      })
      setStatus(response.message)
      log[response.ok ? "info" : "warn"](response.message)
      await refreshRegisterRunStatus()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "清除注册任务锁失败"
      setStatus("清除注册任务锁失败")
      log.warn(message)
    } finally {
      setIsClearingRunLock(false)
    }
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
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()
    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("未填写 CPA 地址")
      return
    }

    if (!normalizedCpaManagementKey) {
      setStatus("请先填写 CPA 管理密钥")
      log.warn("未填写 CPA 管理密钥")
      return
    }

    if (accounts.length === 0) {
      setStatus("请先添加至少一个账号")
      log.warn("账号列表为空")
      return
    }

    if (isBatchRunning && registerRunLock) {
      setStatus("注册任务正在后台执行")
      log.warn(registerRunLock.message || "注册任务正在后台执行")
      return
    }

    if (isDebugRunning) {
      return
    }

    if (selectedEmails.length === 0) {
      setStatus("请先选择要执行的账号")
      log.info("请先选择要执行的账号")
      return
    }

    if (!heroSms.hasRequiredConfig) {
      setStatus("请先填写 HeroSMS 接码配置")
      log.warn("注册执行缺少 HeroSMS 接码配置")
      return
    }

    const runnableCount = accounts.filter((account) => {
      return (
        selectedEmailSet.has(getManagedAccountKey(account)) &&
        !isRegisterAccountDone(account) &&
        account.status !== "needs_review"
      )
    }).length
    if (runnableCount === 0) {
      const emptyMessage = "选中的账号没有可执行项"
      setStatus(emptyMessage)
      log.info(emptyMessage)
      return
    }

    setIsBatchStopping(false)
    setIsStopStrategyModalOpen(false)

    const batchLabel = "选中账号"
    try {
      const response = await sendRegisterAlarmMessage<{
        ok: boolean
        message: string
      }>({
        type: "flowpilot:register:batch-start",
        selectedEmails
      })
      setStatus(response.message)
      log[response.ok ? "info" : "warn"](
        `${response.message}；计划执行 ${runnableCount} 个${batchLabel}`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "提交注册任务到后台失败"
      setStatus("提交注册任务到后台失败")
      log.warn(message)
    }
  }

  const requestStopBatch = async (strategy: RegisterStopStrategy) => {
    if (isBatchStopping) {
      return
    }

    setIsBatchStopping(true)
    try {
      const response = await sendRegisterAlarmMessage<{
        ok: boolean
        message: string
      }>({
        type: "flowpilot:register:batch-stop",
        strategy
      })
      setStatus(response.message)
      log.warn(response.message)
      if (!response.ok) {
        setIsBatchStopping(false)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "发送停止请求失败"
      setStatus("发送停止请求失败")
      log.warn(message)
      setIsBatchStopping(false)
    }
  }

  const handleStopBatch = () => {
    if (isBatchStopping) {
      return
    }

    if (registerRunLock?.phonePhase === "phone_submitted") {
      setIsStopStrategyModalOpen(true)
      return
    }

    void requestStopBatch("immediate")
  }

  const handleChooseStopStrategy = (strategy: RegisterStopStrategy) => {
    setIsStopStrategyModalOpen(false)
    void requestStopBatch(strategy)
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
    cpaUrl.trim() && cpaManagementKey.trim() && heroSms.hasRequiredConfig
  )
  const alarmLastTriggeredLabel = appliedAlarmConfig.lastTriggeredAt
    ? new Date(appliedAlarmConfig.lastTriggeredAt).toLocaleString()
    : "尚未触发"
  const alarmSummary =
    appliedAlarmConfig.mode === "interval"
      ? `每 ${appliedAlarmConfig.intervalMinutes} 分钟`
      : `每天 ${appliedAlarmConfig.dailyTime}`
  const orphanLockStartedLabel = registerRunLock?.startedAt
    ? new Date(registerRunLock.startedAt).toLocaleString()
    : ""

  return (
    <>
      <Modal
        title="当前手机号已进入验证流程"
        open={isStopStrategyModalOpen}
        closable={false}
        mask={{ closable: false }}
        footer={[
          <Button
            key="immediate"
            danger
            disabled={isBatchStopping}
            loading={isBatchStopping}
            onClick={() => {
              handleChooseStopStrategy("immediate")
            }}>
            直接停止
          </Button>,
          <Button
            key="finish"
            type="primary"
            disabled={isBatchStopping}
            onClick={() => {
              handleChooseStopStrategy("finish_current_if_phone_success")
            }}>
            成功则完成回填
          </Button>
        ]}>
        <div>
          <p>
            当前手机号已经获取并可能已经提交到
            OpenAI。直接停止会把当前手机号后续处理交给你人工负责。
          </p>
          <p>
            推荐选择“成功则完成回填”：如果当前手机号失败就停止，不再换号；如果验证成功，就完成 CPA 回填后停止。
          </p>
        </div>
      </Modal>
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
              onClick={handleStopBatch}>
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

      {hasOrphanRegisterRunLock ? (
        <Alert
          type="warning"
          showIcon
          title="检测到残留注册任务锁"
          description={`开始时间：${orphanLockStartedLabel || "未知"}；当前账号：${
            registerRunLock?.currentEmail || "未知"
          }；最后状态：${registerRunLock?.message || "未知"}`}
          action={
            <Button
              size="small"
              loading={isClearingRunLock}
              onClick={() => {
                void handleClearRegisterRunLock()
              }}>
              清除残留锁
            </Button>
          }
        />
      ) : null}

      <Collapse
        className="panel-card"
        items={[
          {
            key: "register-alarm",
            label: "自动触发",
            extra: (
              <Tag
                color={appliedAlarmConfig.enabled ? "processing" : "default"}>
                {appliedAlarmConfig.enabled ? alarmSummary : "未启用"}
              </Tag>
            ),
            children: (
              <div className="debug-panel">
                <Space
                  orientation="vertical"
                  size={12}
                  style={{ width: "100%" }}>
                  <Space size={12} wrap>
                    <Switch
                      checked={alarmConfig.enabled}
                      disabled={disabled || isAlarmSaving}
                      onChange={(checked) => {
                        setAlarmConfig((current) => ({
                          ...current,
                          enabled: checked
                        }))
                      }}
                    />
                    <Radio.Group
                      value={alarmConfig.mode}
                      disabled={disabled || isAlarmSaving}
                      onChange={(event) => {
                        setAlarmConfig((current) => ({
                          ...current,
                          mode:
                            event.target.value === "daily"
                              ? "daily"
                              : "interval"
                        }))
                      }}>
                      <Radio.Button value="interval">间隔</Radio.Button>
                      <Radio.Button value="daily">每天</Radio.Button>
                    </Radio.Group>
                  </Space>

                  {alarmConfig.mode === "interval" ? (
                    <Space size={8} wrap>
                      <span className="debug-label">间隔分钟</span>
                      <InputNumber
                        min={1}
                        precision={0}
                        value={alarmConfig.intervalMinutes}
                        disabled={disabled || isAlarmSaving}
                        onChange={(value) => {
                          setAlarmConfig((current) => ({
                            ...current,
                            intervalMinutes: Math.max(1, Number(value || 1))
                          }))
                        }}
                      />
                    </Space>
                  ) : (
                    <Space size={8} wrap>
                      <span className="debug-label">每天时间</span>
                      <Input
                        type="time"
                        value={alarmConfig.dailyTime}
                        disabled={disabled || isAlarmSaving}
                        onChange={(event) => {
                          setAlarmConfig((current) => ({
                            ...current,
                            dailyTime: event.target.value || "02:00"
                          }))
                        }}
                      />
                    </Space>
                  )}

                  <Space size={8} wrap>
                    <span className="debug-label">账号间隔范围</span>
                    <Space.Compact>
                      <InputNumber
                        min={0}
                        precision={0}
                        value={alarmConfig.accountIntervalMinSeconds}
                        disabled={disabled || isAlarmSaving}
                        onChange={(value) => {
                          setAlarmConfig((current) => {
                            const nextMinSeconds = Math.max(
                              0,
                              Number(value || 0)
                            )
                            return {
                              ...current,
                              accountIntervalMinSeconds: nextMinSeconds,
                              accountIntervalMaxSeconds: Math.max(
                                nextMinSeconds,
                                current.accountIntervalMaxSeconds
                              )
                            }
                          })
                        }}
                      />
                      <Button tabIndex={-1} style={{ pointerEvents: "none" }}>
                        秒
                      </Button>
                    </Space.Compact>
                    <span className="debug-label">至</span>
                    <Space.Compact>
                      <InputNumber
                        min={0}
                        precision={0}
                        value={alarmConfig.accountIntervalMaxSeconds}
                        disabled={disabled || isAlarmSaving}
                        onChange={(value) => {
                          setAlarmConfig((current) => ({
                            ...current,
                            accountIntervalMaxSeconds: Math.max(
                              current.accountIntervalMinSeconds,
                              Number(value || 0)
                            )
                          }))
                        }}
                      />
                      <Button tabIndex={-1} style={{ pointerEvents: "none" }}>
                        秒
                      </Button>
                    </Space.Compact>
                  </Space>

                  <Space size={8} wrap>
                    <Tag color="default">{`上次 ${alarmLastTriggeredLabel}`}</Tag>
                  </Space>

                  {appliedAlarmConfig.lastMessage ? (
                    <div className="debug-label">
                      {appliedAlarmConfig.lastMessage}
                    </div>
                  ) : null}

                  <Space size={8} wrap>
                    <Button
                      type="primary"
                      loading={isAlarmSaving}
                      disabled={disabled || isAlarmSaving}
                      onClick={() => {
                        void handleSaveAlarmConfig()
                      }}>
                      应用定时设置
                    </Button>
                    <Button
                      loading={isAlarmTesting}
                      disabled={
                        disabled || isAlarmTesting || hasOrphanRegisterRunLock
                      }
                      onClick={() => {
                        void handleTestAlarmRun()
                      }}>
                      单次触发
                    </Button>
                  </Space>
                </Space>
              </div>
            )
          }
        ]}
      />

      <HeroSmsConfigPanel heroSms={heroSms} disabled={isDebugRunning} />

      <CpaConfigPanel
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

      <Collapse
        className="panel-card"
        items={[
          {
            key: "debug",
            label: "调试控制台",
            extra: (
              <Tag color="default">{`当前进度 ${debugProgress}/${REGISTER_STEP_COUNT}`}</Tag>
            ),
            children: (
              <div className="debug-panel">
                <div className="debug-field debug-field--inline">
                  <span className="debug-label">账号范围</span>
                  <Segmented<AccountVisibilityFilter>
                    size="small"
                    value={debugAccountFilter}
                    options={[
                      { label: "未完成", value: "pending" },
                      { label: "已完成", value: "done" },
                      { label: "失效", value: "invalid" },
                      { label: "全部", value: "all" }
                    ]}
                    onChange={setDebugAccountFilter}
                    disabled={disabled}
                  />
                </div>
                <DebugTabControl
                  disabled={disabled}
                  label="注册 tab"
                  leadingContent={
                    <div className="debug-field">
                      <span className="debug-label">账号</span>
                      <Select
                        value={debugEmail || undefined}
                        placeholder="选择账号"
                        options={filteredDebugAccounts.map((account) => {
                          return {
                            label: getManagedAccountDisplayLabel(account),
                            value: getManagedAccountKey(account)
                          }
                        })}
                        onChange={(value) => {
                          setDebugEmail(value)
                          setDebugProgress(0)
                          setDebugRunningStep(0)
                          setDebugVerificationRequestedAt(0)
                          setDebugOAuthStartedAt(0)
                          setDebugCpaOAuthState("")
                          setDebugCallbackUrl("")
                        }}
                        disabled={
                          disabled ||
                          filteredDebugAccounts.length === 0
                        }
                      />
                    </div>
                  }
                  value={debugRegisterTabId}
                  onChange={setDebugRegisterTabId}
                  onUseActiveTab={handleUseActiveTabAsDebugRegisterTab}
                  onClear={handleClearDebugState}
                />

                <Space size={8} wrap>
                  <Button
                    type={getDebugStepButtonType(1)}
                    onClick={() => {
                      void handleOpenRegisterEntry()
                    }}
                    loading={isDebugRunning && debugRunningStep === 1}
                    disabled={disabled}>
                    1 打开 GPT 页面
                  </Button>
                  <Button
                    type={getDebugStepButtonType(2)}
                    onClick={() => {
                      void handleSubmitRegisterEmail()
                    }}
                    loading={isDebugRunning && debugRunningStep === 2}
                    disabled={disabled || !selectedDebugAccount}>
                    2 点击注册并提交邮箱
                  </Button>
                  <Button
                    type={getDebugStepButtonType(3)}
                    onClick={() => {
                      void handleSubmitRegisterVerificationCode()
                    }}
                    loading={isDebugRunning && debugRunningStep === 3}
                    disabled={disabled || !selectedDebugAccount}>
                    3 提交验证码
                  </Button>
                  <Button
                    type={getDebugStepButtonType(4)}
                    onClick={() => {
                      void handleSubmitRegisterProfile()
                    }}
                    loading={isDebugRunning && debugRunningStep === 4}
                    disabled={disabled || !selectedDebugAccount}>
                    4 填写名称年龄并继续
                  </Button>
                  <Button
                    type={getDebugStepButtonType(5)}
                    onClick={() => {
                      void handleCompleteRegisterOAuthLogin()
                    }}
                    loading={isDebugRunning && debugRunningStep === 5}
                    disabled={
                      disabled ||
                      !selectedDebugAccount ||
                      !cpaUrl.trim() ||
                      !cpaManagementKey.trim()
                    }>
                    5 完成 OAuth 登录
                  </Button>
                  <Button
                    type={getDebugStepButtonType(6)}
                    onClick={() => {
                      void handleCompleteRegisterPhoneVerification()
                    }}
                    loading={isDebugRunning && debugRunningStep === 6}
                    disabled={disabled || !selectedDebugAccount}>
                    6 手机号验证
                  </Button>
                  <Button
                    type={getDebugStepButtonType(7)}
                    onClick={() => {
                      void handleSubmitRegisterOAuthCallbackToCpa()
                    }}
                    loading={isDebugRunning && debugRunningStep === 7}
                    disabled={
                      disabled ||
                      !selectedDebugAccount ||
                      !debugCallbackUrl ||
                      !cpaUrl.trim() ||
                      !cpaManagementKey.trim()
                    }>
                    7 回填 CPA
                  </Button>
                </Space>
              </div>
            )
          }
        ]}
      />
    </>
  )
}
