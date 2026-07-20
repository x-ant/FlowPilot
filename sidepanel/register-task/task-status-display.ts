import type { RegisterRunLock } from "../../shared/account-state"

/** 生成残留任务锁提示所需的安全展示数据。 */
export const getRegisterRunLockDisplay = (
  registerRunLock: RegisterRunLock | null
) => {
  return {
    startedAt: registerRunLock?.startedAt,
    currentAccount: registerRunLock?.currentEmail || "未知",
    lastMessage: registerRunLock?.message || "未知"
  }
}
