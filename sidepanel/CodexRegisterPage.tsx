import { Button, Collapse, Modal, Select, Space, Tag } from "antd"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  clickRegisterAndSubmitEmail,
  clickRegisterReadyContinue,
  completeRegisterOAuthLogin,
  completeRegisterPhoneVerification,
  createCodexRegisterRunner,
  fetchAndSubmitRegisterVerificationCode,
  openChatGptRegisterEntry,
  refreshRegisterOAuthAndLogin,
  submitRegisterOAuthCallbackToCpa,
  submitRegisterProfile
} from "../background/codex-register"
import { type HeroSmsPhoneVerificationOptions } from "../background/register-phone-verification"
import {
  AccountFormPanel,
  AccountListPanel,
  useAccountPageState
} from "./account-management"
import { CpaConfigPanel } from "./cpa-config"
import { DebugTabControl } from "./DebugTabControl"
import { HeroSmsConfigPanel, useHeroSmsConfig } from "./hero-sms-config"
import {
  normalizeEmail,
  REGISTER_STORAGE_KEYS,
  resetManagedAccountState,
  type AccountRunResult,
  type ManagedAccount,
  type ManagedAccountProgress,
  type ManagedAccountStatus,
  type PageProps
} from "./shared"

const REGISTER_STEP_COUNT = 7
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
    label: "4 完成账户创建并继续"
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

type RegisterStepResult = {
  ok: boolean
  message: string
  needRefreshOAuth?: boolean
  needsManualReview?: boolean
  oauthStartedAt?: number
  cpaOAuthState?: string
  callbackUrl?: string
  targetTab?: {
    id?: number
    url?: string
  }
}

