import { createCodexRegisterRunner } from "./codex-register"
import type { HeroSmsPhoneVerificationOptions } from "./register-phone-verification"
import {
  normalizeEmail,
  resetManagedAccountState,
  type AccountRunResult,
  type ManagedAccount,
  type ManagedAccountProgress,
  type ManagedAccountStatus
} from "../sidepanel/shared"

export const REGISTER_STEP_COUNT = 7
const REGISTER_PHONE_MAX_OAUTH_ATTEMPTS = 3

export type RegisterStopStrategy =
  | "none"
  | "immediate"
  | "after_phone"
  | "finish_current_if_phone_success"

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

type RunRegisterBatchOptions = {
  cpaUrl: string
  cpaManagementKey: string
  accounts: ManagedAccount[]
  selectedEmails?: string[]
  heroSmsOptions: HeroSmsPhoneVerificationOptions
  abortSignal?: AbortSignal
  targetAllWhenNoSelection?: boolean
  getStopStrategy?: () => RegisterStopStrategy
  isManualPhoneStop?: () => boolean
  shouldCancel?: () => boolean
  onAccountsChange?: (accounts: ManagedAccount[]) => void
  onLog?: (level: "info" | "warn", message: string) => void
  onRunningEmail?: (email: string) => void
  onStatus?: (message: string) => void
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

export const runManagedRegisterFlow = async (
  cpaUrl: string,
  cpaManagementKey: string,
  account: ManagedAccount,
  heroSmsOptions: HeroSmsPhoneVerificationOptions,
  runner: ReturnType<typeof createCodexRegisterRunner>,
  getStopStrategy: () => RegisterStopStrategy,
  onStage: (progress: ManagedAccountProgress, message: string) => void,
  onProgressLog?: (message: string) => void
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
      verificationRequestedAt,
      (message) => {
        onStage(2, message)
      }
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
    const continueResult = await runner.clickRegisterReadyContinue(registerTabId)
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
    cpaManagementKey,
    onProgressLog
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
  onProgressLog?.("Step 5 已完成，准备开始 Step 6 手机号验证")

  let phoneTabId = loginResult.targetTab.id
  let oauthStartedAt =
    loginResult.oauthStartedAt || refreshResult.oauthStartedAt || Date.now()
  let cpaOAuthState =
    loginResult.cpaOAuthState || refreshResult.cpaOAuthState || ""
  let oauthAttemptCount = 1
  let phoneResult: RegisterStepResult

  while (true) {
    onProgressLog?.(`Step 6 第 ${oauthAttemptCount} 轮：开始手机号验证`)
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
      cpaManagementKey,
      onProgressLog
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

  const callbackUrl = phoneResult.callbackUrl || phoneResult.targetTab?.url || ""
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

export const runRegisterBatch = async ({
  cpaUrl,
  cpaManagementKey,
  accounts,
  selectedEmails = [],
  heroSmsOptions,
  abortSignal,
  targetAllWhenNoSelection = false,
  getStopStrategy = () => "none",
  isManualPhoneStop = () => false,
  shouldCancel = () => false,
  onAccountsChange,
  onLog,
  onRunningEmail,
  onStatus
}: RunRegisterBatchOptions) => {
  const selectedEmailSet = new Set(selectedEmails.map((email) => normalizeEmail(email)))
  const shouldUseAllTargets = targetAllWhenNoSelection && selectedEmailSet.size === 0
  const isTargetAccount = (account: ManagedAccount) => {
    return (
      (shouldUseAllTargets || selectedEmailSet.has(normalizeEmail(account.email))) &&
      account.status !== "needs_review" &&
      account.status !== "done" &&
      account.progress < REGISTER_STEP_COUNT
    )
  }
  const runnableCount = accounts.filter(isTargetAccount).length
  if (runnableCount === 0) {
    return {
      accounts,
      cancelled: false,
      processedCount: 0,
      runnableCount,
      message: "没有可执行的注册账号"
    }
  }

  const registerRunner = createCodexRegisterRunner({ abortSignal })
  let workingAccounts = accounts.map((account) => {
    if (!isTargetAccount(account)) {
      return account
    }

    return account.progress < 4 ? resetManagedAccountState(account) : account
  })
  onAccountsChange?.(workingAccounts)

  let currentRunnableIndex = 0
  let cancelled = false
  for (let index = 0; index < workingAccounts.length; index += 1) {
    if (shouldCancel()) {
      cancelled = true
      onStatus?.("已停止批量执行")
      onLog?.("warn", "批量执行已停止")
      break
    }

    const currentAccount = workingAccounts[index]
    if (!isTargetAccount(currentAccount)) {
      continue
    }

    const resumeStep = currentAccount.progress >= 4 ? 5 : 1
    currentRunnableIndex += 1
    onRunningEmail?.(currentAccount.email)
    onStatus?.(
      `正在处理 ${currentAccount.email}（${currentRunnableIndex}/${runnableCount}）`
    )
    onLog?.("info", `开始处理账号 ${currentAccount.email}`)
    onLog?.(
      "info",
      `[${currentAccount.email}] 当前标记进度 ${currentAccount.progress}/${REGISTER_STEP_COUNT}，将从 Step ${resumeStep} 开始执行`
    )

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
      onAccountsChange?.(nextAccounts)
      return nextAccounts
    }

    updateCurrentAccount({
      status: "running",
      lastMessage:
        resumeStep === 1
          ? "正在打开 GPT 注册页"
          : "正在刷新 OAuth 并进入手机号验证阶段"
    })

    let runResult: AccountRunResult
    try {
      runResult = await runManagedRegisterFlow(
        cpaUrl,
        cpaManagementKey,
        currentAccount,
        heroSmsOptions,
        registerRunner,
        getStopStrategy,
        (progress, message) => {
          const nextStatus: ManagedAccountStatus =
            progress === REGISTER_STEP_COUNT ? "done" : "running"
          updateCurrentAccount({
            progress,
            status: nextStatus,
            lastMessage: message
          })
          onStatus?.(`账号 ${currentAccount.email} 已完成 Step ${progress}`)
          onLog?.("info", `[${currentAccount.email}] ${message}`)
        },
        (message) => {
          updateCurrentAccount({
            status: "running",
            lastMessage: message
          })
          onLog?.("info", `[${currentAccount.email}] ${message}`)
        }
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "账号自动注册时发生异常"
      onLog?.("warn", `[${currentAccount.email}] 账号自动注册异常：${message}`)
      runResult = {
        ok: false,
        message
      }
    }

    if (shouldCancel()) {
      const currentState = workingAccounts[index]
      updateCurrentAccount({
        progress: isManualPhoneStop() ? 6 : currentState.progress,
        status: isManualPhoneStop() ? "needs_review" : "failed",
        lastMessage: isManualPhoneStop()
          ? "已直接停止，当前手机号验证码由人工负责"
          : runResult.message || "已停止当前流程"
      })
      cancelled = true
      onStatus?.("已停止当前流程")
      onLog?.(
        "warn",
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
      onLog?.("info", `[${currentAccount.email}] ${runResult.message}`)
      onLog?.("info", `========== 流程成功完成：${currentAccount.email} ==========`)
      if (getStopStrategy() !== "none") {
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
      onStatus?.(`账号 ${currentAccount.email} 需要人工判断`)
      onLog?.("warn", `[${currentAccount.email}] ${runResult.message}`)
      if (getStopStrategy() !== "none") {
        break
      }
      continue
    }

    updateCurrentAccount({
      progress: currentState.progress,
      status: "failed",
      lastMessage: runResult.message
    })
    onStatus?.(`账号 ${currentAccount.email} 执行失败`)
    onLog?.("warn", `[${currentAccount.email}] ${runResult.message}`)
    if (getStopStrategy() !== "none") {
      break
    }
  }

  onRunningEmail?.("")

  return {
    accounts: workingAccounts,
    cancelled,
    processedCount: currentRunnableIndex,
    runnableCount,
    message: cancelled ? "已停止批量执行" : "注册批量执行已结束"
  }
}
