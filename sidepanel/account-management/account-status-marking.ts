import {
  getManagedAccountKey,
  STEP_COUNT,
  type ManagedAccount,
  type ManagedAccountProgress
} from "../../shared/account-state"

type AccountStatusMarkingTarget = "done" | "invalid"

type MarkSelectedAccountStatusOptions = {
  accounts: ManagedAccount[]
  selectedAccountIds: string[]
  target: AccountStatusMarkingTarget
  stepCount: number
  updatedAt: number
}

export type AccountStatusMarkingResult = {
  accounts: ManagedAccount[]
  changedCount: number
}

/**
 * 生成批量标记后的账号列表，不直接更新 React state 或浏览器存储。
 *
 * 标记完成时把进度推进到当前页面的最后一步；标记失效时保留原进度，
 * 方便账号恢复后继续执行。
 */
export const markSelectedAccountStatus = ({
  accounts,
  selectedAccountIds,
  target,
  stepCount,
  updatedAt
}: MarkSelectedAccountStatusOptions): AccountStatusMarkingResult => {
  const selectedAccountIdSet = new Set(selectedAccountIds)
  const doneProgress = Math.min(
    Math.max(0, stepCount),
    STEP_COUNT + 1
  ) as ManagedAccountProgress
  let changedCount = 0

  const nextAccounts = accounts.map((account) => {
    if (!selectedAccountIdSet.has(getManagedAccountKey(account))) {
      return account
    }

    changedCount += 1
    if (target === "done") {
      return {
        ...account,
        progress: doneProgress,
        status: "done" as const,
        lastMessage: "已手动标为已完成",
        updatedAt
      }
    }

    return {
      ...account,
      status: "invalid" as const,
      lastMessage: "已手动标为失效",
      updatedAt
    }
  })

  return {
    accounts: nextAccounts,
    changedCount
  }
}
