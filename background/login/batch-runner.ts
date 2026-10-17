import {
  getFlowStepLabel,
  buildAccountInvalidLastMessage,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  isManagedAccountDone,
  resetManagedAccountState,
  STEP_COUNT,
  type AccountRunResult,
  type BatchRunMode,
  type DebugStep,
  type ManagedAccount,
  type ManagedAccountStatus
} from "../../shared/account-state"
import type { OAuthIntegrationConfig } from "../../shared/oauth-integration"
import { createCodexLoginRunner } from "./steps"

export type LoginFlowRunner = Pick<
  ReturnType<typeof createCodexLoginRunner>,
  | "openCodexAuthLink"
  | "submitCodexLoginEmailAndWait"
  | "submitCodexLoginPasswordAndWait"
  | "fetchAndSubmitCodexVerificationCode"
  | "confirmCodexOAuthConsent"
  | "submitCodexOAuthCallback"
>

type RunLoginBatchOptions = {
  integration: OAuthIntegrationConfig
  accounts: ManagedAccount[]
  selectedAccountIds: string[]
  mode: BatchRunMode
  abortSignal?: AbortSignal
  shouldCancel?: () => boolean
  onAccountsChange?: (accounts: ManagedAccount[]) => void
  onLog?: (level: "info" | "warn", message: string) => void
  onRunningEmail?: (accountId: string) => void
  onStatus?: (message: string) => void
  runner?: LoginFlowRunner
}

export type LoginBatchResult = {
  accounts: ManagedAccount[]
  cancelled: boolean
  processedCount: number
  runnableCount: number
  message: string
}

const createLoginBatchTargetMatcher = (
  selectedAccountIds: string[],
  mode: BatchRunMode
) => {
  const selectedAccountIdSet = new Set(selectedAccountIds)

  return (account: ManagedAccount) => {
    const isSelected = selectedAccountIdSet.has(getManagedAccountKey(account))
    return mode === "all"
      ? isSelected
      : isSelected && !isManagedAccountDone(account)
  }
}

/**
 * 统计手动登录批次中实际会执行的账号数量。
 */
export const getLoginBatchRunnableCount = (
  accounts: ManagedAccount[],
  selectedAccountIds: string[],
  mode: BatchRunMode
) => {
  const isTargetAccount = createLoginBatchTargetMatcher(
    selectedAccountIds,
    mode
  )
  return accounts.filter(isTargetAccount).length
}

/**
 * 顺序执行单个账号的六步登录流程。
 */
export const runManagedLoginFlow = async (
  integration: OAuthIntegrationConfig,
  account: ManagedAccount,
  runner: LoginFlowRunner,
  onStage: (progress: DebugStep, message: string) => void
): Promise<AccountRunResult> => {
  const step1Result = await runner.openCodexAuthLink(integration)
  if (!step1Result.ok || !step1Result.targetTab?.id) {
    return {
      ok: false,
      message: step1Result.message || "步骤 1 执行失败"
    }
  }

  onStage(1, step1Result.message)

  const authTabId = step1Result.targetTab.id
  const step2Result = await runner.submitCodexLoginEmailAndWait(
    authTabId,
    account.email
  )
  if (!step2Result.ok) {
    return {
      ok: false,
      accountInvalid: step2Result.accountInvalid,
      message: step2Result.message || "步骤 2 执行失败"
    }
  }

  onStage(2, step2Result.message)

  let verificationRequestedAt = step2Result.verificationRequestedAt || 0
  const step3Result = await runner.submitCodexLoginPasswordAndWait(
    authTabId,
    account.password
  )
  if (!step3Result.ok) {
    return {
      ok: false,
      accountInvalid: step3Result.accountInvalid,
      message: step3Result.message || "步骤 3 执行失败"
    }
  }
  verificationRequestedAt =
    step3Result.verificationRequestedAt || verificationRequestedAt

  onStage(3, step3Result.message)

  const step4Result = await runner.fetchAndSubmitCodexVerificationCode(
    authTabId,
    account,
    verificationRequestedAt
  )
  if (!step4Result.ok) {
    return {
      ok: false,
      accountInvalid: step4Result.accountInvalid,
      message: step4Result.message || "步骤 4 执行失败"
    }
  }

  onStage(4, step4Result.message)

  const step5Result = await runner.confirmCodexOAuthConsent(authTabId)
  if (!step5Result.ok || !step5Result.callbackUrl) {
    return {
      ok: false,
      message: step5Result.message || "步骤 5 执行失败"
    }
  }

  onStage(5, step5Result.message)

  if (!step1Result.oauthBinding) {
    return {
      ok: false,
      message: "步骤 1 未返回 OAuth 来源绑定信息"
    }
  }

  const step6Result = await runner.submitCodexOAuthCallback(
    integration,
    step1Result.oauthBinding,
    step5Result.callbackUrl,
    authTabId,
    account.email
  )
  if (!step6Result.ok) {
    return {
      ok: false,
      message: step6Result.message || "步骤 6 执行失败"
    }
  }

  onStage(6, step6Result.message)

  return {
    ok: true,
    message: [
      step1Result.message,
      step2Result.message,
      step3Result.message,
      step4Result.message,
      step5Result.message,
      step6Result.message
    ]
      .filter(Boolean)
      .join("；")
  }
}

