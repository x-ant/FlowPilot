import type { UiLogger } from "../shared/logging"

export type LoginFormValues = {
  cpaUrl?: string
  cpaManagementKey?: string
}

export type AccountFormValues = {
  email?: string
  password?: string
}

export type ManagedAccountStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "needs_review"

export type ManagedAccountProgress = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ManagedAccount = {
  email: string
  password: string
  progress: ManagedAccountProgress
  status: ManagedAccountStatus
  lastMessage: string
  updatedAt: number
}

export type AccountPageState = {
  cpaUrl: string
  cpaManagementKey: string
  accounts: ManagedAccount[]
}

export type AccountPageStorageKeys = {
  cpaUrl: string
  cpaManagementKey: string
  accounts: string
}

export type DebugStep = 1 | 2 | 3 | 4 | 5 | 6

export type BatchRunMode = "pending" | "all"

export type FlowPage = "codex-login" | "codex-register"

export type AccountRunResult = {
  ok: boolean
  message: string
  needsReview?: boolean
}

export type PageProps = {
  log: UiLogger
  setStatus: (status: string) => void
  onBusyChange?: (busy: boolean) => void
}

export const STEP_COUNT = 6

export const ACTIVE_PAGE_STORAGE_KEY = "codex-login:active-page"
export const LOGIN_STORAGE_KEYS: AccountPageStorageKeys = {
  cpaUrl: "codex-login:cpa-url",
  cpaManagementKey: "codex-login:cpa-management-key",
  accounts: "codex-login:accounts"
}
export const REGISTER_STORAGE_KEYS: AccountPageStorageKeys = {
  cpaUrl: "codex-register:cpa-url",
  cpaManagementKey: "codex-register:cpa-management-key",
  accounts: "codex-register:accounts"
}

export const FLOW_PAGE_ITEMS: Array<{ key: FlowPage; label: string }> = [
  {
    key: "codex-login",
    label: "codex-login"
  },
  {
    key: "codex-register",
    label: "codex-register"
  }
]

export const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  email: "",
  password: ""
}

export const EMPTY_PAGE_STATE: AccountPageState = {
  cpaUrl: "",
  cpaManagementKey: "",
  accounts: []
}

export const STATUS_META: Record<
  ManagedAccountStatus,
  { label: string; color: string }
> = {
  idle: {
    label: "待执行",
    color: "default"
  },
  running: {
    label: "执行中",
    color: "processing"
  },
  done: {
    label: "已完成",
    color: "success"
  },
  failed: {
    label: "失败",
    color: "error"
  },
  needs_review: {
    label: "待人工判断",
    color: "warning"
  }
}

export const FLOW_STEPS: Record<DebugStep, { name: string; label: string }> = {
  1: {
    name: "打开授权",
    label: "1 打开授权"
  },
  2: {
    name: "填写邮箱",
    label: "2 填写邮箱"
  },
  3: {
    name: "填写密码",
    label: "3 填写密码"
  },
  4: {
    name: "提交验证码",
    label: "4 提交验证码"
  },
  5: {
    name: "确认授权",
    label: "5 确认授权"
  },
  6: {
    name: "回填 CPA",
    label: "6 回填 CPA"
  }
}

export const getFlowStepName = (step: DebugStep) => {
  return FLOW_STEPS[step].name
}

export const getFlowStepLabel = (step: DebugStep) => {
  return FLOW_STEPS[step].label
}

export type AccountProgressStepMeta = {
  label: string
}

const getAccountProgressStepLabel = (
  step: number,
  stepLabels: Partial<Record<number, AccountProgressStepMeta>>
) => {
  return stepLabels[step]?.label || `${step}`
}

export const getAccountProgressSummary = (
  account: ManagedAccount,
  options: {
    stepCount?: number
    stepLabels?: Partial<Record<number, AccountProgressStepMeta>>
  } = {}
) => {
  const stepCount = options.stepCount || STEP_COUNT
  const stepLabels = options.stepLabels || FLOW_STEPS

  if (account.status === "done") {
    return "已完成全部步骤"
  }

  if (account.status === "needs_review") {
    return account.lastMessage || "需要人工判断后再处理"
  }

  const nextStep = Math.min(
    stepCount,
    Math.max(1, account.progress + 1)
  )
  const stepLabel =
    account.progress >= stepCount
      ? getAccountProgressStepLabel(stepCount, stepLabels)
      : getAccountProgressStepLabel(nextStep, stepLabels)

  if (account.status === "failed") {
    return `停在：${stepLabel}`
  }

  if (account.status === "running") {
    return `当前：${stepLabel}`
  }

  return `待执行：${getAccountProgressStepLabel(1, stepLabels)}`
}

