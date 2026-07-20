import { readLocalStorage, writeLocalStorage } from "../platform/chrome/storage"

export type AccountFormValues = {
  mailProvider?: MailProvider
  emailGenerator?: EmailGenerator
  email?: string
  mailboxEmail?: string
  password?: string
}

export type MailProvider = "2925" | "163"
export type EmailGenerator = "duckduckgo" | "custom"

export type AccountFormDraftValues = Pick<
  AccountFormValues,
  "mailProvider" | "emailGenerator" | "email" | "password"
>

export type ManagedAccountStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "invalid"
  | "needs_review"

export type ManagedAccountProgress = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ManagedAccount = {
  id: string
  mailProvider: MailProvider
  emailGenerator?: EmailGenerator
  email: string
  mailboxEmail: string
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

export type RegisterAlarmMode = "interval" | "daily"

export type RegisterAlarmConfig = {
  enabled: boolean
  mode: RegisterAlarmMode
  intervalMinutes: number
  dailyTime: string
  accountIntervalMinSeconds: number
  accountIntervalMaxSeconds: number
  selectedEmails: string[]
  lastTriggeredAt?: number
  lastMessage?: string
  runningStartedAt?: number
}

export type RegisterRunLock = {
  runId: string
  source: "alarm" | "manual"
  startedAt: number
  currentEmail: string
  message: string
  phonePhase?: "phone_submitted" | "phone_wait_finished" | ""
}

export type RuntimeSettings = {
  keepAwakeDuringRun: boolean
}

export type AccountRunResult = {
  ok: boolean
  message: string
  needsManualReview?: boolean
  accountInvalid?: boolean
}

export const STEP_COUNT = 6

export const REGISTER_ALARM_NAME = "flowpilot:register:auto-run"
export const REGISTER_RUN_LOCK_STALE_MS = 2 * 60 * 60 * 1000
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  keepAwakeDuringRun: true
}
export const DEFAULT_REGISTER_ALARM_CONFIG: RegisterAlarmConfig = {
  enabled: false,
  mode: "interval",
  intervalMinutes: 30,
  dailyTime: "02:00",
  accountIntervalMinSeconds: 180,
  accountIntervalMaxSeconds: 300,
  selectedEmails: []
}

export const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  mailProvider: "2925",
  emailGenerator: undefined,
  email: "",
  mailboxEmail: "",
  password: ""
}

export const EMPTY_ACCOUNT_FORM_DRAFT: AccountFormDraftValues = {
  mailProvider: "2925",
  emailGenerator: undefined,
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
  invalid: {
    label: "失效",
    color: "red"
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
    name: "提交 OAuth callback",
    label: "6 提交 OAuth callback"
  }
}

export const getFlowStepName = (step: DebugStep) => {
  return FLOW_STEPS[step].name
}

/**
 * 获取登录调试步骤的展示文案。
 *
 * @param step 登录流程步骤编号。
 * @return 适合按钮和状态展示的步骤文案。
 */
export const getFlowStepLabel = (step: DebugStep) => {
  return FLOW_STEPS[step].label
}

export type AccountProgressStepMeta = {
  label: string
}

export type AccountVisibilityFilter = "pending" | "done" | "invalid" | "all"

const getAccountProgressStepLabel = (
  step: number,
  stepLabels: Partial<Record<number, AccountProgressStepMeta>>
) => {
  return stepLabels[step]?.label || `${step}`
}

/**
 * 判断账号在指定流程里是否已经完成。
 *
 * @param account 要判断的账号。
 * @param stepCount 当前流程总步骤数。
 * @return 状态为完成或进度达到总步骤数时返回 true。
 */
export const isManagedAccountComplete = (
  account: Pick<ManagedAccount, "status" | "progress">,
  stepCount = STEP_COUNT
) => {
  return account.status === "done" || account.progress >= stepCount
}

