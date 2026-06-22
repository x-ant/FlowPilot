import { Button, Card, ConfigProvider, Empty, Form, Input, Space, Tag, theme, Typography } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useMemo, useRef, useState } from "react";



import { completeCodexLoginEmailAuthFlow, confirmCodexOAuthAndSubmitCallback, openCodexAuthLink } from "./background/codex-login";



import "antd/dist/reset.css";
import "./sidepanel.css";



import { createUiLogger, getTimeLabel, LOG_LEVEL_META, type LogItem } from "./shared/logging";


type LoginFormValues = {
  loginUrl?: string
}

type AccountFormValues = {
  email?: string
  password?: string
}

type ManagedAccountStatus = "idle" | "running" | "done" | "failed"

type ManagedAccount = {
  email: string
  password: string
  progress: 0 | 1 | 2 | 3
  status: ManagedAccountStatus
  lastMessage: string
  updatedAt: number
}

type StoredState = {
  loginUrl: string
  accounts: ManagedAccount[]
}

type AccountRunResult = {
  ok: boolean
  message: string
}

const LOGIN_URL_STORAGE_KEY = "codex-login:login-url"
const ACCOUNTS_STORAGE_KEY = "codex-login:accounts"

const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  email: "",
  password: ""
}

const STATUS_META: Record<ManagedAccountStatus, { label: string; color: string }> = {
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
  return String(value || "").trim().toLowerCase()
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

  const progress = [0, 1, 2, 3].includes(Number(record.progress))
    ? (Number(record.progress) as 0 | 1 | 2 | 3)
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
  let nextAccounts : ManagedAccount[];
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
 * 交换列表中的两个账号位置。
 *
 * @param accounts 当前账号列表。
 * @param fromIndex 起始位置。
 * @param toIndex 目标位置。
 * @return 调整后的账号列表。
 */
const moveManagedAccount = (
  accounts: ManagedAccount[],
  fromIndex: number,
  toIndex: number
) => {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= accounts.length ||
    toIndex >= accounts.length ||
    fromIndex === toIndex
  ) {
    return accounts
  }

  const nextAccounts = [...accounts]
  const [movedAccount] = nextAccounts.splice(fromIndex, 1)
  nextAccounts.splice(toIndex, 0, movedAccount)
  return nextAccounts
}

/**
 * 读取本地保存的账号状态。
 *
 * @return 登录地址和账号列表。
 */
const loadStoredState = async (): Promise<StoredState> => {
  const storage = getStorage()
  if (!storage) {
    return {
      loginUrl: "",
      accounts: []
    }
  }

  return new Promise<StoredState>((resolve) => {
    storage.get([LOGIN_URL_STORAGE_KEY, ACCOUNTS_STORAGE_KEY], (result) => {
      const loginUrl = String(result?.[LOGIN_URL_STORAGE_KEY] || "").trim()
      const rawAccounts = Array.isArray(result?.[ACCOUNTS_STORAGE_KEY]) ? (result?.[ACCOUNTS_STORAGE_KEY] as unknown[]) : []
      const accounts = rawAccounts
        .map((account) => normalizeStoredAccount(account))
        .filter((account): account is ManagedAccount => Boolean(account))

      resolve({
        loginUrl,
        accounts
      })
    })
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
    [LOGIN_URL_STORAGE_KEY]: state.loginUrl,
    [ACCOUNTS_STORAGE_KEY]: state.accounts
  })
}

/**
 * 运行一个账号的完整登录流程。
 *
 * @param loginUrl Codex 登录地址。
 * @param account 当前账号。
 * @param onStage 完成每一步后的回调。
 * @return 流程结果。
 */