/**
 * 顺序执行选中的登录账号，并通过回调把状态交还侧边栏保存和展示。
 */
export const runLoginBatch = async ({
  integration,
  accounts,
  selectedAccountIds,
  mode,
  abortSignal,
  shouldCancel = () => false,
  onAccountsChange,
  onLog,
  onRunningEmail,
  onStatus,
  runner = createCodexLoginRunner({ abortSignal })
}: RunLoginBatchOptions): Promise<LoginBatchResult> => {
  const isTargetAccount = createLoginBatchTargetMatcher(
    selectedAccountIds,
    mode
  )
  const runnableCount = accounts.filter(isTargetAccount).length
  const batchLabel = mode === "all" ? "选中账号" : "选中的未完成账号"

  if (runnableCount === 0) {
    return {
      accounts,
      cancelled: false,
      processedCount: 0,
      runnableCount,
      message: mode === "pending" ? "选中的账号都已完成" : "没有需要执行的账号"
    }
  }

  let workingAccounts = accounts.map((account) => {
    return isTargetAccount(account)
      ? resetManagedAccountState(account)
      : account
  })
  onAccountsChange?.(workingAccounts)
  onStatus?.(`开始执行 ${runnableCount} 个${batchLabel}`)
  onLog?.("info", `开始执行 ${runnableCount} 个${batchLabel}`)

  let processedCount = 0
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

    const currentAccountKey = getManagedAccountKey(currentAccount)
    const currentAccountLabel = getManagedAccountDisplayLabel(currentAccount)
    processedCount += 1
    onRunningEmail?.(currentAccountKey)
    onStatus?.(
      `正在处理 ${currentAccountLabel}（${processedCount}/${runnableCount}）`
    )
    onLog?.("info", `开始处理账号 ${currentAccountLabel}`)

    const updateCurrentAccount = (patch: Partial<ManagedAccount>) => {
      const nextAccounts = [...workingAccounts]
      nextAccounts[index] = {
        ...nextAccounts[index],
        ...patch,
        updatedAt: Date.now()
      }
      workingAccounts = nextAccounts
      onAccountsChange?.(nextAccounts)
    }

    updateCurrentAccount({
      status: "running",
      lastMessage: "正在打开登录页"
    })

    let runResult: AccountRunResult
    try {
      runResult = await runManagedLoginFlow(
        integration,
        currentAccount,
        runner,
        (progress, message) => {
          const nextStatus: ManagedAccountStatus =
            progress === STEP_COUNT ? "done" : "running"
          updateCurrentAccount({
            progress,
            status: nextStatus,
            lastMessage: message
          })
          onStatus?.(
            `账号 ${currentAccountLabel} 已完成「${getFlowStepLabel(progress)}」`
          )
          onLog?.("info", `[${currentAccountLabel}] ${message}`)
        }
      )
    } catch (error) {
      runResult = {
        ok: false,
        message:
          error instanceof Error ? error.message : "账号自动执行时发生异常"
      }
    }

    if (shouldCancel()) {
      updateCurrentAccount({
        status: "failed",
        lastMessage: runResult.message || "已停止当前流程"
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
        progress: STEP_COUNT,
        status: "done",
        lastMessage: runResult.message
      })
      onLog?.("info", `[${currentAccountLabel}] ${runResult.message}`)
      continue
    }

    const currentState = workingAccounts[index]
    if (runResult.accountInvalid) {
      updateCurrentAccount({
        progress: currentState.progress,
        status: "invalid",
        lastMessage: buildAccountInvalidLastMessage(runResult.message)
      })
      onStatus?.(`账号 ${currentAccountLabel} 已失效`)
      onLog?.("warn", `[${currentAccountLabel}] ${runResult.message}`)
      continue
    }

    updateCurrentAccount({
      progress: currentState.progress,
      status: "failed",
      lastMessage: runResult.message
    })
    onStatus?.(`账号 ${currentAccountLabel} 执行失败`)
    onLog?.("warn", `[${currentAccountLabel}] ${runResult.message}`)
  }

  const message = cancelled ? "已停止批量执行" : `${batchLabel}执行已结束`
  onStatus?.(message)

  return {
    accounts: workingAccounts,
    cancelled,
    processedCount,
    runnableCount,
    message
  }
}