/**
 * 生成账号失效状态写入账号列表的小字描述。
 *
 * @param message OpenAI 返回的完整账号失效描述。
 * @return 有错误代码时只保留错误代码；否则返回通用失效描述。
 */
export const buildAccountInvalidLastMessage = (message?: string) => {
  const errorCode = String(message || "")
    .match(/错误代码[:：]\s*([a-z0-9_-]+)/i)?.[1]
    ?.trim()

  return errorCode ? `错误代码：${errorCode}` : "账号已失效"
}

/**
 * 判断账号是否匹配当前账号视图过滤条件。
 *
 * @param account 要判断的账号。
 * @param filter 账号过滤模式。
 * @param stepCount 当前流程总步骤数。
 * @return 账号应该展示时返回 true。
 */
export const matchesManagedAccountVisibilityFilter = (
  account: Pick<ManagedAccount, "status" | "progress">,
  filter: AccountVisibilityFilter,
  stepCount = STEP_COUNT
) => {
  if (filter === "all") {
    return true
  }

  if (filter === "invalid") {
    return account.status === "invalid"
  }

  const isComplete = isManagedAccountComplete(account, stepCount)
  return filter === "done"
    ? isComplete
    : !isComplete && account.status !== "invalid"
}

/**
 * 根据账号执行状态生成一句进度摘要。
 *
 * @param account 要展示的账号。
 * @param options 可选的总步骤数和步骤文案。
 * @return 账号列表中展示的当前进度说明。
 */
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

  if (account.status === "invalid") {
    return account.lastMessage || "账号已失效"
  }

  const nextStep = Math.min(stepCount, Math.max(1, account.progress + 1))
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

  return `待执行：${stepLabel}`
}

/**
 * 统一邮箱格式，避免大小写和首尾空格导致账号重复。
 *
 * @param value 原始邮箱文本。
 * @return 小写并去除首尾空格后的邮箱。
 */
export const normalizeEmail = (value: string) => {
  return String(value || "")
    .trim()
    .toLowerCase()
}

/**
 * 规范化账号使用的邮箱服务。
 *
 * @param value 表单里的邮箱服务原始值。
 * @return 支持的邮箱服务；无法识别时返回 2925。
 */
export const normalizeMailProvider = (value: unknown): MailProvider => {
  return value === "163" ? "163" : "2925"
}

/**
 * 规范化账号使用的邮箱生成方式。
 *
 * 当前只有注册流程里的 163 邮箱会用到 DuckDuckGo 辅助生成注册邮箱。
 *
 * @param value 表单或存储里的邮箱生成方式原始值。
 * @return 支持的邮箱生成方式；缺失或无法识别时返回 undefined。
 */
export const normalizeEmailGenerator = (
  value: unknown
): EmailGenerator | undefined => {
  if (value === "duckduckgo" || value === "custom") {
    return value
  }

  return undefined
}

/**
 * 规范化账号表单草稿。
 *
 * 草稿只保存会被重复使用的输入习惯；调用方可以在写入前决定是否保留
 * 注册邮箱，例如登录页保留邮箱，注册页 DuckDuckGo 生成邮箱后清空。
 *
 * @param value 从浏览器本地存储读取到的账号表单草稿。
 * @return 可安全回填到账号表单的草稿字段。
 */
export const normalizeAccountFormDraft = (
  value: unknown
): AccountFormDraftValues => {
  const record =
    value && typeof value === "object"
      ? (value as Partial<AccountFormDraftValues>)
      : {}
  const mailProvider = normalizeMailProvider(record.mailProvider)
  const emailGenerator =
    mailProvider === "163"
      ? normalizeEmailGenerator(record.emailGenerator)
      : undefined

  return {
    mailProvider,
    emailGenerator,
    email: normalizeEmail(String(record.email || "")),
    password: String(record.password || "")
  }
}

/**
 * 读取存储账号里的邮箱服务。
 *
 * 当前功能不兼容旧账号数据，存储里必须明确写入邮箱服务类型。
 *
 * @param value 存储里的邮箱服务原始值。
 * @return 有效邮箱服务；缺失或无法识别时返回 null。
 */
