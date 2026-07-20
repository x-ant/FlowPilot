import {
  buildAccountInvalidLastMessage,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  resetManagedAccountState,
  type AccountRunResult,
  type ManagedAccount,
  type ManagedAccountProgress,
  type ManagedAccountStatus
} from "../../shared/account-state"
import type {
  OAuthBinding,
  OAuthIntegrationConfig
} from "../../shared/oauth-integration"
import type { RegisterStopStrategy } from "../../shared/runtime-messages"
import { abortableSleep } from "../utils/abort"
import type { HeroSmsPhoneVerificationOptions } from "./phone-verification"
import { createCodexRegisterRunner } from "./steps"

export const REGISTER_STEP_COUNT = 7
const REGISTER_PHONE_MAX_OAUTH_ATTEMPTS = 3
const DEFAULT_ACCOUNT_INTERVAL_MIN_SECONDS = 240
const DEFAULT_ACCOUNT_INTERVAL_MAX_SECONDS = 600

export type { RegisterStopStrategy } from "../../shared/runtime-messages"

export type RegisterFlowRunner = ReturnType<typeof createCodexRegisterRunner>

type RegisterStepResult = {
  ok: boolean
  message: string
  needRefreshOAuth?: boolean
  needsManualReview?: boolean
  oauthStartedAt?: number
  oauthBinding?: OAuthBinding
  callbackUrl?: string
  targetTab?: {
    id?: number
    url?: string
  }
}

type RunRegisterBatchOptions = {
  integration: OAuthIntegrationConfig
  accounts: ManagedAccount[]
  selectedEmails?: string[]
  heroSmsOptions: HeroSmsPhoneVerificationOptions
  abortSignal?: AbortSignal
  allowInvalidWhenSelected?: boolean
  accountIntervalMinSeconds?: number
  accountIntervalMaxSeconds?: number
  targetAllWhenNoSelection?: boolean
  getStopStrategy?: () => RegisterStopStrategy
  isManualPhoneStop?: () => boolean
  shouldCancel?: () => boolean
  runner?: RegisterFlowRunner
  onAccountsChange?: (accounts: ManagedAccount[]) => void
  onLog?: (level: "info" | "warn", message: string) => void
  onRunningEmail?: (email: string) => void
  onStatus?: (message: string) => void
}

/**
 * 安静关闭指定标签页。
 *
 * @param tabId 要关闭的标签页 ID；为空时直接返回 false。
 * @return 关闭成功返回 true，标签页不存在或关闭失败返回 false。
 */
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

/**
 * 生成两个注册账号之间的随机等待时间。
 *
 * 连续快速注册容易触发邮箱或 OpenAI 风控；这里按自动触发配置生成等待，
 * 只用于账号与账号之间，不影响单个账号内部步骤。
 *
 * @param minSeconds 最小等待秒数。
 * @param maxSeconds 最大等待秒数。
 * @return 随机等待毫秒数。
 */
const createRegisterAccountIntervalMs = (
  minSeconds = DEFAULT_ACCOUNT_INTERVAL_MIN_SECONDS,
  maxSeconds = DEFAULT_ACCOUNT_INTERVAL_MAX_SECONDS
) => {
  const minMs = Math.max(0, Math.floor(minSeconds)) * 1000
  const maxMs = Math.max(minMs, Math.floor(maxSeconds) * 1000)
  return minMs + Math.floor(Math.random() * (maxMs - minMs))
}

/**
 * 格式化账号间隔等待时长，便于日志展示。
 *
 * @param durationMs 等待毫秒数。
 * @return `x 分 y 秒` 格式的时长。
 */
const formatRegisterAccountInterval = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
}

/**
 * 执行单个账号的完整注册流程。
 *
 * Step 2 只使用账号列表里保存的注册邮箱，不在批量流程中生成邮箱。
 *
 * @param integration CPA 或 Sub2API 接入参数。
 * @param account 当前要执行的账号。
 * @param heroSmsOptions HeroSMS 接码配置。
 * @param runner 注册流程 runner。
 * @param getStopStrategy 获取当前停止策略的函数。
 * @param onStage 步骤完成回调，用于更新账号进度。
 * @param onProgressLog 细粒度日志回调。
 * @param onAccountPrepared 注册邮箱校验完成回调，用于同步账号快照。
 * @return 单账号注册执行结果。
 */
