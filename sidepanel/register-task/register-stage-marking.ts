import {
  getManagedAccountKey,
  type ManagedAccount,
  type ManagedAccountProgress
} from "../../shared/account-state"

export type RegisterStage = "start" | "phone"

type RegisterStageMarkingFailureReason =
  | "empty_selection"
  | "missing_selected_accounts"

export type RegisterStageMarkingResult =
  | {
      ok: true
      accounts: ManagedAccount[]
      changedCount: number
      statusMessage: string
      logMessage: string
    }
  | {
      ok: false
      reason: RegisterStageMarkingFailureReason
      statusMessage: string
      logMessage: string
    }

type MarkSelectedRegisterStageOptions = {
  accounts: ManagedAccount[]
  selectedAccountIds: string[]
  stage: RegisterStage
  updatedAt: number
}

const getRegisterStageState = (stage: RegisterStage) => {
  if (stage === "phone") {
    return {
      progress: 4 as ManagedAccountProgress,
      message: "已手动标记为从手机号验证开始（下一步从 Step 5 刷新 OAuth 开始）"
    }
  }

  return {
    progress: 0 as ManagedAccountProgress,
    message: "已手动标记为从头开始"
  }
}

/**
 * 为选中的账号生成新的注册阶段状态，不直接写入 React state 或 storage。
 *
 * selectedAccountIds 对应页面中的旧字段 selectedEmails，内容是稳定账号 ID。
 */
export const markSelectedRegisterStage = ({
  accounts,
  selectedAccountIds,
  stage,
  updatedAt
}: MarkSelectedRegisterStageOptions): RegisterStageMarkingResult => {
  if (selectedAccountIds.length === 0) {
    return {
      ok: false,
      reason: "empty_selection",
      statusMessage: "请先选择要标记阶段的账号",
      logMessage: "请先选择要标记阶段的账号"
    }
  }

  const selectedAccountIdSet = new Set(selectedAccountIds)
  const stageState = getRegisterStageState(stage)
  let changedCount = 0
  const nextAccounts = accounts.map((account) => {
    if (!selectedAccountIdSet.has(getManagedAccountKey(account))) {
      return account
    }

    changedCount += 1
    return {
      ...account,
      progress: stageState.progress,
      status: "idle" as const,
      lastMessage: stageState.message,
      updatedAt
    }
  })

  if (changedCount === 0) {
    return {
      ok: false,
      reason: "missing_selected_accounts",
      statusMessage: "未找到选中的账号",
      logMessage: "未找到选中的账号，无法标记阶段"
    }
  }

  return {
    ok: true,
    accounts: nextAccounts,
    changedCount,
    statusMessage: `已标记 ${changedCount} 个账号阶段`,
    logMessage: `已标记 ${changedCount} 个账号：${stageState.message}`
  }
}