const readStoredMailProvider = (value: unknown): MailProvider | null => {
  if (value === "2925" || value === "163") {
    return value
  }

  return null
}

/**
 * 创建本地账号稳定 ID。
 *
 * 账号的邮箱可能在编辑时变化，所以列表选择和编辑不能再依赖邮箱作为主键。
 *
 * @return 新账号 ID。
 */
export const createManagedAccountId = () => {
  return `account-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 规范化账号 ID。
 *
 * 自动触发配置里的 selectedEmails 字段沿用旧字段名，但当前内容已经是账号 ID。
 *
 * @param value 账号 ID 原始值。
 * @return 去除首尾空白后的账号 ID。
 */
export const normalizeAccountId = (value: unknown) => {
  return String(value || "").trim()
}

/**
 * 获取账号在 UI 和批量流程中的稳定主键。
 *
 * @param account 要读取主键的账号。
 * @return 账号 ID。
 */
export const getManagedAccountKey = (account: Pick<ManagedAccount, "id">) => {
  return normalizeAccountId(account.id)
}

/**
 * 获取账号展示名。
 *
 * 显示账号列表里保存的注册邮箱。
 *
 * @param account 要展示的账号。
 * @return 适合日志和列表展示的账号标签。
 */
export const getManagedAccountLabel = (
  account: Pick<ManagedAccount, "email" | "mailboxEmail">
) => {
  return normalizeEmail(account.email)
}

/**
 * 获取账号邮箱服务展示标签。
 *
 * @param account 要展示的账号。
 * @return 账号列表里展示的邮箱服务文案。
 */
export const getManagedAccountProviderLabel = (
  account: Pick<ManagedAccount, "mailProvider" | "emailGenerator">,
  options: { showEmailGenerator?: boolean } = {}
) => {
  if (account.mailProvider !== "163") {
    return "2925"
  }

  if (options.showEmailGenerator === false) {
    return "163"
  }

  if (account.emailGenerator === "duckduckgo") {
    return "163 + DDG"
  }

  if (account.emailGenerator === "custom") {
    return "163 + 自定义邮箱"
  }

  return "163 + 缺少邮箱生成"
}

/**
 * 获取账号展示标签。
 *
 * 有注册邮箱时优先展示邮箱；异常缺失时展示邮箱服务和占位说明。
 *
 * @param account 要展示的账号。
 * @return 适合 UI 下拉、状态和日志使用的账号标签。
 */
export const getManagedAccountDisplayLabel = (
  account: Pick<
    ManagedAccount,
    "email" | "mailboxEmail" | "mailProvider" | "emailGenerator"
  >
) => {
  return (
    getManagedAccountLabel(account) ||
    `${getManagedAccountProviderLabel(account)} 缺少注册邮箱`
  )
}

/**
 * 规范化浏览器存储里的注册自动触发配置。
 *
 * @param value 从 `chrome.storage.local` 读取到的原始值。
 * @return 带默认值和安全边界的自动触发配置。
 */
export const normalizeRegisterAlarmConfig = (
  value: unknown
): RegisterAlarmConfig => {
  const record =
    value && typeof value === "object"
      ? (value as Partial<RegisterAlarmConfig>)
      : {}
  const intervalMinutes = Math.max(
    1,
    Math.floor(Number(record.intervalMinutes || 30))
  )
  const dailyTime = /^\d{2}:\d{2}$/.test(String(record.dailyTime || ""))
    ? String(record.dailyTime)
    : "02:00"
  const accountIntervalMinSeconds = Math.max(
    0,
    Math.floor(Number(record.accountIntervalMinSeconds ?? 180))
  )
  const accountIntervalMaxSeconds = Math.max(
    accountIntervalMinSeconds,
    Math.floor(Number(record.accountIntervalMaxSeconds ?? 300))
  )

  return {
    enabled: Boolean(record.enabled),
    mode: record.mode === "daily" ? "daily" : "interval",
    intervalMinutes,
    dailyTime,
    accountIntervalMinSeconds,
    accountIntervalMaxSeconds,
    selectedEmails: Array.isArray(record.selectedEmails)
      ? record.selectedEmails
          .map((accountId) => normalizeAccountId(accountId))
          .filter(Boolean)
      : [],
    lastTriggeredAt: Number(record.lastTriggeredAt) || 0,
    lastMessage: String(record.lastMessage || ""),
    runningStartedAt: Number(record.runningStartedAt) || 0
  }
}

/**
 * 规范化全局运行设置。
 *
 * @param value 从 `chrome.storage.local` 读取到的原始值。
 * @return 带默认值的运行设置。
 */
export const normalizeRuntimeSettings = (value: unknown): RuntimeSettings => {
  const record =
    value && typeof value === "object"
      ? (value as Partial<RuntimeSettings>)
      : {}

  return {
    keepAwakeDuringRun:
      typeof record.keepAwakeDuringRun === "boolean"
        ? record.keepAwakeDuringRun
        : DEFAULT_RUNTIME_SETTINGS.keepAwakeDuringRun
  }
}

/**
 * 规范化后台注册任务锁。
 *
 * @param value 从本地存储读取到的原始任务锁。
 * @return 任务锁有效时返回规范化对象；无效时返回 null。
 */
export const normalizeRegisterRunLock = (
  value: unknown
): RegisterRunLock | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Partial<RegisterRunLock>
  const runId = String(record.runId || "").trim()
  const startedAt = Number(record.startedAt || 0)
  if (!runId || !startedAt) {
    return null
  }

  return {
    runId,
    source: record.source === "manual" ? "manual" : "alarm",
    startedAt,
    currentEmail: normalizeAccountId(record.currentEmail),
    message: String(record.message || ""),
    phonePhase:
      record.phonePhase === "phone_submitted" ||
      record.phonePhase === "phone_wait_finished"
        ? record.phonePhase
        : ""
  }
}

/**
 * 规范化本地保存的账号数据。
 *
 * @param value 从浏览器本地存储读取到的单个账号。
 * @param options 规范化选项。
 * @param options.requireEmailGenerator 是否要求 163 账号必须有邮箱生成方式。
 * @return 账号有效时返回规范化对象；邮箱服务缺失或账号必填字段缺失时返回 null。
 */
export const normalizeStoredAccount = (
  value: unknown,
  options: { requireEmailGenerator?: boolean } = {}
): ManagedAccount | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Partial<ManagedAccount>
  const id = String(record.id || "").trim()
  if (!id) {
    return null
  }

  const mailProvider = readStoredMailProvider(record.mailProvider)
  if (!mailProvider) {
    return null
  }

  const email = normalizeEmail(String(record.email || ""))
  const mailboxEmail = normalizeEmail(String(record.mailboxEmail || ""))
  if (mailProvider === "2925" && !email) {
    return null
  }

  const emailGenerator =
    mailProvider === "163"
      ? normalizeEmailGenerator(record.emailGenerator)
      : undefined
  if (
    options.requireEmailGenerator &&
    mailProvider === "163" &&
    !emailGenerator
  ) {
    return null
  }

  const status =
    record.status === "running" ||
    record.status === "done" ||
    record.status === "failed" ||
    record.status === "invalid" ||
    record.status === "needs_review"
      ? record.status
      : "idle"

  const progress = [0, 1, 2, 3, 4, 5, 6, 7].includes(Number(record.progress))
    ? (Number(record.progress) as ManagedAccountProgress)
    : 0

  return {
    id,
    mailProvider,
    emailGenerator,
    email,
    mailboxEmail: mailProvider === "2925" ? mailboxEmail || email : "",
    password: String(record.password || ""),
    progress,
    status,
    lastMessage: String(record.lastMessage || ""),
    updatedAt: Number(record.updatedAt || Date.now())
  }
}

/**
 * 创建新的账号记录。
 *
 * @param values 新账号表单字段。
 * @return 初始状态为待执行的账号对象。
 */
export const createManagedAccount = (
  values: AccountFormValues
): ManagedAccount => {
  const mailProvider = normalizeMailProvider(values.mailProvider)
  const email = normalizeEmail(values.email || "")
  const mailboxEmail = mailProvider === "2925" ? email : ""
  const emailGenerator =
    mailProvider === "163"
      ? normalizeEmailGenerator(values.emailGenerator)
      : undefined

  return {
    id: createManagedAccountId(),
    mailProvider,
    emailGenerator,
    email,
    mailboxEmail,
    password: String(values.password || ""),
    progress: 0,
    status: "idle",
    lastMessage: "",
    updatedAt: Date.now()
  }
}

/**
 * 重置账号的执行状态，保留邮箱和密码。
 *
 * @param account 要重置的账号。
 * @return 状态回到待执行的账号对象。
 */
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

/**
 * 判断账号是否已经完成当前流程。
 *
 * @param account 要判断的账号。
 * @return 完成状态或进度达到总步数时返回 true。
 */
export const isManagedAccountDone = (account: ManagedAccount) => {
  return account.status === "done" || account.progress >= STEP_COUNT
}

/**
 * 新增或更新账号，并尽量保持原来的列表顺序。
 *
 * @param accounts 当前账号列表。
 * @param nextAccount 要写入的新账号。
 * @param previousId 编辑账号时的旧账号 ID；新增账号时不用传。
 * @return 更新后的账号列表。
 */
export const upsertManagedAccount = (
  accounts: ManagedAccount[],
  nextAccount: ManagedAccount,
  previousId?: string
) => {
  const nextId = getManagedAccountKey(nextAccount)
  let nextAccounts: ManagedAccount[]
  let previousIndex = -1

  if (previousId) {
    nextAccounts = accounts.filter((account) => {
      return getManagedAccountKey(account) !== previousId
    })
    previousIndex = accounts.findIndex((account) => {
      return getManagedAccountKey(account) === previousId
    })
  } else {
    nextAccounts = [...accounts]
  }

  const targetIndex = nextAccounts.findIndex((account) => {
    return getManagedAccountKey(account) === nextId
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

/**
 * 从浏览器本地存储加载某个页面的账号配置。
 *
 * @param keys 当前页面使用的存储 key。
 * @param options 账号读取选项。
 * @param options.requireEmailGenerator 是否要求 163 账号必须有邮箱生成方式。
 * @return 页面状态，包括 CPA 配置和账号列表。
 */
export const loadAccountPageState = async (
  keys: AccountPageStorageKeys,
  options: { requireEmailGenerator?: boolean } = {}
): Promise<AccountPageState> => {
  const result = await readLocalStorage([
    keys.cpaUrl,
    keys.cpaManagementKey,
    keys.accounts
  ])
  const rawAccounts = Array.isArray(result[keys.accounts])
    ? (result[keys.accounts] as unknown[])
    : []
  const accounts = rawAccounts
    .map((account) => normalizeStoredAccount(account, options))
    .filter((account): account is ManagedAccount => Boolean(account))

  return {
    cpaUrl: String(result[keys.cpaUrl] || "").trim(),
    cpaManagementKey: String(result[keys.cpaManagementKey] || "").trim(),
    accounts
  }
}

/**
 * 保存某个页面的账号配置到浏览器本地存储。
 *
 * @param keys 当前页面使用的存储 key。
 * @param state 要保存的页面状态。
 */
export const saveAccountPageState = (
  keys: AccountPageStorageKeys,
  state: AccountPageState
) => {
  void writeLocalStorage({
    [keys.cpaUrl]: state.cpaUrl,
    [keys.cpaManagementKey]: state.cpaManagementKey,
    [keys.accounts]: state.accounts
  })
}