const runManagedAccountFlow = async (
  loginUrl: string,
  account: ManagedAccount,
  onStage: (progress: 1 | 2 | 3, message: string) => void
): Promise<AccountRunResult> => {
  const step1Result = await openCodexAuthLink(loginUrl)
  if (!step1Result.ok || !step1Result.targetTab?.id) {
    return {
      ok: false,
      message: step1Result.message || "步骤 1 执行失败"
    }
  }

  onStage(1, step1Result.message)

  const authTabId = step1Result.targetTab.id
  const step2Result = await completeCodexLoginEmailAuthFlow(
    authTabId,
    account.email,
    account.password
  )
  if (!step2Result.ok) {
    return {
      ok: false,
      message: step2Result.message || "步骤 2 执行失败"
    }
  }

  onStage(2, step2Result.message)

  const step3Result = await confirmCodexOAuthAndSubmitCallback(
    authTabId,
    loginUrl
  )
  if (!step3Result.ok) {
    return {
      ok: false,
      message: step3Result.message || "步骤 3 执行失败"
    }
  }

  onStage(3, step3Result.message)

  return {
    ok: true,
    message: [step1Result.message, step2Result.message, step3Result.message]
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
  const [loginUrl, setLoginUrl] = useState("")
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [editingEmail, setEditingEmail] = useState("")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [runningEmail, setRunningEmail] = useState("")
  const batchCancelRef = useRef(false)
  const logListRef = useRef<HTMLDivElement | null>(null)

  const storage = useMemo(getStorage, [])
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

  const persistState = (nextLoginUrl: string, nextAccounts: ManagedAccount[]) => {
    saveStoredState({
      loginUrl: nextLoginUrl,
      accounts: nextAccounts
    })
  }

  const syncAccounts = (nextAccounts: ManagedAccount[]) => {
    setAccounts(nextAccounts)
    persistState(loginUrl, nextAccounts)
  }

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
      setLoginUrl(state.loginUrl)
      setAccounts(state.accounts)
      loginForm.setFieldsValue({ loginUrl: state.loginUrl })
      setStatus(state.accounts.length > 0 ? "已加载本地账号" : "已加载本地配置")

      if (state.accounts.length > 0 && storage) {
        persistState(state.loginUrl, state.accounts)
      }
    })()
  }, [loginForm, storage])

  /**
   * 保存登录地址的实时变更。
   *
   * @param values 当前表单值。
   * @return 无。
   */
  const handleLoginUrlChange = (_: Partial<LoginFormValues>, values: LoginFormValues) => {
    const nextLoginUrl = String(values.loginUrl || "")
    setLoginUrl(nextLoginUrl)
    persistState(nextLoginUrl, accounts)
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
    accountForm.resetFields()
    accountForm.setFieldsValue(EMPTY_ACCOUNT_FORM)
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
   * 调整账号顺序。
   *
   * @param index 当前索引。
   * @param direction 调整方向，-1 表示上移，1 表示下移。
   * @return 无。
   */
  const handleMoveAccount = (index: number, direction: -1 | 1) => {
    if (isBatchRunning) {
      return
    }

    const nextIndex = index + direction
    const nextAccounts = moveManagedAccount(accounts, index, nextIndex)
    if (nextAccounts === accounts) {
      return
    }

    syncAccounts(nextAccounts)
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

  /**
   * 启动所有账号的顺序执行。
   *
   * @return 无。
   */
  const handleStartBatch = async () => {
    const normalizedLoginUrl = String(loginUrl || "").trim()
    if (!normalizedLoginUrl) {
      setStatus("请先填写 Codex 登录地址")
      log.warn("未填写 Codex 登录地址")
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

    batchCancelRef.current = false
    setIsBatchRunning(true)
    setRunningEmail("")

    let workingAccounts = accounts.map((account) => resetManagedAccountState(account))
    setAccounts(workingAccounts)
    persistState(normalizedLoginUrl, workingAccounts)

    setStatus(`开始循环 ${workingAccounts.length} 个账号`)
    log.info(`开始循环 ${workingAccounts.length} 个账号`)

    for (let index = 0; index < workingAccounts.length; index += 1) {
      if (batchCancelRef.current) {
        setStatus("已停止循环")
        log.warn("循环已停止")
        break
      }

      const currentAccount = workingAccounts[index]
      setRunningEmail(currentAccount.email)
      setStatus(
        `正在处理 ${currentAccount.email}（${index + 1}/${workingAccounts.length}）`
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
        persistState(normalizedLoginUrl, nextAccounts)
        return nextAccounts
      }

      updateCurrentAccount({
        status: "running",
        lastMessage: "正在打开登录页"
      })

      const runResult = await runManagedAccountFlow(
        normalizedLoginUrl,
        currentAccount,
        (progress, message) => {
          const nextStatus: ManagedAccountStatus =
            progress === 3 ? "done" : "running"
          updateCurrentAccount({
            progress,
            status: nextStatus,
            lastMessage: message
          })
          setStatus(`账号 ${currentAccount.email} 已完成第 ${progress} 步`)
          log.info(`[${currentAccount.email}] ${message}`)
        }
      )

      if (runResult.ok) {
        updateCurrentAccount({
          progress: 3,
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
    if (!batchCancelRef.current) {
      setStatus("账号循环已结束")
    }
  }

  /**
   * 停止批量执行。
   *
   * @return 无。
   */
  const handleStopBatch = () => {
    batchCancelRef.current = true
    setStatus("正在停止当前流程")
    log.warn("收到停止请求，等待当前步骤结束")
  }

  const completedCount = accounts.filter((account) => account.status === "done").length
  const runningCount = accounts.filter((account) => account.status === "running").length
  const failedCount = accounts.filter((account) => account.status === "failed").length

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
          <Card className="panel-card" title="登录地址">
            <Form
              form={loginForm}
              layout="vertical"
              requiredMark={false}
              onValuesChange={handleLoginUrlChange}>
              <Form.Item
                label="Codex 登录地址"
                name="loginUrl"
                rules={[{ required: true, message: "请输入 Codex 登录地址" }]}>
                <Input placeholder="https://..." allowClear disabled={isBatchRunning} />
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
                <Input placeholder="name@example.com" allowClear disabled={isBatchRunning} />
              </Form.Item>

              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}>
                <Input.Password placeholder="请输入密码" disabled={isBatchRunning} />
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

          <Card
            className="panel-card"
            title="账号列表"
            extra={
              <Space size={8} wrap>
                <Button
                  type="primary"
                  onClick={() => {
                    void handleStartBatch()
                  }}
                  loading={isBatchRunning}
                  disabled={!loginUrl.trim() || accounts.length === 0}>
                  启动循环
                </Button>
                <Button
                  danger
                  onClick={handleStopBatch}
                  disabled={!isBatchRunning}>
                  停止
                </Button>
              </Space>
            }>
            {accounts.length > 0 ? (
              <div className="account-list">
                {accounts.map((account, index) => {
                  const statusMeta = STATUS_META[account.status]
                  return (
                    <div
                      className={`account-row account-row--${account.status} ${
                        runningEmail === account.email ? "account-row--active" : ""
                      }`}
                      key={account.email}>
                      <div className="account-main">
                        <div className="account-head">
                          <span className="account-email">{account.email}</span>
                          <Space size={6} wrap>
                            <Tag bordered={false}>{`${account.progress}/3`}</Tag>
                            <Tag bordered={false} color={statusMeta.color}>
                              {statusMeta.label}
                            </Tag>
                          </Space>
                        </div>
                        <div className="account-meta">
                          {account.lastMessage || "等待执行"}
                        </div>
                      </div>

                      <div className="account-actions">
                        <Button
                          size="small"
                          onClick={() => {
                            handleEditAccount(account)
                          }}
                          disabled={isBatchRunning}>
                          编辑
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            handleMoveAccount(index, -1)
                          }}
                          disabled={isBatchRunning || index === 0}>
                          上移
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            handleMoveAccount(index, 1)
                          }}
                          disabled={isBatchRunning || index === accounts.length - 1}>
                          下移
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={() => {
                            handleRemoveAccount(account.email)
                          }}
                          disabled={isBatchRunning}>
                          删除
                        </Button>
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
                          bordered={false}>
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
