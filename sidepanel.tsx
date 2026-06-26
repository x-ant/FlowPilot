import {
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  theme,
  Typography
} from "antd"
import zhCN from "antd/locale/zh_CN"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  confirmCodexOAuthConsent,
  fetchAndSubmitCodexVerificationCode,
  openCodexAuthLink,
  submitCodexLoginEmailAndWait,
  submitCodexLoginPasswordAndWait,
  submitCodexOAuthCallbackToCpa
} from "./background/codex-login"

import "antd/dist/reset.css"
import "./sidepanel.css"

import {
  createUiLogger,
  getTimeLabel,
  LOG_LEVEL_META,
  type LogItem
} from "./shared/logging"

type LoginFormValues = {
  cpaUrl?: string
}

type AccountFormValues = {
  email?: string
  password?: string
}

type ManagedAccountStatus = "idle" | "running" | "done" | "failed"

type ManagedAccountProgress = 0 | 1 | 2 | 3 | 4 | 5 | 6

type ManagedAccount = {
  email: string
  password: string
  progress: ManagedAccountProgress
  status: ManagedAccountStatus
  lastMessage: string
  updatedAt: number
}

type StoredState = {
  cpaUrl: string
  accounts: ManagedAccount[]
  backgroundExecution: boolean
}

type AccountRunResult = {
  ok: boolean
  message: string
}

type DebugStep = 1 | 2 | 3 | 4 | 5 | 6

type BatchRunMode = "pending" | "all"

type FlowRunContext = {
  authTabId?: number
  verificationRequestedAt?: number
  callbackUrl?: string
}

type ExecutionSettings = {
  backgroundExecution: boolean
  abortSignal?: AbortSignal
}

const STEP_COUNT = 6

const CPA_URL_STORAGE_KEY = "codex-login:cpa-url"
const ACCOUNTS_STORAGE_KEY = "codex-login:accounts"
const BACKGROUND_EXECUTION_STORAGE_KEY = "codex-login:background-execution"

const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  email: "",
  password: ""
}

const STATUS_META: Record<
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

const FLOW_STEPS: Record<
  DebugStep,
  {
    name: string
    label: string
  }
