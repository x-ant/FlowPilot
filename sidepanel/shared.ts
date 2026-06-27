import type { UiLogger } from "../shared/logging"

export type LoginFormValues = {
  cpaUrl?: string
}

export type AccountFormValues = {
  email?: string
  password?: string
}

export type ManagedAccountStatus = "idle" | "running" | "done" | "failed"

export type ManagedAccountProgress = 0 | 1 | 2 | 3 | 4 | 5 | 6

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
  accounts: ManagedAccount[]
}

export type AccountPageStorageKeys = {
  cpaUrl: string
  accounts: string
}

export type DebugStep = 1 | 2 | 3 | 4 | 5 | 6

export type BatchRunMode = "pending" | "all"

export type FlowPage = "codex-login" | "codex-register"

export type AccountRunResult = {
  ok: boolean
  message: string
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
  accounts: "codex-login:accounts"
}
export const REGISTER_STORAGE_KEYS: AccountPageStorageKeys = {
  cpaUrl: "codex-register:cpa-url",
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

export const getAccountProgressSummary = (account: ManagedAccount) => {
  if (account.status === "done") {
    return "已完成全部步骤"
  }

  const nextStep = Math.min(
    STEP_COUNT,
    Math.max(1, account.progress + 1)
  ) as DebugStep
  const stepLabel =
    account.progress >= STEP_COUNT
      ? getFlowStepLabel(STEP_COUNT)
      : getFlowStepLabel(nextStep)

  if (account.status === "failed") {
    return `停在：${stepLabel}`
  }

  if (account.status === "running") {
    return `当前：${stepLabel}`
  }

  return `待执行：${getFlowStepLabel(1)}`
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

  const progress = [0, 1, 2, 3, 4, 5, 6].includes(Number(record.progress))
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
    storage.get([keys.cpaUrl, keys.accounts], (result) => {
      const rawAccounts = Array.isArray(result?.[keys.accounts])
        ? (result?.[keys.accounts] as unknown[])
        : []
      const accounts = rawAccounts
        .map((account) => normalizeStoredAccount(account))
        .filter((account): account is ManagedAccount => Boolean(account))

      resolve({
        cpaUrl: String(result?.[keys.cpaUrl] || "").trim(),
        accounts
      })
    })
  })
}

export const saveAccountPageState = (
  keys: AccountPageStorageKeys,
  state: AccountPageState
) => {
  const storage = getStorage()
  storage?.set({
    [keys.cpaUrl]: state.cpaUrl,
    [keys.accounts]: state.accounts
  })
}