export const runManagedRegisterFlow = async (
  integration: OAuthIntegrationConfig,
  account: ManagedAccount,
  heroSmsOptions: HeroSmsPhoneVerificationOptions,
  runner: RegisterFlowRunner,
  getStopStrategy: () => RegisterStopStrategy,
  onStage: (progress: ManagedAccountProgress, message: string) => void,
  onProgressLog?: (message: string) => void,
  onAccountPrepared?: (account: ManagedAccount) => void
): Promise<AccountRunResult> => {
  const messages: string[] = []
  const startFromStep = account.progress >= 4 ? 5 : 1
  let workingAccount = account
  let registerTabId: number | undefined

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

    registerTabId = step1Result.targetTab.id
    const verificationRequestedAt = Date.now()
    const preparedResult =
      await runner.prepareRegisterAccountEmail(workingAccount)
    if (!preparedResult.ok || !preparedResult.account?.email) {
      return {
        ok: false,
        message: preparedResult.message || "注册邮箱准备失败"
      }
    }
    workingAccount = preparedResult.account
    onAccountPrepared?.(workingAccount)
    onProgressLog?.(preparedResult.message)

    const step2Result = await runner.clickRegisterAndSubmitEmail(
      workingAccount.email,
      workingAccount.password,
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
      workingAccount,
      step2Result.verificationRequestedAt || verificationRequestedAt,
      (message) => {
        onStage(2, message)
      }
    )
    if (!step3Result.ok) {
      return {
        ok: false,
        accountInvalid: step3Result.accountInvalid,
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
    integration,
    registerTabId
  )
  if (!refreshResult.ok || typeof refreshResult.targetTab?.id !== "number") {
    return {
      ok: false,
      message: refreshResult.message || "步骤 5 执行失败"
    }
  }
  const loginResult = await runner.completeRegisterOAuthLogin(
    refreshResult.targetTab.id,
    workingAccount,
    integration,
    onProgressLog
  )
  const step5Message = `${refreshResult.message}；${loginResult.message}`
  if (!loginResult.ok || typeof loginResult.targetTab?.id !== "number") {
    return {
      ok: false,
      accountInvalid: loginResult.accountInvalid,
      message: step5Message || "步骤 5 执行失败"
    }
  }
  messages.push(step5Message)
  onStage(5, step5Message)
  onProgressLog?.("Step 5 已完成，准备开始 Step 6 手机号验证")

  let phoneTabId = loginResult.targetTab.id
  let oauthStartedAt =
    loginResult.oauthStartedAt || refreshResult.oauthStartedAt || Date.now()
  let oauthBinding = loginResult.oauthBinding || refreshResult.oauthBinding
  let oauthAttemptCount = 1
  let phoneResult: RegisterStepResult

  while (true) {
    onProgressLog?.(`Step 6 第 ${oauthAttemptCount} 轮：开始手机号验证`)
    phoneResult = await runner.completeRegisterPhoneVerification(
      phoneTabId,
      heroSmsOptions,
      oauthStartedAt,
      () => getStopStrategy() === "finish_current_if_phone_success"
    )

    if (phoneResult.ok) {
      break
    }

    if (!phoneResult.needRefreshOAuth) {
      if (phoneResult.needsManualReview) {
        onStage(6, phoneResult.message)
        return {
          ok: false,
          needsManualReview: true,
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
        message: `${phoneResult.message}；已按成功则完成回填停止策略停止，不再刷新 OAuth 或更换手机号`
      }
    }

    if (oauthAttemptCount >= REGISTER_PHONE_MAX_OAUTH_ATTEMPTS) {
      const closedAuthTab = await closeTabQuietly(phoneTabId)
      return {
        ok: false,
        message: `${phoneResult.message}；已达到 OAuth URL 获取上限 ${REGISTER_PHONE_MAX_OAUTH_ATTEMPTS} 次；${
          closedAuthTab
            ? "已关闭当前 OAuth 页面"
            : "当前 OAuth 页面未关闭或已不存在"
        }`
      }
    }

    oauthAttemptCount += 1
    const nextRefreshResult = await runner.refreshRegisterOAuthAndLogin(
      integration,
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
      workingAccount,
      integration,
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
    oauthBinding =
      nextLoginResult.oauthBinding || nextRefreshResult.oauthBinding
  }

  const callbackUrl =
    phoneResult.callbackUrl || phoneResult.targetTab?.url || ""
  if (!callbackUrl) {
    onStage(6, phoneResult.message)
    return {
      ok: false,
      needsManualReview: true,
      message: `${phoneResult.message}；步骤 6 未返回 OAuth 回调地址，无法判断手机号验证结果；为避免重复消耗手机号，请人工检查`
    }
  }
  messages.push(phoneResult.message)
  onStage(6, phoneResult.message)

  if (!oauthBinding) {
    return {
      ok: false,
      needsManualReview: true,
      message:
        "手机号验证已完成，但缺少 OAuth 来源绑定信息，请人工处理 callback"
    }
  }
  const step7Result = await runner.submitRegisterOAuthCallback(
    integration,
    oauthBinding,
    callbackUrl,
    phoneTabId,
    workingAccount.email
  )
  if (!step7Result.ok) {
    onStage(7, step7Result.message || "OAuth callback 提交失败")
    return {
      ok: false,
      needsManualReview: true,
      message: `OAuth callback 提交失败；手机号验证可能已经完成，请人工检查管理端；${step7Result.message || "步骤 7 执行失败"}`
    }
  }
  messages.push(step7Result.message)
  onStage(7, step7Result.message)

  return {
    ok: true,
    message: messages.filter(Boolean).join("；")
  }
}

/**
 * 执行注册账号批量流程。
 *
 * 该入口被侧边栏手动执行和后台自动任务复用，负责筛选目标账号、
 * 更新账号状态、写入日志，并复用账号列表里保存的注册邮箱。
 *
 * @param options 批量执行配置。
 * @param options.integration CPA 或 Sub2API 接入参数。
 * @param options.accounts 当前账号列表。
 * @param options.selectedEmails 要执行的账号 ID 列表；沿用旧字段名但内容是账号 ID。
 * @param options.heroSmsOptions HeroSMS 接码配置。
 * @param options.abortSignal 停止当前流程的中断信号。
 * @param options.allowInvalidWhenSelected 用户手动选中失效账号执行时允许重试；定时和单次触发不传。
 * @param options.accountIntervalMinSeconds 账号之间随机等待的最小秒数。
 * @param options.accountIntervalMaxSeconds 账号之间随机等待的最大秒数。
 * @param options.targetAllWhenNoSelection 没有选择账号时是否执行所有可执行账号。
 * @param options.getStopStrategy 获取当前停止策略的函数。
 * @param options.isManualPhoneStop 判断是否为人工接管手机号验证码的停止。
 * @param options.shouldCancel 判断是否需要立即取消批量流程。
 * @param options.runner 可选的注册流程 runner；生产环境省略，测试时可注入无外部调用实现。
 * @param options.onAccountsChange 账号列表变化回调。
 * @param options.onLog 执行日志回调。
 * @param options.onRunningEmail 当前运行账号 ID 回调；沿用旧字段名但内容是账号 ID。
 * @param options.onStatus 顶部状态文案回调。
 * @return 批量执行结果和最新账号列表。
 */
export const runRegisterBatch = async ({
  integration,
  accounts,
  selectedEmails = [],
  heroSmsOptions,
  abortSignal,
  allowInvalidWhenSelected = false,
  accountIntervalMinSeconds = DEFAULT_ACCOUNT_INTERVAL_MIN_SECONDS,
  accountIntervalMaxSeconds = DEFAULT_ACCOUNT_INTERVAL_MAX_SECONDS,
  targetAllWhenNoSelection = false,
  getStopStrategy = () => "none",
  isManualPhoneStop = () => false,
  shouldCancel = () => false,
  runner,
  onAccountsChange,
  onLog,
  onRunningEmail,
  onStatus
}: RunRegisterBatchOptions) => {
  const selectedEmailSet = new Set(selectedEmails)
  const shouldUseAllTargets =
    targetAllWhenNoSelection && selectedEmailSet.size === 0
  const isTargetAccount = (account: ManagedAccount) => {
    const accountKey = getManagedAccountKey(account)
    const isSelected = selectedEmailSet.has(accountKey)
    const canRetryInvalidAccount =
      allowInvalidWhenSelected && isSelected && account.status === "invalid"

    return (
      (shouldUseAllTargets || isSelected) &&
      account.status !== "needs_review" &&
      (account.status !== "invalid" || canRetryInvalidAccount) &&
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

  const registerRunner = runner || createCodexRegisterRunner({ abortSignal })
  let workingAccounts = accounts.map((account) => {
    if (!isTargetAccount(account)) {
      return account
    }

    return account.progress < 4 ? resetManagedAccountState(account) : account
  })
  onAccountsChange?.(workingAccounts)

  let currentRunnableIndex = 0
  let cancelled = false
  const hasNextRunnableAccount = (currentIndex: number) => {
    return workingAccounts.some((account, index) => {
      return index > currentIndex && isTargetAccount(account)
    })
  }
  const waitBeforeNextRunnableAccount = async (
    currentIndex: number,
    currentAccountLabel: string
  ) => {
    if (
      shouldCancel() ||
      getStopStrategy() !== "none" ||
      !hasNextRunnableAccount(currentIndex)
    ) {
      return true
    }

    const intervalMs = createRegisterAccountIntervalMs(
      accountIntervalMinSeconds,
      accountIntervalMaxSeconds
    )
    const intervalLabel = formatRegisterAccountInterval(intervalMs)
    onRunningEmail?.("")
    onStatus?.(`账号间隔中，等待 ${intervalLabel} 后处理下一个账号`)
    onLog?.(
      "info",
      `[${currentAccountLabel}] 已结束，账号间隔等待 ${intervalLabel} 后处理下一个账号`
    )

    try {
      await abortableSleep(intervalMs, abortSignal)
      return !shouldCancel()
    } catch {
      cancelled = true
      onStatus?.("已停止批量执行")
      onLog?.("warn", "账号间隔等待已停止")
      return false
    }
  }

  for (let index = 0; index < workingAccounts.length; index += 1) {
    if (shouldCancel()) {
      cancelled = true
      onStatus?.("已停止批量执行")
      onLog?.("warn", "批量执行已停止")
      break
    }

    const currentAccount = workingAccounts[index]
    const currentAccountKey = getManagedAccountKey(currentAccount)
    const currentAccountLabel = getManagedAccountDisplayLabel(currentAccount)
    if (!isTargetAccount(currentAccount)) {
      continue
    }

    const resumeStep = currentAccount.progress >= 4 ? 5 : 1
    currentRunnableIndex += 1
    onRunningEmail?.(currentAccountKey)
    onStatus?.(
      `正在处理 ${currentAccountLabel}（${currentRunnableIndex}/${runnableCount}）`
    )
    onLog?.("info", `开始处理账号 ${currentAccountLabel}`)
    onLog?.(
      "info",
      `[${currentAccountLabel}] 当前标记进度 ${currentAccount.progress}/${REGISTER_STEP_COUNT}，将从 Step ${resumeStep} 开始执行`
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
        integration,
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
          onStatus?.(`账号 ${currentAccountLabel} 已完成 Step ${progress}`)
          onLog?.("info", `[${currentAccountLabel}] ${message}`)
        },
        (message) => {
          updateCurrentAccount({
            status: "running",
            lastMessage: message
          })
          onLog?.("info", `[${currentAccountLabel}] ${message}`)
        },
        (preparedAccount) => {
          updateCurrentAccount(preparedAccount)
        }
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "账号自动注册时发生异常"
      onLog?.("warn", `[${currentAccountLabel}] 账号自动注册异常：${message}`)
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
        `[${currentAccountLabel}] ${runResult.message || "已停止当前流程"}`
      )
      break
    }

    if (runResult.ok) {
      updateCurrentAccount({
        progress: REGISTER_STEP_COUNT,
        status: "done",
        lastMessage: runResult.message
      })
      onLog?.("info", `[${currentAccountLabel}] ${runResult.message}`)
      onLog?.(
        "info",
        `========== 流程成功完成：${currentAccountLabel} ==========`
      )
      if (getStopStrategy() !== "none") {
        break
      }
      if (!(await waitBeforeNextRunnableAccount(index, currentAccountLabel))) {
        break
      }
      continue
    }

    const currentState = workingAccounts[index]
    if (runResult.needsManualReview) {
      updateCurrentAccount({
        progress: currentState.progress,
        status: "needs_review",
        lastMessage: runResult.message
      })
      onStatus?.(`账号 ${currentAccountLabel} 需要人工判断`)
      onLog?.("warn", `[${currentAccountLabel}] ${runResult.message}`)
      if (getStopStrategy() !== "none") {
        break
      }
      if (!(await waitBeforeNextRunnableAccount(index, currentAccountLabel))) {
        break
      }
      continue
    }

    if (runResult.accountInvalid) {
      updateCurrentAccount({
        progress: currentState.progress,
        status: "invalid",
        lastMessage: buildAccountInvalidLastMessage(runResult.message)
      })
      onStatus?.(`账号 ${currentAccountLabel} 已失效`)
      onLog?.("warn", `[${currentAccountLabel}] ${runResult.message}`)
      if (getStopStrategy() !== "none") {
        break
      }
      if (!(await waitBeforeNextRunnableAccount(index, currentAccountLabel))) {
        break
      }
      continue
    }

    updateCurrentAccount({
      progress: currentState.progress,
      status: "failed",
      lastMessage: runResult.message
    })
    onStatus?.(`账号 ${currentAccountLabel} 执行失败`)
    onLog?.("warn", `[${currentAccountLabel}] ${runResult.message}`)
    if (getStopStrategy() !== "none") {
      break
    }
    if (!(await waitBeforeNextRunnableAccount(index, currentAccountLabel))) {
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