> = {
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

const getFlowStepName = (step: DebugStep) => {
  return FLOW_STEPS[step].name
}

const getFlowStepLabel = (step: DebugStep) => {
  return FLOW_STEPS[step].label
}

/**
 * 生成账号列表里的轻量进度文案。
 *
 * 账号列表只展示走到哪一步，详细执行结果放到日志里看。
 *
 * @param account 账号执行状态。
 * @return 适合列表展示的进度文案。
 */
const getAccountProgressSummary = (account: ManagedAccount) => {
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

/**
 * 获取 Chrome 扩展本地存储对象。
 *
 * @return Chrome 扩展本地存储对象；如果当前环境不是扩展环境则返回 null。
 */
const getStorage = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  return chrome.storage.local
}

/**
 * 统一处理邮箱，避免重复判断时出现大小写差异。
 *
 * @param value 原始邮箱文本。
 * @return 规范化后的邮箱。
 */
const normalizeEmail = (value: string) => {
  return String(value || "")
    .trim()
    .toLowerCase()
}

/**
 * 把加载到内存里的账号状态整理成可用格式。
 *
 * @param value 原始账号数据。
 * @return 可用的账号数据；无效时返回 null。
 */
const normalizeStoredAccount = (value: unknown): ManagedAccount | null => {
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

/**
 * 生成一个新的账号记录。
 *
 * @param email 邮箱。
 * @param password 密码。
 * @return 标准化后的账号。
 */
const createManagedAccount = (
  email: string,
  password: string
): ManagedAccount => {
  return {
    email: normalizeEmail(email),
    password: String(password || ""),
    progress: 0 as 0,
    status: "idle",
    lastMessage: "",
    updatedAt: Date.now()
  }
}

/**
 * 让账号状态回到待执行。
 *
 * @param account 原始账号。
 * @return 清空执行状态后的账号。
 */
const resetManagedAccountState = (account: ManagedAccount): ManagedAccount => {
  return {
    ...account,
    progress: 0,
    status: "idle",
    lastMessage: ""
  }
}

/**
 * 判断账号是否已经完成全部自动流程。
 *
 * @param account 当前账号。
 * @return 完成则返回 true。
 */
const isManagedAccountDone = (account: ManagedAccount) => {
  return account.status === "done" || account.progress >= STEP_COUNT
}

/**
 * 将一条账号记录写回列表；若邮箱重复则覆盖。
 * upsert = update + insert
 *
 * 如果是在编辑某个账号时保存，会优先保留原位置，避免列表顺序跳动。
 *
 * @param accounts 当前账号列表。
 * @param nextAccount 要写入的账号。
 * @param previousEmail 被编辑账号的旧邮箱；新增时不传。
 * @return 更新后的账号列表。
 */
const upsertManagedAccount = (
  accounts: ManagedAccount[],
  nextAccount: ManagedAccount,
  previousEmail?: string
) => {
  const nextNormalizedEmail = normalizeEmail(nextAccount.email)
  let nextAccounts: ManagedAccount[]
  let previousIndex = -1

  // region ========== 处理 修改和删除 的旧邮箱 ==========
  if (previousEmail) {
    const previousNormalizedEmail = normalizeEmail(previousEmail)
    // 删除旧邮箱
    nextAccounts = accounts.filter((account) => {
      return normalizeEmail(account.email) !== previousNormalizedEmail
    })
    // 定位旧邮箱的位置
    previousIndex = accounts.findIndex((account) => {
      return normalizeEmail(account.email) === previousNormalizedEmail
    })
  } else {
    // 如果是纯新增或纯内容修改，拷贝一份新数组，用来触发 React 的 State 更新
    nextAccounts = [...accounts]
  }
  // endregion

  // region ========== 新邮箱已经存在则覆盖 ==========
  const targetIndex = nextAccounts.findIndex((account) => {
    return normalizeEmail(account.email) === nextNormalizedEmail
  })
  if (targetIndex >= 0) {
    nextAccounts[targetIndex] = nextAccount
    return nextAccounts
  }
  // endregion

  // region ========== 新邮箱应该放入的位置 ==========
  if (previousIndex >= 0) {
    // 用原本位置的索引 挤 新数组的位置，正好和原数组最终的位置一样
    nextAccounts.splice(
      Math.min(previousIndex, nextAccounts.length),
      0,
      nextAccount
    )
  } else {
    nextAccounts.push(nextAccount)
  }
  // endregion

  return nextAccounts
}

/**
 * 读取本地保存的账号状态。
 *
 * @return CPA 地址和账号列表。
 */
const loadStoredState = async (): Promise<StoredState> => {
  const storage = getStorage()
  if (!storage) {
    return {
      cpaUrl: "",
      accounts: [],
      backgroundExecution: false
    }
  }

  return new Promise<StoredState>((resolve) => {
    storage.get(
      [
        CPA_URL_STORAGE_KEY,
        ACCOUNTS_STORAGE_KEY,
        BACKGROUND_EXECUTION_STORAGE_KEY
      ],
      (result) => {
        const cpaUrl = String(result?.[CPA_URL_STORAGE_KEY] || "").trim()
        const rawAccounts = Array.isArray(result?.[ACCOUNTS_STORAGE_KEY])
          ? (result?.[ACCOUNTS_STORAGE_KEY] as unknown[])
          : []
        const accounts = rawAccounts
          .map((account) => normalizeStoredAccount(account))
          .filter((account): account is ManagedAccount => Boolean(account))

        resolve({
          cpaUrl,
          accounts,
          backgroundExecution:
            result?.[BACKGROUND_EXECUTION_STORAGE_KEY] === true
        })
      }
    )
  })
}

/**
 * 保存当前账号状态。
 *
 * @param state 要保存的状态。
 * @return 无。
 */
const saveStoredState = (state: StoredState) => {
  const storage = getStorage()
  storage?.set({
    [CPA_URL_STORAGE_KEY]: state.cpaUrl,
    [ACCOUNTS_STORAGE_KEY]: state.accounts,
    [BACKGROUND_EXECUTION_STORAGE_KEY]: state.backgroundExecution
  })
}

/**
 * 运行一个账号的完整登录流程。
 *
 * @param cpaUrl CPA 地址。
 * @param account 当前账号。
 * @param onStage 完成每一步后的回调。
 * @return 流程结果。
 */
const runManagedAccountFlow = async (
  cpaUrl: string,
  account: ManagedAccount,
  onStage: (progress: DebugStep, message: string) => void,
  settings: ExecutionSettings
): Promise<AccountRunResult> => {
  const browserOptions = {
    activateTabs: !settings.backgroundExecution,
    abortSignal: settings.abortSignal
  }
  const step1Result = await openCodexAuthLink(cpaUrl, browserOptions)
  if (!step1Result.ok || !step1Result.targetTab?.id) {
    return {
      ok: false,
      message: step1Result.message || "步骤 1 执行失败"
    }
  }

  onStage(1, step1Result.message)

  const authTabId = step1Result.targetTab.id
  const step2Result = await submitCodexLoginEmailAndWait(
    authTabId,
    account.email,
    browserOptions
  )
  if (!step2Result.ok) {
    return {
      ok: false,
      message: step2Result.message || "步骤 2 执行失败"
    }
  }

  onStage(2, step2Result.message)

  let verificationRequestedAt = step2Result.verificationRequestedAt || 0
  const step3Result = await submitCodexLoginPasswordAndWait(
    authTabId,
    account.password,
    browserOptions
  )
  if (!step3Result.ok) {
    return {
      ok: false,
      message: step3Result.message || "步骤 3 执行失败"
    }
  }
  verificationRequestedAt =
    step3Result.verificationRequestedAt || verificationRequestedAt

  onStage(3, step3Result.message)

  const step4Result = await fetchAndSubmitCodexVerificationCode(
    authTabId,
    account.email,
    account.password,
    verificationRequestedAt,
    browserOptions
  )
  if (!step4Result.ok) {
    return {
      ok: false,
      message: step4Result.message || "步骤 4 执行失败"
    }
  }

  onStage(4, step4Result.message)

  const step5Result = await confirmCodexOAuthConsent(authTabId, browserOptions)
  if (!step5Result.ok || !step5Result.callbackUrl) {
    return {
      ok: false,
      message: step5Result.message || "步骤 5 执行失败"
    }
  }

  onStage(5, step5Result.message)

  const step6Result = await submitCodexOAuthCallbackToCpa(
    cpaUrl,
    step5Result.callbackUrl,
    authTabId,
    browserOptions
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
 * 侧边栏主组件，负责管理多账号、执行登录流程和展示日志。
 *
 * @return React 侧边栏视图组件。
 */
function SidePanel() {
  const [loginForm] = Form.useForm<LoginFormValues>()
  const [accountForm] = Form.useForm<AccountFormValues>()
  const [cpaUrl, setCpaUrl] = useState("")
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [backgroundExecution, setBackgroundExecution] = useState(false)
  const [editingEmail, setEditingEmail] = useState("")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [runningEmail, setRunningEmail] = useState("")
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [debugEmail, setDebugEmail] = useState("")
  const [debugAuthTabId, setDebugAuthTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState<0 | DebugStep>(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const batchCancelRef = useRef(false)
  const batchAbortControllerRef = useRef<AbortController | null>(null)
  const logListRef = useRef<HTMLDivElement | null>(null)

  const log = useMemo(() => {
    return createUiLogger((level, message) => {
      setLogs((current) => {
        return [
          ...current,
          {
            id: `${Date.now()}-${current.length}`,
            time: getTimeLabel(),
            level,
            message
          }
        ]
      })
    })
  }, [])

  const persistState = (nextCpaUrl: string, nextAccounts: ManagedAccount[]) => {
    saveStoredState({
      cpaUrl: nextCpaUrl,
      accounts: nextAccounts,
      backgroundExecution
    })
  }

  const syncAccounts = (nextAccounts: ManagedAccount[]) => {
    setAccounts(nextAccounts)
    persistState(cpaUrl, nextAccounts)
  }

  const selectedDebugAccount = useMemo(() => {
    const normalizedDebugEmail = normalizeEmail(debugEmail)
    return (
      accounts.find((account) => {
        return normalizeEmail(account.email) === normalizedDebugEmail
      }) || null
    )
  }, [accounts, debugEmail])

  const parsedDebugAuthTabId = Number.parseInt(debugAuthTabId, 10)
  const hasDebugAuthTabId =
    Number.isFinite(parsedDebugAuthTabId) && parsedDebugAuthTabId > 0
  const selectedEmailSet = useMemo(() => {
    return new Set(selectedEmails.map((email) => normalizeEmail(email)))
  }, [selectedEmails])
  const selectedCount = selectedEmails.length
  const isAllAccountsSelected =
    accounts.length > 0 && selectedCount === accounts.length
  const isSomeAccountsSelected =
    selectedCount > 0 && selectedCount < accounts.length

  useEffect(() => {
    const element = logListRef.current
    if (!element) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [logs])

  useEffect(() => {
    void (async () => {
      const state = await loadStoredState()
      setCpaUrl(state.cpaUrl)
      setAccounts(state.accounts)
      setBackgroundExecution(state.backgroundExecution)
      loginForm.setFieldsValue({ cpaUrl: state.cpaUrl })
      setStatus(state.accounts.length > 0 ? "已加载本地账号" : "已加载本地配置")
    })()
  }, [loginForm])

  useEffect(() => {
    if (accounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugEmail = normalizeEmail(debugEmail)
    const hasCurrentDebugAccount = accounts.some((account) => {
      return normalizeEmail(account.email) === currentDebugEmail
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(accounts[0].email)
    }
  }, [accounts, debugEmail])

  useEffect(() => {
    const existingEmails = new Set(
      accounts.map((account) => normalizeEmail(account.email))
    )
    setSelectedEmails((currentSelectedEmails) => {
      return currentSelectedEmails.filter((email) => {
        return existingEmails.has(normalizeEmail(email))
      })
    })
  }, [accounts])

  /**
   * 保存 CPA 地址的实时变更。
   *
   * @param values 当前表单值。
   * @return 无。
   */
  const handleCpaUrlChange = (
    _: Partial<LoginFormValues>,
    values: LoginFormValues
  ) => {
    const nextCpaUrl = String(values.cpaUrl || "")
    setCpaUrl(nextCpaUrl)
    persistState(nextCpaUrl, accounts)
  }

  /**
   * 切换批量流程是否在后台标签页执行。
   *
   * @param checked 是否后台执行。
   * @return 无。
   */
  const handleBackgroundExecutionChange = (checked: boolean) => {
    setBackgroundExecution(checked)
    saveStoredState({
      cpaUrl,
      accounts,
      backgroundExecution: checked
    })
    setStatus(checked ? "已开启后台执行" : "已关闭后台执行")
    log.info(checked ? "已开启后台执行" : "已关闭后台执行")
  }

  /**
   * 保存或更新一个账号。
   *
   * @param values 当前表单值。
   * @return 无。
   */
  const handleSubmitAccount = (values: AccountFormValues) => {
    const email = normalizeEmail(String(values.email || ""))
    const password = String(values.password || "")

    if (!email || !password) {
      setStatus("请输入账号邮箱和密码")
      log.warn("账号邮箱和密码不能为空")
      return
    }

    const nextAccount = createManagedAccount(email, password)
    const nextAccounts = upsertManagedAccount(
      accounts,
      nextAccount,
      editingEmail || undefined
    )

    syncAccounts(nextAccounts)
    setEditingEmail("")
    // 添加账户后不清理，先注释掉后续看有没有必要
    // accountForm.resetFields()
    // accountForm.setFieldsValue(EMPTY_ACCOUNT_FORM)
    setStatus(`已保存账号 ${email}`)
    log.info(`已保存账号 ${email}`)
  }

  /**
   * 把某个账号填回编辑表单。
   *
   * @param account 需要编辑的账号。
   * @return 无。
   */
  const handleEditAccount = (account: ManagedAccount) => {
    setEditingEmail(account.email)
    accountForm.setFieldsValue({
      email: account.email,
      password: account.password
    })
    setStatus(`正在编辑 ${account.email}`)
  }

  /**
   * 取消当前编辑状态。
   *
   * @return 无。
   */
  const handleCancelEdit = () => {
    setEditingEmail("")
    accountForm.resetFields()
    accountForm.setFieldsValue(EMPTY_ACCOUNT_FORM)
    setStatus("已取消编辑")
  }

  /**
   * 删除一个账号。
   *
   * @param email 要删除的邮箱。
   * @return 无。
   */
  const handleRemoveAccount = (email: string) => {
    if (isBatchRunning) {
      return
    }

    const nextEmail = normalizeEmail(email)
    const nextAccounts = accounts.filter((account) => {
      return normalizeEmail(account.email) !== nextEmail
    })

    if (editingEmail && normalizeEmail(editingEmail) === nextEmail) {
      handleCancelEdit()
    }

    syncAccounts(nextAccounts)
    setStatus(`已删除账号 ${email}`)
    log.warn(`已删除账号 ${email}`)
  }

  /**
   * 切换单个账号的选中状态。
   *
   * @param email 账号邮箱。
   * @param checked 是否选中。
   * @return 无。
   */
  const handleToggleAccountSelected = (email: string, checked: boolean) => {
    const normalizedEmail = normalizeEmail(email)
    setSelectedEmails((currentSelectedEmails) => {
      const currentSet = new Set(
        currentSelectedEmails.map((item) => normalizeEmail(item))
      )

      if (checked) {
        currentSet.add(normalizedEmail)
      } else {
        currentSet.delete(normalizedEmail)
      }

      return accounts
        .map((account) => normalizeEmail(account.email))
        .filter((accountEmail) => currentSet.has(accountEmail))
    })
  }

  /**
   * 切换全部账号的选中状态。
   *
   * @param checked 是否全选。
   * @return 无。
   */
  const handleToggleAllAccountsSelected = (checked: boolean) => {
    setSelectedEmails(
      checked ? accounts.map((account) => normalizeEmail(account.email)) : []
    )
  }

  /**
   * 移动当前唯一选中的账号。
   *
   * @param direction 移动方向，-1 表示上移，1 表示下移。
   * @return 无。
   */
  const handleMoveSelectedAccount = (direction: -1 | 1) => {
    if (selectedEmails.length !== 1) {
      setStatus("上移或下移时只能选择一条账号")
      log.warn("上移或下移时只能选择一条账号")
      return
    }

    const selectedEmail = normalizeEmail(selectedEmails[0])
    const selectedIndex = accounts.findIndex((account) => {
      return normalizeEmail(account.email) === selectedEmail
    })

    if (selectedIndex < 0) {
      setStatus("未找到选中的账号")
      log.warn("未找到选中的账号，无法移动")
      return
    }

    const nextIndex = selectedIndex + direction
    if (nextIndex < 0 || nextIndex >= accounts.length) {
      setStatus(direction < 0 ? "选中账号已经在最上方" : "选中账号已经在最下方")
      return
    }

    const nextAccounts = [...accounts]
    const [movedAccount] = nextAccounts.splice(selectedIndex, 1)
    nextAccounts.splice(nextIndex, 0, movedAccount)
    syncAccounts(nextAccounts)
  }

  /**
   * 将当前选中的账号手动标记为已完成。
   *
   * @return 无。
   */
  const handleMarkSelectedAccountsDone = () => {
    if (isBatchRunning) {
      return
    }

    if (selectedEmails.length === 0) {
      setStatus("请先选择要标记的账号")
      log.warn("请先选择要标记的账号")
      return
    }

    const selectedSet = new Set(
      selectedEmails.map((email) => normalizeEmail(email))
    )
    let changedCount = 0
    const now = Date.now()
    const nextAccounts: ManagedAccount[] = accounts.map((account) => {
      if (!selectedSet.has(normalizeEmail(account.email))) {
        return account
      }

      changedCount += 1
      return {
        ...account,
        progress: STEP_COUNT as ManagedAccountProgress,
        status: "done" as const,
        lastMessage: "已手动标为已完成",
        updatedAt: now
      }
    })

    if (changedCount === 0) {
      setStatus("未找到选中的账号")
      log.warn("未找到选中的账号，无法标记")
      return
    }

    syncAccounts(nextAccounts)
    setStatus(`已标记 ${changedCount} 个账号为已完成`)
    log.info(`已标记 ${changedCount} 个账号为已完成`)
  }

  /**
   * 清空当前会话的日志列表。
   *
   * @return 无。
   */
  const handleClearLogs = () => {
    setLogs([])
    setStatus("日志已清空")
  }

  const patchDebugAccountState = (
    email: string,
    patch: Partial<ManagedAccount>
  ) => {
    const targetEmail = normalizeEmail(email)
    setAccounts((currentAccounts) => {
      const nextAccounts = currentAccounts.map((account) => {
        if (normalizeEmail(account.email) !== targetEmail) {
          return account
        }

        return {
          ...account,
          ...patch,
          updatedAt: Date.now()
        }
      })

      persistState(cpaUrl, nextAccounts)
      return nextAccounts
    })
  }

  /**
   * 使用当前激活的浏览器标签页作为调试用 auth tab。
   *
   * @return 无。
   */
  const handleUseActiveTabAsDebugAuthTab = async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (!activeTab?.id) {
      setStatus("未找到当前激活标签页")
      log.warn("未找到当前激活标签页，无法设置 auth tab")
      return
    }

    setDebugAuthTabId(String(activeTab.id))
    setStatus(`已使用当前标签页作为 auth tab：${activeTab.id}`)
    log.debug(
      `调试 auth tab 已设置为 ${activeTab.id}（${activeTab.url || "unknown"}）`
    )
  }

  /**
   * 执行调试控制台里的单个步骤。
   *
   * @param step 要执行的步骤编号。
   * @return 无。
   */
  const handleRunDebugStep = async (step: DebugStep) => {
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const account = selectedDebugAccount

    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("调试步骤无法执行：未填写 CPA 地址")
      return
    }

    if (!account) {
      setStatus("请先选择调试账号")
      log.warn("调试步骤无法执行：未选择账号")
      return
    }

    if (isBatchRunning || isDebugRunning) {
      return
    }

    if (step !== 1 && !hasDebugAuthTabId) {
      setStatus(`请先执行「${getFlowStepLabel(1)}」或手动设置 auth tab`)
      log.warn(
        `「${getFlowStepLabel(step)}」需要 auth tab，请先执行「${getFlowStepLabel(1)}」或点击“使用当前标签页”`
      )
      return
    }

    setIsDebugRunning(true)
    setRunningEmail(account.email)
    setStatus(`正在调试 ${account.email}：${getFlowStepLabel(step)}`)
    log.info(`[调试][${account.email}] 开始执行 ${getFlowStepLabel(step)}`)

    try {
      if (step === 1) {
        setDebugVerificationRequestedAt(0)
        setDebugCallbackUrl("")
        patchDebugAccountState(account.email, {
          progress: 0,
          status: "running",
          lastMessage: getFlowStepLabel(step)
        })

        const result = await openCodexAuthLink(normalizedCpaUrl)
        if (!result.ok || !result.targetTab?.id) {
          patchDebugAccountState(account.email, {
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(1)}失败`
          })
          setStatus(`${getFlowStepName(1)}失败`)
          log.warn(
            `[调试][${account.email}] ${result.message || `${getFlowStepName(1)}失败`}`
          )
          return
        }

        setDebugAuthTabId(String(result.targetTab.id))
        setDebugProgress(1)
        patchDebugAccountState(account.email, {
          progress: 1,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(1)}已完成`)
        log.info(
          `[调试][${account.email}] ${result.message}；auth tab=${result.targetTab.id}；url=${
            result.targetTab.url || "unknown"
          }`
        )
        return
      }

      if (step === 2) {
        const result = await submitCodexLoginEmailAndWait(
          parsedDebugAuthTabId,
          account.email
        )
        if (!result.ok) {
          patchDebugAccountState(account.email, {
            progress: Math.max(debugProgress, 1) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(2)}失败`
          })
          setStatus(`${getFlowStepName(2)}失败`)
          log.warn(
            `[调试][${account.email}] ${result.message || `${getFlowStepName(2)}失败`}`
          )
          return
        }

        if (result.verificationRequestedAt) {
          setDebugVerificationRequestedAt(result.verificationRequestedAt)
        }
        setDebugProgress(2)
        patchDebugAccountState(account.email, {
          progress: 2,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(2)}已完成`)
        log.info(`[调试][${account.email}] ${result.message}`)
        return
      }

      if (step === 3) {
        const result = await submitCodexLoginPasswordAndWait(
          parsedDebugAuthTabId,
          account.password
        )
        if (!result.ok) {
          patchDebugAccountState(account.email, {
            progress: Math.max(debugProgress, 2) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(3)}失败`
          })
          setStatus(`${getFlowStepName(3)}失败`)
          log.warn(
            `[调试][${account.email}] ${result.message || `${getFlowStepName(3)}失败`}`
          )
          return
        }

        if (result.verificationRequestedAt) {
          setDebugVerificationRequestedAt(result.verificationRequestedAt)
        }
        setDebugProgress(3)
        patchDebugAccountState(account.email, {
          progress: 3,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(3)}已完成`)
        log.info(`[调试][${account.email}] ${result.message}`)
        return
      }

      if (step === 4) {
        const result = await fetchAndSubmitCodexVerificationCode(
          parsedDebugAuthTabId,
          account.email,
          account.password,
          debugVerificationRequestedAt
        )
        if (!result.ok) {
          patchDebugAccountState(account.email, {
            progress: Math.max(debugProgress, 3) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(4)}失败`
          })
          setStatus(`${getFlowStepName(4)}失败`)
          log.warn(
            `[调试][${account.email}] ${result.message || `${getFlowStepName(4)}失败`}`
          )
          return
        }

        setDebugProgress(4)
        patchDebugAccountState(account.email, {
          progress: 4,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(4)}已完成`)
        log.info(`[调试][${account.email}] ${result.message}`)
        return
      }

      if (step === 5) {
        const result = await confirmCodexOAuthConsent(parsedDebugAuthTabId)
        if (!result.ok || !result.callbackUrl) {
          patchDebugAccountState(account.email, {
            progress: Math.max(debugProgress, 4) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(5)}失败`
          })
          setStatus(`${getFlowStepName(5)}失败`)
          log.warn(
            `[调试][${account.email}] ${result.message || `${getFlowStepName(5)}失败`}`
          )
          return
        }

        setDebugCallbackUrl(result.callbackUrl)
        setDebugProgress(5)
        patchDebugAccountState(account.email, {
          progress: 5,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(5)}已完成`)
        log.info(`[调试][${account.email}] ${result.message}`)
        return
      }

      if (!debugCallbackUrl) {
        setStatus(`请先执行「${getFlowStepLabel(5)}」获取 callback URL`)
        log.warn(`「${getFlowStepLabel(6)}」无法执行：缺少 callback URL`)
        return
      }

      const result = await submitCodexOAuthCallbackToCpa(
        normalizedCpaUrl,
        debugCallbackUrl,
        parsedDebugAuthTabId
      )
      if (!result.ok) {
        patchDebugAccountState(account.email, {
          progress: Math.max(debugProgress, 5) as ManagedAccount["progress"],
          status: "failed",
          lastMessage: result.message || `${getFlowStepName(6)}失败`
        })
        setStatus(`${getFlowStepName(6)}失败`)
        log.warn(
          `[调试][${account.email}] ${result.message || `${getFlowStepName(6)}失败`}`
        )
        return
      }

      setDebugProgress(6)
      patchDebugAccountState(account.email, {
        progress: 6,
        status: "done",
        lastMessage: result.message
      })
      setStatus(`${getFlowStepName(6)}已完成`)
      log.info(`[调试][${account.email}] ${result.message}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "调试步骤执行异常"
      patchDebugAccountState(account.email, {
        status: "failed",
        lastMessage: message
      })
      setStatus("调试步骤执行异常")
      log.warn(`[调试][${account.email}] ${message}`)
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
    }
  }

  /**
   * 按当前调试进度执行下一步。
   *
   * @return 无。
   */
  const handleRunNextDebugStep = () => {
    const nextStep = Math.min(
      STEP_COUNT,
      Math.max(1, debugProgress + 1)
    ) as DebugStep

    void handleRunDebugStep(nextStep)
  }

  /**
   * 顺序执行账号。
   *
   * pending 模式会跳过选中账号里已完成的；all 模式会重置并执行全部选中账号。
   *
   * @param mode 批量执行模式。
   * @return 无。
   */
  const handleStartBatch = async (mode: BatchRunMode) => {
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("未填写 CPA 地址")
      return
    }

    if (accounts.length === 0) {
      setStatus("请先添加至少一个账号")
      log.warn("账号列表为空")
      return
    }

    if (isBatchRunning) {
      return
    }

    if (selectedEmails.length === 0) {
      setStatus("请先选择要执行的账号")
      log.info("请先选择要执行的账号")
      return
    }

    const isTargetAccount = (account: ManagedAccount) => {
      if (mode === "all") {
        return selectedEmailSet.has(normalizeEmail(account.email))
      }

      return (
        selectedEmailSet.has(normalizeEmail(account.email)) &&
        !isManagedAccountDone(account)
      )
    }
    const runnableCount = accounts.filter(isTargetAccount).length
    if (runnableCount === 0) {
      const emptyMessage =
        mode === "pending" ? "选中的账号都已完成" : "没有需要执行的账号"
      setStatus(emptyMessage)
      log.info(emptyMessage)
      return
    }

    batchCancelRef.current = false
    const batchAbortController = new AbortController()
    batchAbortControllerRef.current = batchAbortController
    setIsBatchRunning(true)
    setRunningEmail("")

    let workingAccounts = accounts.map((account) => {
      return !isTargetAccount(account)
        ? account
        : resetManagedAccountState(account)
    })
    setAccounts(workingAccounts)
    persistState(normalizedCpaUrl, workingAccounts)

    const batchLabel = mode === "all" ? "选中账号" : "选中的未完成账号"
    setStatus(`开始执行 ${runnableCount} 个${batchLabel}`)
    log.info(`开始执行 ${runnableCount} 个${batchLabel}`)

    let currentRunnableIndex = 0
    for (let index = 0; index < workingAccounts.length; index += 1) {
      if (batchCancelRef.current) {
        setStatus("已停止批量执行")
        log.warn("批量执行已停止")
        break
      }

      const currentAccount = workingAccounts[index]
      if (!isTargetAccount(currentAccount)) {
        continue
      }

      currentRunnableIndex += 1
      setRunningEmail(currentAccount.email)
      setStatus(
        `正在处理 ${currentAccount.email}（${currentRunnableIndex}/${runnableCount}）`
      )
      log.info(`开始处理账号 ${currentAccount.email}`)

      const updateCurrentAccount = (
        patch: Partial<ManagedAccount>
      ): ManagedAccount[] => {
        const nextAccounts = [...workingAccounts]
        nextAccounts[index] = {
          ...nextAccounts[index],
          ...patch,
          updatedAt: Date.now()
        }
        // 这一行为了最终persistState持久化的时候拿到正确值
        workingAccounts = nextAccounts
        // 这个set是为了触发UI更新
        setAccounts(nextAccounts)
        // 这个是为了持久化，下次继续从断点处执行
        persistState(normalizedCpaUrl, nextAccounts)
        return nextAccounts
      }

      updateCurrentAccount({
        status: "running",
        lastMessage: "正在打开登录页"
      })

      let runResult: AccountRunResult
      try {
        runResult = await runManagedAccountFlow(
          normalizedCpaUrl,
          currentAccount,
          (progress, message) => {
            const nextStatus: ManagedAccountStatus =
              progress === STEP_COUNT ? "done" : "running"
            updateCurrentAccount({
              progress,
              status: nextStatus,
              lastMessage: message
            })
            setStatus(
              `账号 ${currentAccount.email} 已完成「${getFlowStepLabel(progress)}」`
            )
            log.info(`[${currentAccount.email}] ${message}`)
          },
          {
            backgroundExecution,
            abortSignal: batchAbortController.signal
          }
        )
      } catch (error) {
        runResult = {
          ok: false,
          message:
            error instanceof Error ? error.message : "账号自动执行时发生异常"
        }
      }

      if (batchCancelRef.current) {
        updateCurrentAccount({
          status: "failed",
          lastMessage: runResult.message || "已停止当前流程"
        })
        setStatus("已停止当前流程")
        log.warn(
          `[${currentAccount.email}] ${runResult.message || "已停止当前流程"}`
        )
        break
      }

      if (runResult.ok) {
        updateCurrentAccount({
          progress: STEP_COUNT,
          status: "done",
          lastMessage: runResult.message
        })
        log.info(`[${currentAccount.email}] ${runResult.message}`)
        continue
      }

      const currentState = workingAccounts[index]
      updateCurrentAccount({
        progress: currentState.progress,
        status: "failed",
        lastMessage: runResult.message
      })
      setStatus(`账号 ${currentAccount.email} 执行失败`)
      log.warn(`[${currentAccount.email}] ${runResult.message}`)
    }

    setRunningEmail("")
    setIsBatchRunning(false)
    batchAbortControllerRef.current = null
    setStatus(
      batchCancelRef.current ? "已停止批量执行" : `${batchLabel}执行已结束`
    )
  }

  /**
   * 停止批量执行。
   *
   * @return 无。
   */
  const handleStopBatch = () => {
    batchCancelRef.current = true
    batchAbortControllerRef.current?.abort()
    setStatus("正在停止当前流程")
    log.warn("收到停止请求，等待当前步骤结束")
  }

  const completedCount = accounts.filter((account) =>
    isManagedAccountDone(account)
  ).length
  const runningCount = accounts.filter(
    (account) => account.status === "running"
  ).length
  const failedCount = accounts.filter(
    (account) => account.status === "failed"
  ).length

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 8,
          colorPrimary: "#1677ff",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}>
      <main className="sidepanel-shell">
        <header className="panel-header">
          <div className="brand-block">
            <h1 className="brand-title">codex-login</h1>
            <p className="brand-subtitle">多账号登录助手</p>
          </div>
          <Tag color="processing">{status}</Tag>
        </header>

        <section className="panel-stack">
          <Card className="panel-card" title="CPA 地址">
            <Form
              form={loginForm}
              layout="vertical"
              requiredMark={false}
              onValuesChange={handleCpaUrlChange}>
              <Form.Item
                label="CPA 地址"
                name="cpaUrl"
                rules={[{ required: true, message: "请输入 CPA 地址" }]}>
                <Input
                  placeholder="https://..."
                  allowClear
                  disabled={isBatchRunning}
                />
              </Form.Item>
              <Form.Item label="执行设置">
                <Space align="center" size={8} wrap>
                  <Switch
                    checked={backgroundExecution}
                    disabled={isBatchRunning}
                    onChange={handleBackgroundExecutionChange}
                  />
                  <span>后台执行</span>
                  <Typography.Text type="secondary">
                    批量执行时不主动激活标签页
                  </Typography.Text>
                </Space>
              </Form.Item>
            </Form>
          </Card>

          <Card
            className="panel-card"
            title="账号管理"
            extra={
              <Space size={8}>
                <Tag color="success">已完成 {completedCount}</Tag>
                <Tag color="processing">执行中 {runningCount}</Tag>
                <Tag color="error">失败 {failedCount}</Tag>
              </Space>
            }>
            <Form
              form={accountForm}
              layout="vertical"
              requiredMark={false}
              onFinish={handleSubmitAccount}>
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入邮箱" },
                  { type: "email", message: "邮箱格式不正确" }
                ]}>
                <Input
                  placeholder="name@example.com"
                  allowClear
                  disabled={isBatchRunning}
                />
              </Form.Item>

              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}>
                <Input.Password
                  placeholder="请输入密码"
                  disabled={isBatchRunning}
                />
              </Form.Item>

              <Space size={8} wrap>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={isBatchRunning}>
                  {editingEmail ? "更新账号" : "添加账号"}
                </Button>
                <Button
                  onClick={handleCancelEdit}
                  disabled={isBatchRunning || !editingEmail}>
                  取消编辑
                </Button>
              </Space>
            </Form>
          </Card>

          <Card className="panel-card" title="账号列表">
            {accounts.length > 0 ? (
              <div className="account-toolbar">
                <div className="account-toolbar-main">
                  <Checkbox
                    checked={isAllAccountsSelected}
                    indeterminate={isSomeAccountsSelected}
                    disabled={isBatchRunning || accounts.length === 0}
                    onChange={(event) => {
                      handleToggleAllAccountsSelected(event.target.checked)
                    }}>
                    全选
                  </Checkbox>
                  <Tag color="default">{`已选 ${selectedCount}`}</Tag>
                </div>
                <div className="account-toolbar-secondary">
                  {isBatchRunning ? (
                    <Button danger onClick={handleStopBatch}>
                      停止当前流程
                    </Button>
                  ) : (
                    <Dropdown.Button
                      type="primary"
                      trigger={["click"]}
                      disabled={!cpaUrl.trim() || selectedCount === 0}
                      menu={{
                        items: [
                          {
                            key: "all",
                            label: "全部执行"
                          }
                        ],
                        onClick: () => {
                          void handleStartBatch("all")
                        }
                      }}
                      onClick={() => {
                        void handleStartBatch("pending")
                      }}>
                      执行未完成
                    </Dropdown.Button>
                  )}
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "move-up",
                          label: "上移"
                        },
                        {
                          key: "move-down",
                          label: "下移"
                        },
                        {
                          type: "divider"
                        },
                        {
                          key: "mark-done",
                          label: "标为已完成"
                        }
                      ],
                      onClick: ({ key }) => {
                        if (key === "mark-done") {
                          handleMarkSelectedAccountsDone()
                          return
                        }

                        handleMoveSelectedAccount(key === "move-up" ? -1 : 1)
                      }
                    }}>
                    <Button disabled={isBatchRunning || selectedCount === 0}>
                      更多
                    </Button>
                  </Dropdown>
                </div>
              </div>
            ) : null}
            {accounts.length > 0 ? (
              <div className="account-list">
                {accounts.map((account, index) => {
                  const statusMeta = STATUS_META[account.status]
                  return (
                    <div
                      className={`account-row account-row--${account.status} ${
                        runningEmail === account.email
                          ? "account-row--active"
                          : ""
                      }`}
                      key={account.email}>
                      <div className="account-select">
                        <Checkbox
                          checked={selectedEmailSet.has(
                            normalizeEmail(account.email)
                          )}
                          disabled={isBatchRunning}
                          onChange={(event) => {
                            handleToggleAccountSelected(
                              account.email,
                              event.target.checked
                            )
                          }}
                        />
                      </div>
                      <div className="account-main">
                        <div className="account-head">
                          <span className="account-email" title={account.email}>
                            {account.email}
                          </span>
                          <Space className="account-status-tags" size={6}>
                            <Tag variant="filled">{`${account.progress}/${STEP_COUNT}`}</Tag>
                            <Tag variant="filled" color={statusMeta.color}>
                              {statusMeta.label}
                            </Tag>
                          </Space>
                        </div>
                        <div className="account-meta">
                          {getAccountProgressSummary(account)}
                        </div>
                      </div>

                      <div className="account-actions">
                        <div className="account-inline-actions">
                          <Button
                            aria-label="编辑"
                            className="account-icon-button"
                            size="small"
                            title="编辑"
                            onClick={() => {
                              handleEditAccount(account)
                            }}
                            disabled={isBatchRunning}>
                            <span className="account-action-icon">✎</span>
                            <span className="account-action-text">编辑</span>
                          </Button>
                          <Button
                            aria-label="删除"
                            className="account-icon-button"
                            size="small"
                            title="删除"
                            danger
                            onClick={() => {
                              handleRemoveAccount(account.email)
                            }}
                            disabled={isBatchRunning}>
                            <span className="account-action-icon">×</span>
                            <span className="account-action-text">删除</span>
                          </Button>
                        </div>
                        <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              {
                                key: "edit",
                                label: "编辑",
                                disabled: isBatchRunning
                              },
                              {
                                type: "divider"
                              },
                              {
                                key: "remove",
                                label: "删除",
                                danger: true,
                                disabled: isBatchRunning
                              }
                            ],
                            onClick: ({ key }) => {
                              if (key === "edit") {
                                handleEditAccount(account)
                                return
                              }

                              if (key === "remove") {
                                handleRemoveAccount(account.email)
                              }
                            }
                          }}>
                          <Button
                            className="account-menu-actions"
                            size="small"
                            disabled={isBatchRunning}>
                            操作
                          </Button>
                        </Dropdown>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Typography.Text type="secondary">
                    还没有账号，先添加一个吧
                  </Typography.Text>
                }
              />
            )}
          </Card>

          <Card
            className="panel-card"
            title="调试控制台"
            extra={
              <Tag color="default">{`当前进度 ${debugProgress}/${STEP_COUNT}`}</Tag>
            }>
            <div className="debug-panel">
              <div className="debug-row">
                <div className="debug-field">
                  <span className="debug-label">账号</span>
                  <Select
                    value={debugEmail || undefined}
                    placeholder="选择账号"
                    options={accounts.map((account) => {
                      return {
                        label: account.email,
                        value: account.email
                      }
                    })}
                    onChange={(value) => {
                      setDebugEmail(value)
                      setDebugProgress(0)
                      setDebugVerificationRequestedAt(0)
                      setDebugCallbackUrl("")
                    }}
                    disabled={
                      isBatchRunning || isDebugRunning || accounts.length === 0
                    }
                  />
                </div>

                <div className="debug-field">
                  <span className="debug-label">Auth tab</span>
                  <Input
                    value={debugAuthTabId}
                    placeholder="tabId"
                    inputMode="numeric"
                    onChange={(event) => {
                      setDebugAuthTabId(
                        event.target.value.replace(/[^\d]/g, "")
                      )
                    }}
                    disabled={isBatchRunning || isDebugRunning}
                  />
                </div>
              </div>

              <Space size={8} wrap>
                <Button
                  type="primary"
                  onClick={handleRunNextDebugStep}
                  loading={isDebugRunning}
                  disabled={
                    isBatchRunning || isDebugRunning || !selectedDebugAccount
                  }>
                  下一步
                </Button>
                <Button
                  onClick={() => {
                    void handleUseActiveTabAsDebugAuthTab()
                  }}
                  disabled={isBatchRunning || isDebugRunning}>
                  使用当前标签页
                </Button>
                <Button
                  onClick={() => {
                    setDebugAuthTabId("")
                    setDebugProgress(0)
                    setDebugVerificationRequestedAt(0)
                    setDebugCallbackUrl("")
                    setStatus("调试状态已清空")
                  }}
                  disabled={isBatchRunning || isDebugRunning}>
                  清空调试状态
                </Button>
              </Space>

              <Space size={8} wrap>
                <Button
                  type="primary"
                  onClick={() => {
                    void handleRunDebugStep(1)
                  }}
                  loading={isDebugRunning && debugProgress === 0}
                  disabled={
                    isBatchRunning || isDebugRunning || !selectedDebugAccount
                  }>
                  {getFlowStepLabel(1)}
                </Button>
                <Button
                  onClick={() => {
                    void handleRunDebugStep(2)
                  }}
                  disabled={
                    isBatchRunning ||
                    isDebugRunning ||
                    !selectedDebugAccount ||
                    !hasDebugAuthTabId
                  }>
                  {getFlowStepLabel(2)}
                </Button>
                <Button
                  onClick={() => {
                    void handleRunDebugStep(3)
                  }}
                  disabled={
                    isBatchRunning ||
                    isDebugRunning ||
                    !selectedDebugAccount ||
                    !hasDebugAuthTabId
                  }>
                  {getFlowStepLabel(3)}
                </Button>
                <Button
                  onClick={() => {
                    void handleRunDebugStep(4)
                  }}
                  disabled={
                    isBatchRunning ||
                    isDebugRunning ||
                    !selectedDebugAccount ||
                    !hasDebugAuthTabId
                  }>
                  {getFlowStepLabel(4)}
                </Button>
                <Button
                  onClick={() => {
                    void handleRunDebugStep(5)
                  }}
                  disabled={
                    isBatchRunning ||
                    isDebugRunning ||
                    !selectedDebugAccount ||
                    !hasDebugAuthTabId
                  }>
                  {getFlowStepLabel(5)}
                </Button>
                <Button
                  onClick={() => {
                    void handleRunDebugStep(6)
                  }}
                  disabled={
                    isBatchRunning ||
                    isDebugRunning ||
                    !selectedDebugAccount ||
                    !hasDebugAuthTabId ||
                    !debugCallbackUrl
                  }>
                  {getFlowStepLabel(6)}
                </Button>
              </Space>
            </div>
          </Card>

          <Card
            className="panel-card"
            title="执行日志"
            extra={
              <Button size="small" onClick={handleClearLogs}>
                清空
              </Button>
            }>
            {logs.length > 0 ? (
              <div className="log-list" ref={logListRef}>
                {logs.map((logItem) => {
                  const levelMeta = LOG_LEVEL_META[logItem.level]
                  return (
                    <div className="log-row" key={logItem.id}>
                      <span className="log-time">{logItem.time}</span>
                      <span className="log-content">
                        <Tag
                          className="log-level-tag"
                          color={levelMeta.color}
                          variant="filled">
                          {levelMeta.label}
                        </Tag>
                        <span className="log-message">{logItem.message}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Typography.Text type="secondary">暂无日志</Typography.Text>
                }
              />
            )}
          </Card>

          <Space size={8} wrap>
            <Tag>本地保存</Tag>
            <Tag>多账号</Tag>
            <Tag>顺序执行</Tag>
            <Tag>循环启动</Tag>
          </Space>
        </section>
      </main>
    </ConfigProvider>
  )
}

export default SidePanel