export const getStorage = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  return chrome.storage.local
}

export const normalizeEmail = (value: string) => {
  return String(value || "")
    .trim()
    .toLowerCase()
}

export const normalizeStoredAccount = (
  value: unknown
): ManagedAccount | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Partial<ManagedAccount>
  const email = normalizeEmail(String(record.email || ""))
  if (!email) {
    return null
  }

  const status =
    record.status === "running" ||
    record.status === "done" ||
    record.status === "failed"
      ? record.status
      : "idle"

  const progress = [0, 1, 2, 3, 4, 5, 6, 7].includes(Number(record.progress))
    ? (Number(record.progress) as ManagedAccountProgress)
    : 0

  return {
    email,
    password: String(record.password || ""),
    progress,
    status,
    lastMessage: String(record.lastMessage || ""),
    updatedAt: Number(record.updatedAt || Date.now())
  }
}

export const createManagedAccount = (
  email: string,
  password: string
): ManagedAccount => {
  return {
    email: normalizeEmail(email),
    password: String(password || ""),
    progress: 0,
    status: "idle",
    lastMessage: "",
    updatedAt: Date.now()
  }
}

export const resetManagedAccountState = (
  account: ManagedAccount
): ManagedAccount => {
  return {
    ...account,
    progress: 0,
    status: "idle",
    lastMessage: ""
  }
}

export const isManagedAccountDone = (account: ManagedAccount) => {
  return account.status === "done" || account.progress >= STEP_COUNT
}

export const upsertManagedAccount = (
  accounts: ManagedAccount[],
  nextAccount: ManagedAccount,
  previousEmail?: string
) => {
  const nextNormalizedEmail = normalizeEmail(nextAccount.email)
  let nextAccounts: ManagedAccount[]
  let previousIndex = -1

  if (previousEmail) {
    const previousNormalizedEmail = normalizeEmail(previousEmail)
    nextAccounts = accounts.filter((account) => {
      return normalizeEmail(account.email) !== previousNormalizedEmail
    })
    previousIndex = accounts.findIndex((account) => {
      return normalizeEmail(account.email) === previousNormalizedEmail
    })
  } else {
    nextAccounts = [...accounts]
  }

  const targetIndex = nextAccounts.findIndex((account) => {
    return normalizeEmail(account.email) === nextNormalizedEmail
  })
  if (targetIndex >= 0) {
    nextAccounts[targetIndex] = nextAccount
    return nextAccounts
  }

  if (previousIndex >= 0) {
    nextAccounts.splice(
      Math.min(previousIndex, nextAccounts.length),
      0,
      nextAccount
    )
  } else {
    nextAccounts.push(nextAccount)
  }

  return nextAccounts
}

export const loadAccountPageState = async (
  keys: AccountPageStorageKeys
): Promise<AccountPageState> => {
  const storage = getStorage()
  if (!storage) {
    return EMPTY_PAGE_STATE
  }

  return new Promise<AccountPageState>((resolve) => {
    storage.get(
      [keys.cpaUrl, keys.cpaManagementKey, keys.accounts],
      (result) => {
        const rawAccounts = Array.isArray(result?.[keys.accounts])
          ? (result?.[keys.accounts] as unknown[])
          : []
        const accounts = rawAccounts
          .map((account) => normalizeStoredAccount(account))
          .filter((account): account is ManagedAccount => Boolean(account))

        resolve({
          cpaUrl: String(result?.[keys.cpaUrl] || "").trim(),
          cpaManagementKey: String(
            result?.[keys.cpaManagementKey] || ""
          ).trim(),
          accounts
        })
      }
    )
  })
}

export const saveAccountPageState = (
  keys: AccountPageStorageKeys,
  state: AccountPageState
) => {
  const storage = getStorage()
  storage?.set({
    [keys.cpaUrl]: state.cpaUrl,
    [keys.cpaManagementKey]: state.cpaManagementKey,
    [keys.accounts]: state.accounts
  })
}