type RegisterDebugStepOptions = {
  step: number
  runningStatus: string
  runningMessage: string
  runningProgress: ManagedAccountProgress
  action: (tabId: number) => Promise<RegisterStepResult>
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

type RegisterStopStrategy =
  | "none"
  | "immediate"
  | "after_phone"
  | "finish_current_if_phone_success"

const runManagedRegisterFlow = async (
  cpaUrl: string,
  cpaManagementKey: string,
  account: ManagedAccount,
  heroSmsOptions: HeroSmsPhoneVerificationOptions,
  runner: ReturnType<typeof createCodexRegisterRunner>,
  getStopStrategy: () => RegisterStopStrategy,
  onStage: (progress: ManagedAccountProgress, message: string) => void
): Promise<AccountRunResult> => {
  const messages: string[] = []
  const startFromStep = account.progress >= 4 ? 5 : 1

  if (startFromStep === 1) {
    const step1Result = await runner.openChatGptRegisterEntry()
    if (!step1Result.ok || !step1Result.targetTab?.id) {
      return {
        ok: false,
        message: step1Result.message || "步骤 1 执行失败"
      }
    }
    messages.push(step1Result.message)
    onStage(1, step1Result.message)

    const registerTabId = step1Result.targetTab.id
    const verificationRequestedAt = Date.now()
    const step2Result = await runner.clickRegisterAndSubmitEmail(
      account.email,
      registerTabId
    )
    if (!step2Result.ok) {
      return {
        ok: false,
        message: step2Result.message || "步骤 2 执行失败"
      }
    }
    messages.push(step2Result.message)
    onStage(2, step2Result.message)

    const step3Result = await runner.fetchAndSubmitRegisterVerificationCode(
      registerTabId,
      account.email,
      account.password,
      verificationRequestedAt
    )
    if (!step3Result.ok) {
      return {
        ok: false,
        message: step3Result.message || "步骤 3 执行失败"
      }
    }
    messages.push(step3Result.message)
    onStage(3, step3Result.message)

    const profileResult = await runner.submitRegisterProfile(registerTabId)
    if (!profileResult.ok) {
      return {
        ok: false,
        message: profileResult.message || "步骤 4 执行失败"
      }
    }
    const continueResult =
      await runner.clickRegisterReadyContinue(registerTabId)
    if (!continueResult.ok) {
      return {
        ok: false,
        message: `${profileResult.message}；${continueResult.message || "步骤 4 执行失败"}`
      }
    }
    const step4Message = `${profileResult.message}；${continueResult.message}`
    messages.push(step4Message)
    onStage(4, step4Message)
  }

  const refreshResult = await runner.refreshRegisterOAuthAndLogin(
    cpaUrl,
    cpaManagementKey
  )
  if (!refreshResult.ok || typeof refreshResult.targetTab?.id !== "number") {
    return {
      ok: false,
      message: refreshResult.message || "步骤 5 执行失败"
    }
  }
  const loginResult = await runner.completeRegisterOAuthLogin(
    refreshResult.targetTab.id,
    account.email,
    account.password,
    cpaUrl,
    cpaManagementKey
  )
  const step5Message = `${refreshResult.message}；${loginResult.message}`
  if (!loginResult.ok || typeof loginResult.targetTab?.id !== "number") {
    return {
      ok: false,
      message: step5Message || "步骤 5 执行失败"
    }
  }
  messages.push(step5Message)
  onStage(5, step5Message)

  let phoneTabId = loginResult.targetTab.id
  let oauthStartedAt =
    loginResult.oauthStartedAt || refreshResult.oauthStartedAt || Date.now()
  let cpaOAuthState =
    loginResult.cpaOAuthState || refreshResult.cpaOAuthState || ""
  let oauthAttemptCount = 1
  let phoneResult: RegisterStepResult

  while (true) {
    phoneResult = await runner.completeRegisterPhoneVerification(
      phoneTabId,
      heroSmsOptions,
      oauthStartedAt
    )

    if (phoneResult.ok) {
      break
    }

    if (!phoneResult.needRefreshOAuth) {
      if (phoneResult.needsManualReview) {
        onStage(6, phoneResult.message)
        return {
          ok: false,
          needsReview: true,
          message: `${phoneResult.message}；手机号验证码已经提交但跳转结果无法判断，为避免重复浪费手机号，请人工检查`
        }
      }

      return {
        ok: false,
        message: phoneResult.message || "步骤 6 执行失败"
      }
    }

    if (getStopStrategy() !== "none") {
      return {
        ok: false,
        message: `${phoneResult.message}；已按停止策略在当前手机号结束后停止`
      }
    }

    if (oauthAttemptCount >= REGISTER_PHONE_MAX_OAUTH_ATTEMPTS) {
      const closedAuthTab = await closeTabQuietly(phoneTabId)
      return {
        ok: false,
        message: `${phoneResult.message}；已达到 OAuth URL 获取上限 ${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS} 次；${
          closedAuthTab ? "已关闭当前 OAuth 页面" : "当前 OAuth 页面未关闭或已不存在"
        }`
      }
    }

    oauthAttemptCount += 1
    const nextRefreshResult = await runner.refreshRegisterOAuthAndLogin(
      cpaUrl,
      cpaManagementKey,
      phoneTabId
    )
    if (
      !nextRefreshResult.ok ||
      typeof nextRefreshResult.targetTab?.id !== "number"
    ) {
      return {
        ok: false,
        message: `${phoneResult.message}；${nextRefreshResult.message}`
      }
    }

    const nextLoginResult = await runner.completeRegisterOAuthLogin(
      nextRefreshResult.targetTab.id,
      account.email,
      account.password,
      cpaUrl,
      cpaManagementKey
    )
    if (
      !nextLoginResult.ok ||
      typeof nextLoginResult.targetTab?.id !== "number"
    ) {
      return {
        ok: false,
        message: `${phoneResult.message}；${nextRefreshResult.message}；${nextLoginResult.message}`
      }
    }

    phoneTabId = nextLoginResult.targetTab.id
    oauthStartedAt =
      nextLoginResult.oauthStartedAt ||
      nextRefreshResult.oauthStartedAt ||
      Date.now()
    cpaOAuthState =
      nextLoginResult.cpaOAuthState || nextRefreshResult.cpaOAuthState || ""
  }

  const callbackUrl =
    phoneResult.callbackUrl || phoneResult.targetTab?.url || ""
  if (!callbackUrl) {
    onStage(6, phoneResult.message)
    return {
      ok: false,
      needsReview: true,
      message: `${phoneResult.message}；步骤 6 未返回 OAuth 回调地址，无法判断手机号验证结果；为避免重复消耗手机号，请人工检查`
    }
  }
  messages.push(phoneResult.message)
  onStage(6, phoneResult.message)

  if (getStopStrategy() === "after_phone") {
    return {
      ok: false,
      needsReview: true,
      message:
        "当前手机号验证已结束并按停止策略停止；手机号可能已经验证成功，但 CPA 尚未回填，请人工处理"
    }
  }

  const step7Result = await runner.submitRegisterOAuthCallbackToCpa(
    cpaUrl,
    cpaManagementKey,
    callbackUrl,
    phoneTabId,
    cpaOAuthState
  )
  if (!step7Result.ok) {
    onStage(7, step7Result.message || "CPA 回填失败")
    return {
      ok: false,
      needsReview: true,
      message: `CPA 回填失败；手机号验证码已提交，手机号验证可能已经完成，请人工处理 CPA 回填；${step7Result.message || "步骤 7 执行失败"}`
    }
  }
  messages.push(step7Result.message)
  onStage(7, step7Result.message)

  return {
    ok: true,
    message: messages.filter(Boolean).join("；")
  }
}

const isRegisterAccountDone = (account: ManagedAccount) => {
  return account.status === "done" || account.progress >= REGISTER_STEP_COUNT
}

export function CodexRegisterPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: REGISTER_STORAGE_KEYS,
    log,
    setStatus
  })
  const {
    accounts,
    cpaManagementKey,
    cpaUrl,
    selectedEmails,
    selectedEmailSet,
    selectedCount,
    setAccounts,
    syncAccounts,
    patchAccountState,
    setRunningEmail
  } = accountPage
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [debugEmail, setDebugEmail] = useState("")
  const [debugRegisterTabId, setDebugRegisterTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [debugOAuthStartedAt, setDebugOAuthStartedAt] = useState(0)
  const [debugCpaOAuthState, setDebugCpaOAuthState] = useState("")
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const heroSms = useHeroSmsConfig({ log, setStatus })
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchStopping, setIsBatchStopping] = useState(false)
  const [isStopStrategyModalOpen, setIsStopStrategyModalOpen] = useState(false)
  const batchCancelRef = useRef(false)
  const batchAbortControllerRef = useRef<AbortController | null>(null)
  const batchStopStrategyRef = useRef<RegisterStopStrategy>("none")
  const isWaitingForPhoneCodeRef = useRef(false)
  const isManualPhoneStopRef = useRef(false)

  const selectedDebugAccount = useMemo(() => {
    const normalizedDebugEmail = normalizeEmail(debugEmail)
    return (
      accounts.find((account) => {
        return normalizeEmail(account.email) === normalizedDebugEmail
      }) || null
    )
  }, [accounts, debugEmail])

  useEffect(() => {
    if (accounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugEmail = normalizeEmail(debugEmail)
    const hasCurrentDebugAccount = accounts.some((account) => {
      return normalizeEmail(account.email) === currentDebugEmail
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(accounts[0].email)
    }
  }, [accounts, debugEmail])

  useEffect(() => {
    onBusyChange?.(isBatchRunning || isDebugRunning)
    return () => {
      onBusyChange?.(false)
    }
  }, [isBatchRunning, isDebugRunning, onBusyChange])

  const handleOpenRegisterEntry = async () => {
    if (isDebugRunning) {
      return
    }

    setIsDebugRunning(true)
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
    setDebugVerificationRequestedAt(0)
    setDebugOAuthStartedAt(0)
    setDebugCpaOAuthState("")
    setDebugCallbackUrl("")
    setStatus("注册调试状态已清空")
  }

  const runRegisterDebugStep = async (options: RegisterDebugStepOptions) => {
    if (isDebugRunning || !selectedDebugAccount) {
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

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus(options.runningStatus)
    log.info(
      `[注册调试][${selectedDebugAccount.email}] Step ${options.step} 开始`
    )
    options.beforeRun?.()
    patchAccountState(selectedDebugAccount.email, {
      progress: options.runningProgress,
      status: "running",
      lastMessage: options.runningMessage
    })

    try {
      const result = await options.action(parsedTabId)

      if (!result.ok) {
        setStatus(options.failureStatus)
        log.warn(`[注册调试][${selectedDebugAccount.email}] ${result.message}`)
        patchAccountState(selectedDebugAccount.email, {
          status: "failed",
          lastMessage: result.message
        })
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || parsedTabId))
      setDebugProgress(options.successProgress)
      setStatus(options.successStatus)
      log.info(
        `[注册调试][${selectedDebugAccount.email}] Step ${options.step} ${result.message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(selectedDebugAccount.email, {
        progress: options.successProgress,
        status: options.successAccountStatus,
        lastMessage: result.message
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : options.exceptionMessage
      setStatus(options.exceptionStatus)
      log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
      patchAccountState(selectedDebugAccount.email, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
    }
  }

  const handleSubmitRegisterEmail = async () => {
    const verificationRequestedAt = Date.now()
    await runRegisterDebugStep({
      step: 2,
      runningStatus: `正在提交注册邮箱 ${selectedDebugAccount?.email || ""}`,
      runningMessage: "正在点击注册并提交邮箱",
      runningProgress: 1,
      beforeRun: () => {
        setDebugVerificationRequestedAt(verificationRequestedAt)
      },
      action: (tabId) => {
        return clickRegisterAndSubmitEmail(
          selectedDebugAccount?.email || "",
          tabId
        )
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
    await runRegisterDebugStep({
      step: 3,
      runningStatus: `正在读取并提交验证码 ${selectedDebugAccount?.email || ""}`,
      runningMessage: "正在读取并提交验证码",
      runningProgress: 2,
      action: (tabId) => {
        return fetchAndSubmitRegisterVerificationCode(
          tabId,
          selectedDebugAccount?.email || "",
          selectedDebugAccount?.password || "",
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
      runningStatus: "正在完成账户创建",
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
      failureStatus: "完成账户创建失败",
      successStatus: "已完成账户创建并点击继续",
      successProgress: 4,
      successAccountStatus: "running",
      exceptionStatus: "完成账户创建异常",
      exceptionMessage: "完成账户创建异常"
    })
  }

  const handleCompleteRegisterOAuthLogin = async () => {
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()

    if (isDebugRunning || !selectedDebugAccount) {
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

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus("正在完成 OAuth 登录")
    log.info(`[注册调试][${selectedDebugAccount.email}] Step 5 开始`)
    patchAccountState(selectedDebugAccount.email, {
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
        log.warn(
          `[注册调试][${selectedDebugAccount.email}] ${refreshResult.message}`
        )
        patchAccountState(selectedDebugAccount.email, {
          status: "failed",
          lastMessage: refreshResult.message
        })
        return
      }

      const result = await completeRegisterOAuthLogin(
        refreshResult.targetTab.id,
        selectedDebugAccount.email,
        selectedDebugAccount.password,
        normalizedCpaUrl,
        normalizedCpaManagementKey
      )
      const message = `${refreshResult.message}；${result.message}`

      if (!result.ok) {
        setStatus("OAuth 登录失败")
        log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
        patchAccountState(selectedDebugAccount.email, {
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
        `[注册调试][${selectedDebugAccount.email}] Step 5 ${message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(selectedDebugAccount.email, {
        progress: 5,
        status: "running",
        lastMessage: message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth 登录异常"
      setStatus("OAuth 登录异常")
      log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
      patchAccountState(selectedDebugAccount.email, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
    }
  }

  const handleCompleteRegisterPhoneVerification = async () => {
    const heroSmsOptions = heroSms.buildOptions()
    if (!heroSmsOptions) {
      return
    }

    if (isDebugRunning || !selectedDebugAccount) {
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    if (!Number.isFinite(parsedTabId) || parsedTabId <= 0) {
      setStatus("请先执行 Step 5 完成 OAuth 登录")
      log.warn("[注册调试] Step 6 缺少注册 tabId，请先执行 Step 5")
      return
    }

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus("正在执行手机号验证")
    log.info(`[注册调试][${selectedDebugAccount.email}] Step 6 开始`)
    patchAccountState(selectedDebugAccount.email, {
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
            `[注册调试][${selectedDebugAccount.email}] Step 6 ${
              result.message
            }；tab=${result.targetTab?.id || "unknown"}；url=${
              result.targetTab?.url || "unknown"
            }`
          )
          patchAccountState(selectedDebugAccount.email, {
            progress: 6,
            status: "running",
            lastMessage: result.message
          })
          return
        }

        if (!result.needRefreshOAuth) {
          if (result.needsManualReview) {
            setStatus("手机号验证结果需要人工判断")
            log.warn(
              `[注册调试][${selectedDebugAccount.email}] ${result.message}`
            )
            patchAccountState(selectedDebugAccount.email, {
              progress: 6,
              status: "needs_review",
              lastMessage: `${result.message}；手机号验证码已经提交但跳转结果无法判断，为避免重复浪费手机号，请人工检查`
            })
            return
          }

          setStatus("手机号验证失败")
          log.warn(
            `[注册调试][${selectedDebugAccount.email}] ${result.message}`
          )
          patchAccountState(selectedDebugAccount.email, {
            status: "failed",
            lastMessage: result.message
          })
          return
        }

        if (oauthAttemptCount >= REGISTER_PHONE_MAX_OAUTH_ATTEMPTS) {
          const closedAuthTab = await closeTabQuietly(tabId)
          const message = `${result.message}；已达到 OAuth URL 获取上限 ${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS} 次；${
            closedAuthTab ? "已关闭当前 OAuth 页面" : "当前 OAuth 页面未关闭或已不存在"
          }`
          setStatus("手机号验证失败")
          log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
          patchAccountState(selectedDebugAccount.email, {
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
          log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
          patchAccountState(selectedDebugAccount.email, {
            status: "failed",
            lastMessage: message
          })
          return
        }

        oauthAttemptCount += 1
        setStatus("OAuth 时间不足，正在重新执行 Step 5")
        log.warn(
          `[注册调试][${selectedDebugAccount.email}] ${result.message}；正在重新执行 Step 5（OAuth URL ${oauthAttemptCount}/${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS}）`
        )
        patchAccountState(selectedDebugAccount.email, {
          progress: 5,
          status: "running",
          lastMessage: "OAuth 时间不足，正在重新执行 Step 5"
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
          log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
          patchAccountState(selectedDebugAccount.email, {
            status: "failed",
            lastMessage: message
          })
          return
        }

        const loginResult = await completeRegisterOAuthLogin(
          refreshResult.targetTab.id,
          selectedDebugAccount.email,
          selectedDebugAccount.password,
          normalizedCpaUrl,
          normalizedCpaManagementKey
        )
        const step5Message = `${refreshResult.message}；${loginResult.message}`
        if (!loginResult.ok || typeof loginResult.targetTab?.id !== "number") {
          setStatus("OAuth 登录失败")
          log.warn(`[注册调试][${selectedDebugAccount.email}] ${step5Message}`)
          patchAccountState(selectedDebugAccount.email, {
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
      log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
      patchAccountState(selectedDebugAccount.email, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
    }
  }

  const handleSubmitRegisterOAuthCallbackToCpa = async () => {
    if (isDebugRunning || !selectedDebugAccount) {
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

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus("正在回填 CPA")
    log.info(`[注册调试][${selectedDebugAccount.email}] Step 7 开始`)
    patchAccountState(selectedDebugAccount.email, {
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
        log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
        patchAccountState(selectedDebugAccount.email, {
          progress: 7,
          status: "needs_review",
          lastMessage: message
        })
        return
      }

      setDebugProgress(REGISTER_STEP_COUNT)
      setStatus("已完成 CPA 回填")
      log.info(
        `[注册调试][${selectedDebugAccount.email}] Step 7 ${result.message}`
      )
      patchAccountState(selectedDebugAccount.email, {
        progress: REGISTER_STEP_COUNT as ManagedAccountProgress,
        status: "done",
        lastMessage: result.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "CPA 回填异常"
      setStatus("CPA 回填异常")
      log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
      patchAccountState(selectedDebugAccount.email, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
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

    if (isBatchRunning || isDebugRunning) {
      return
    }

    if (selectedEmails.length === 0) {
      setStatus("请先选择要执行的账号")
      log.info("请先选择要执行的账号")
      return
    }

    const heroSmsOptions = heroSms.buildOptions("注册执行", (phase) => {
      isWaitingForPhoneCodeRef.current = phase === "phone_submitted"
    })
    if (!heroSmsOptions) {
      return
    }

    const isTargetAccount = (account: ManagedAccount) => {
      return (
        selectedEmailSet.has(normalizeEmail(account.email)) &&
        !isRegisterAccountDone(account) &&
        account.status !== "needs_review"
      )
    }
    const runnableCount = accounts.filter(isTargetAccount).length
    if (runnableCount === 0) {
      const emptyMessage = "选中的账号没有可执行项"
      setStatus(emptyMessage)
      log.info(emptyMessage)
      return
    }

    batchCancelRef.current = false
    batchStopStrategyRef.current = "none"
    isWaitingForPhoneCodeRef.current = false
    isManualPhoneStopRef.current = false
    setIsBatchStopping(false)
    setIsStopStrategyModalOpen(false)
    const batchAbortController = new AbortController()
    batchAbortControllerRef.current = batchAbortController
    const registerRunner = createCodexRegisterRunner({
      abortSignal: batchAbortController.signal
    })
    setIsBatchRunning(true)
    setRunningEmail("")

    let workingAccounts = accounts.map((account) => {
      if (!isTargetAccount(account)) {
        return account
      }

      return account.progress < 4 ? resetManagedAccountState(account) : account
    })
    syncAccounts(workingAccounts, normalizedCpaUrl, normalizedCpaManagementKey)

    const batchLabel = "选中账号"
    setStatus(`开始执行 ${runnableCount} 个${batchLabel}`)
    log.info(`开始执行 ${runnableCount} 个${batchLabel}`)

    let currentRunnableIndex = 0
    for (let index = 0; index < workingAccounts.length; index += 1) {
      if (batchCancelRef.current) {
        setStatus("已停止批量执行")
        log.warn("批量执行已停止")
        break
      }

      const currentAccount = workingAccounts[index]
      if (!isTargetAccount(currentAccount)) {
        continue
      }

      currentRunnableIndex += 1
      setRunningEmail(currentAccount.email)
      setStatus(
        `正在处理 ${currentAccount.email}（${currentRunnableIndex}/${runnableCount}）`
      )
      log.info(`开始处理账号 ${currentAccount.email}`)

      const updateCurrentAccount = (
        patch: Partial<ManagedAccount>
      ): ManagedAccount[] => {
        const nextAccounts = [...workingAccounts]
        nextAccounts[index] = {
          ...nextAccounts[index],
          ...patch,
          updatedAt: Date.now()
        }
        workingAccounts = nextAccounts
        setAccounts(nextAccounts)
        syncAccounts(nextAccounts, normalizedCpaUrl, normalizedCpaManagementKey)
        return nextAccounts
      }

      updateCurrentAccount({
        status: "running",
        lastMessage: "正在打开 GPT 注册页"
      })

      let runResult: AccountRunResult
      try {
        runResult = await runManagedRegisterFlow(
          normalizedCpaUrl,
          normalizedCpaManagementKey,
          currentAccount,
          heroSmsOptions,
          registerRunner,
          () => batchStopStrategyRef.current,
          (progress, message) => {
            const nextStatus: ManagedAccountStatus =
              progress === REGISTER_STEP_COUNT ? "done" : "running"
            updateCurrentAccount({
              progress,
              status: nextStatus,
              lastMessage: message
            })
            setStatus(`账号 ${currentAccount.email} 已完成 Step ${progress}`)
            log.info(`[${currentAccount.email}] ${message}`)
          }
        )
      } catch (error) {
        runResult = {
          ok: false,
          message:
            error instanceof Error ? error.message : "账号自动注册时发生异常"
        }
      }

      if (batchCancelRef.current) {
        const currentState = workingAccounts[index]
        updateCurrentAccount({
          progress: isManualPhoneStopRef.current ? 6 : currentState.progress,
          status: isManualPhoneStopRef.current ? "needs_review" : "failed",
          lastMessage: isManualPhoneStopRef.current
            ? "已直接停止，当前手机号验证码由人工负责"
            : runResult.message || "已停止当前流程"
        })
        setStatus("已停止当前流程")
        log.warn(
          `[${currentAccount.email}] ${runResult.message || "已停止当前流程"}`
        )
        break
      }

      if (runResult.ok) {
        updateCurrentAccount({
          progress: REGISTER_STEP_COUNT,
          status: "done",
          lastMessage: runResult.message
        })
        log.info(`[${currentAccount.email}] ${runResult.message}`)
        if (batchStopStrategyRef.current !== "none") {
          break
        }
        continue
      }

      const currentState = workingAccounts[index]
      if (runResult.needsReview) {
        updateCurrentAccount({
          progress: currentState.progress,
          status: "needs_review",
          lastMessage: runResult.message
        })
        setStatus(`账号 ${currentAccount.email} 需要人工判断`)
        log.warn(`[${currentAccount.email}] ${runResult.message}`)
        if (batchStopStrategyRef.current !== "none") {
          break
        }
        continue
      }

      updateCurrentAccount({
        progress: currentState.progress,
        status: "failed",
        lastMessage: runResult.message
      })
      setStatus(`账号 ${currentAccount.email} 执行失败`)
      log.warn(`[${currentAccount.email}] ${runResult.message}`)
      if (batchStopStrategyRef.current !== "none") {
        break
      }
    }

    setRunningEmail("")
    setIsBatchRunning(false)
    setIsBatchStopping(false)
    setIsStopStrategyModalOpen(false)
    isWaitingForPhoneCodeRef.current = false
    isManualPhoneStopRef.current = false
    batchAbortControllerRef.current = null
    setStatus(
      batchCancelRef.current || batchStopStrategyRef.current !== "none"
        ? "已停止批量执行"
        : `${batchLabel}执行已结束`
    )
    batchStopStrategyRef.current = "none"
  }

  const handleStopBatch = () => {
    if (isBatchStopping) {
      return
    }

    if (isWaitingForPhoneCodeRef.current) {
      setIsStopStrategyModalOpen(true)
      return
    }

    batchStopStrategyRef.current = "immediate"
    isManualPhoneStopRef.current = false
    setIsBatchStopping(true)
    batchCancelRef.current = true
    batchAbortControllerRef.current?.abort()
    setStatus("正在停止当前流程")
    log.warn("收到停止请求，等待当前步骤结束")
  }

  const handleChooseStopStrategy = (strategy: RegisterStopStrategy) => {
    setIsStopStrategyModalOpen(false)
    batchStopStrategyRef.current = strategy
    setIsBatchStopping(true)

    if (strategy === "immediate") {
      isManualPhoneStopRef.current = true
      batchCancelRef.current = true
      batchAbortControllerRef.current?.abort()
      setStatus("正在立即停止，当前手机号后续由人工处理")
      log.warn("已选择立即停止，当前手机号验证码由人工处理")
      return
    }

    setStatus("已设置停止策略，等待当前手机号验证结束")
    log.warn(
      strategy === "after_phone"
        ? "已选择当前手机号验证结束后停止"
        : "已选择当前手机号失败则停止，成功则完成 CPA 回填后停止"
    )
  }

  const disabled = isBatchRunning || isDebugRunning
  const hasBatchConfig = Boolean(
    cpaUrl.trim() && cpaManagementKey.trim() && heroSms.hasRequiredConfig
  )

  return (
    <>
      <Modal
        title="当前正在等待手机号验证码"
        open={isStopStrategyModalOpen}
        closable={false}
        mask={{ closable: false }}
        footer={[
          <Button
            key="immediate"
            danger
            onClick={() => {
              handleChooseStopStrategy("immediate")
            }}>
            直接停止
          </Button>,
          <Button
            key="after-phone"
            onClick={() => {
              handleChooseStopStrategy("after_phone")
            }}>
            手机号结束后停止
          </Button>,
          <Button
            key="finish"
            type="primary"
            onClick={() => {
              handleChooseStopStrategy("finish_current_if_phone_success")
            }}>
            成功则完成回填
          </Button>
        ]}>
        <div>
          <p>
            当前手机号已经提交，正在等待验证码。直接停止会把当前手机号后续处理交给你人工负责。
          </p>
          <p>
            推荐选择“成功则完成回填”：如果当前手机号失败就停止；如果验证成功，就完成
            CPA 回填后停止。
          </p>
        </div>
      </Modal>
      <AccountListPanel
        accountPage={accountPage}
        disabled={disabled}
        stepCount={REGISTER_STEP_COUNT}
        stepLabels={REGISTER_FLOW_STEPS}
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
              disabled={!hasBatchConfig || selectedCount === 0}
              onClick={() => {
                void handleStartBatch()
              }}>
              执行
            </Button>
          )
        }
      />

      <HeroSmsConfigPanel heroSms={heroSms} disabled={isDebugRunning} />

      <CpaConfigPanel
        cpaUrl={cpaUrl}
        cpaManagementKey={cpaManagementKey}
        disabled={disabled}
        onCpaUrlChange={accountPage.handleCpaUrlChange}
        onCpaManagementKeyChange={accountPage.handleCpaManagementKeyChange}
      />

      <AccountFormPanel accountPage={accountPage} disabled={disabled} />

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
                <DebugTabControl
                  disabled={isDebugRunning}
                  label="注册 tab"
                  leadingContent={
                    <div className="debug-field">
                      <span className="debug-label">账号</span>
                      <Select
                        value={debugEmail || undefined}
                        placeholder="选择账号"
                        options={accounts.map((account) => {
                          return {
                            label: account.email,
                            value: account.email
                          }
                        })}
                        onChange={(value) => {
                          setDebugEmail(value)
                          setDebugProgress(0)
                          setDebugVerificationRequestedAt(0)
                          setDebugOAuthStartedAt(0)
                          setDebugCpaOAuthState("")
                          setDebugCallbackUrl("")
                        }}
                        disabled={isDebugRunning || accounts.length === 0}
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
                    type="primary"
                    onClick={() => {
                      void handleOpenRegisterEntry()
                    }}
                    loading={isDebugRunning}
                    disabled={isDebugRunning}>
                    1 打开 GPT 页面
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSubmitRegisterEmail()
                    }}
                    loading={isDebugRunning}
                    disabled={isDebugRunning || !selectedDebugAccount}>
                    2 点击注册并提交邮箱
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSubmitRegisterVerificationCode()
                    }}
                    loading={isDebugRunning}
                    disabled={isDebugRunning || !selectedDebugAccount}>
                    3 提交验证码
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSubmitRegisterProfile()
                    }}
                    loading={isDebugRunning}
                    disabled={isDebugRunning || !selectedDebugAccount}>
                    4 完成账户创建并继续
                  </Button>
                  <Button
                    onClick={() => {
                      void handleCompleteRegisterOAuthLogin()
                    }}
                    loading={isDebugRunning}
                    disabled={
                      isDebugRunning ||
                      !selectedDebugAccount ||
                      !cpaUrl.trim() ||
                      !cpaManagementKey.trim()
                    }>
                    5 完成 OAuth 登录
                  </Button>
                  <Button
                    onClick={() => {
                      void handleCompleteRegisterPhoneVerification()
                    }}
                    loading={isDebugRunning}
                    disabled={isDebugRunning || !selectedDebugAccount}>
                    6 手机号验证
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSubmitRegisterOAuthCallbackToCpa()
                    }}
                    loading={isDebugRunning}
                    disabled={
                      isDebugRunning ||
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
