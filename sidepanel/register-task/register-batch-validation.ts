import {
  getManagedAccountKey,
  type ManagedAccount,
  type RegisterRunLock
} from "../../shared/account-state"

type RegisterBatchValidationFailureReason =
  | "missing_oauth_config"
  | "empty_account_list"
  | "batch_already_running"
  | "debug_running"
  | "empty_selection"
  | "missing_hero_sms_config"
  | "empty_runnable_selection"

type RegisterBatchValidationLog = {
  level: "info" | "warn"
  message: string
}

export type RegisterBatchValidationResult =
  | {
      ok: true
      runnableCount: number
    }
  | {
      ok: false
      reason: RegisterBatchValidationFailureReason
      statusMessage?: string
      log?: RegisterBatchValidationLog
    }

type ValidateRegisterBatchStartOptions = {
  hasOAuthConfig: boolean
  accounts: ManagedAccount[]
  isBatchRunning: boolean
  registerRunLock: RegisterRunLock | null
  isDebugRunning: boolean
  selectedAccountIds: string[]
  hasHeroSmsConfig: boolean
  stepCount: number
}

/**
 * 按注册页原有顺序校验一次手动批量任务能否提交到 background。
 *
 * selectedAccountIds 对应存储中的旧字段 selectedEmails，内容是稳定账号 ID。
 */
export const validateRegisterBatchStart = ({
  hasOAuthConfig,
  accounts,
  isBatchRunning,
  registerRunLock,
  isDebugRunning,
  selectedAccountIds,
  hasHeroSmsConfig,
  stepCount
}: ValidateRegisterBatchStartOptions): RegisterBatchValidationResult => {
  if (!hasOAuthConfig) {
    return {
      ok: false,
      reason: "missing_oauth_config",
      statusMessage: "请先完善 OAuth 接入配置",
      log: {
        level: "warn",
        message: "OAuth 接入配置不完整"
      }
    }
  }

  if (accounts.length === 0) {
    return {
      ok: false,
      reason: "empty_account_list",
      statusMessage: "请先添加至少一个账号",
      log: {
        level: "warn",
        message: "账号列表为空"
      }
    }
  }

  if (isBatchRunning && registerRunLock) {
    return {
      ok: false,
      reason: "batch_already_running",
      statusMessage: "注册任务正在后台执行",
      log: {
        level: "warn",
        message: registerRunLock.message || "注册任务正在后台执行"
      }
    }
  }

  if (isDebugRunning) {
    return {
      ok: false,
      reason: "debug_running"
    }
  }

  if (selectedAccountIds.length === 0) {
    return {
      ok: false,
      reason: "empty_selection",
      statusMessage: "请先选择要执行的账号",
      log: {
        level: "info",
        message: "请先选择要执行的账号"
      }
    }
  }

  if (!hasHeroSmsConfig) {
    return {
      ok: false,
      reason: "missing_hero_sms_config",
      statusMessage: "请先填写 HeroSMS 接码配置",
      log: {
        level: "warn",
        message: "注册执行缺少 HeroSMS 接码配置"
      }
    }
  }

  const selectedAccountIdSet = new Set(selectedAccountIds)
  const runnableCount = accounts.filter((account) => {
    const isDone = account.status === "done" || account.progress >= stepCount
    return (
      selectedAccountIdSet.has(getManagedAccountKey(account)) &&
      !isDone &&
      account.status !== "needs_review"
    )
  }).length

  if (runnableCount === 0) {
    return {
      ok: false,
      reason: "empty_runnable_selection",
      statusMessage: "选中的账号没有可执行项",
      log: {
        level: "info",
        message: "选中的账号没有可执行项"
      }
    }
  }

  return {
    ok: true,
    runnableCount
  }
}
