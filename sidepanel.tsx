import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  theme
} from "antd"
import zhCN from "antd/locale/zh_CN"
import "antd/dist/reset.css"

import "./sidepanel.css"

type Settings = {
  loginUrl?: string
  email?: string
  password?: string
}

type LogItem = {
  id: string
  time: string
  message: string
}

type Stats = {
  total: number
  success: number
  failed: number
}

type StartCodexLoginResponse = {
  ok: boolean
  message: string
  tabId?: number
  url?: string
}

type CodexLoginMessageType =
  | "codex-login:start"
  | "codex-login:open-auth-link"

const STORAGE_KEY = "codex-login:settings"
const STEP_CLICK_CODEX_LOGIN = "click-codex-login"
const STEP_OPEN_AUTH_LINK = "open-auth-link"

const initialStats: Stats = {
  total: 0,
  success: 0,
  failed: 0
}

/**
 * 获取 Chrome 扩展的本地存储对象。
 *
 * 这里先做环境判断，避免在非扩展环境下直接访问 chrome.storage 导致报错。
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
 * 生成当前时间字符串，用于日志显示。
 *
 * @return 按 `HH:mm:ss` 格式生成的当前时间字符串。
 */
const getTime = () => {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date())
}

/**
 * 对邮箱做简单脱敏，方便在日志里展示但不直接暴露完整账号。
 *
 * @param email 原始邮箱地址。
 * @return 脱敏后的邮箱字符串；如果没有传入邮箱则返回“未填写账号”。
 */
const maskEmail = (email?: string) => {
  if (!email) {
    return "未填写账号"
  }

  const [name, domain] = email.split("@")
  if (!domain) {
    return email
  }

  const visibleName = name.slice(0, 3)
  return `${visibleName}${name.length > 3 ? "***" : "*"}@${domain}`
}

/**
 * 向后台发送通用的 Codex 登录控制消息。
 *
 * 这个方法把侧边栏和 background 的消息协议统一封装起来，避免重复写 sendMessage。
 *
 * @param type 要发送的消息类型。
 * @param loginUrl 侧边栏里填写的 Codex 登录地址。
 * @return 后台返回的执行结果；如果发送失败，会返回 ok=false 的错误对象。
 */
const sendCodexLoginMessage = (
  type: CodexLoginMessageType,
  loginUrl: string
) => {
  return new Promise<StartCodexLoginResponse>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      resolve({
        ok: false,
        message: "当前环境无法调用 Chrome 扩展后台脚本"
      })
      return
    }

    chrome.runtime.sendMessage(
      {
        type,
        payload: { loginUrl }
      },
      (response?: StartCodexLoginResponse) => {
        const error = chrome.runtime.lastError
        if (error) {
          resolve({
            ok: false,
            message: error.message || "后台脚本未响应"
          })
          return
        }

        resolve(
          response ?? {
            ok: false,
            message: "后台脚本未返回执行结果"
          }
        )
      }
    )
  })
}

/**
 * 发送“开始 Codex 登录”步骤消息。
 *
 * @param loginUrl 侧边栏里填写的 Codex 登录地址。
 * @return 后台返回的执行结果。
 */
const sendStartCodexLogin = (loginUrl: string) => {
  return sendCodexLoginMessage("codex-login:start", loginUrl)
}

/**
 * 发送“打开授权链接”步骤消息。
 *
 * @param loginUrl 侧边栏里填写的 Codex 登录地址。
 * @return 后台返回的执行结果。
 */
const sendOpenCodexAuthLink = (loginUrl: string) => {
  return sendCodexLoginMessage("codex-login:open-auth-link", loginUrl)
}

/**
 * 侧边栏主组件，负责展示表单、执行步骤、统计信息和日志。
 *
 * @return React 侧边栏视图组件。
 */
function SidePanel() {
  const [form] = Form.useForm<Settings>()
  const [status, setStatus] = useState("准备就绪")
  const [stats, setStats] = useState(initialStats)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [runningStep, setRunningStep] = useState<string | null>(null)

  const storage = useMemo(getStorage, [])

  /**
   * 把新日志插到列表最前面，便于先看到最新执行结果。
   *
   * @param message 要记录的日志内容。
   * @return 无。
   */
  const addLog = (message: string) => {
    setLogs((current) => {
      return [
        {
          id: `${Date.now()}-${current.length}`,
          time: getTime(),
          message
        },
        ...current
      ]
    })
  }

  useEffect(() => {
    // 页面初始化时尝试读取本地保存的登录配置。
    storage?.get(STORAGE_KEY, (result) => {
      const saved = result?.[STORAGE_KEY] as Settings | undefined
      if (saved) {
        form.setFieldsValue(saved)
        setStatus("已加载本地配置")
      }
    })
  }, [form, storage])

  /**
   * 监听表单变化并即时保存到本地。
   *
   * @param _ 当前字段变更摘要，保留给 antd Form 使用。
   * @param values 当前表单完整值。
   * @return 无。
   */
  const handleValuesChange = (_: Partial<Settings>, values: Settings) => {
    storage?.set({ [STORAGE_KEY]: values })
  }

  /**
   * 执行步骤 1：点击“开始 codex 登录”按钮。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleClickCodexLoginStep = async () => {
    try {
      setRunningStep(STEP_CLICK_CODEX_LOGIN)
      const values = await form.validateFields(["loginUrl"])
      const loginUrl = values.loginUrl?.trim()

      if (!loginUrl) {
        throw new Error("Codex 登录地址不能为空")
      }

      setStatus("正在打开 Codex 管理页")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      addLog("步骤 1 准备点击“开始codex登录”按钮")

      const result = await sendStartCodexLogin(loginUrl)

      if (!result.ok) {
        setStatus("步骤 1 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        addLog(`步骤 1 ${result.message}`)
        return
      }

      setStatus("步骤 1 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      addLog(`步骤 1 ${result.message}`)
    } catch {
      setStatus("步骤 1 需要登录地址")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1,
          failed: current.failed + 1
        }
      })
      addLog("步骤 1 Codex 登录地址不能为空")
    } finally {
      setRunningStep(null)
    }
  }

  /**
   * 执行步骤 2：先清理旧 cookie，再点击“打开链接”按钮。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleOpenAuthLinkStep = async () => {
    try {
      setRunningStep(STEP_OPEN_AUTH_LINK)
      const values = await form.validateFields(["loginUrl"])
      const loginUrl = values.loginUrl?.trim()

      if (!loginUrl) {
        throw new Error("Codex 登录地址不能为空")
      }

      setStatus("正在清理旧登录信息并打开授权链接")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      addLog("步骤 2 准备清理旧登录信息并点击“打开链接”按钮")

      const result = await sendOpenCodexAuthLink(loginUrl)

      if (!result.ok) {
        setStatus("步骤 2 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        addLog(`步骤 2 ${result.message}`)
        return
      }

      setStatus("步骤 2 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      addLog(`步骤 2 ${result.message}`)
    } catch {
      setStatus("步骤 2 需要登录地址")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1,
          failed: current.failed + 1
        }
      })
      addLog("步骤 2 Codex 登录地址不能为空")
    } finally {
      setRunningStep(null)
    }
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
            <p className="brand-subtitle">单账号登录助手</p>
          </div>
          <Tag color="processing">{status}</Tag>
        </header>

        <section className="panel-stack">
          <Card className="panel-card" title="登录信息">
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onValuesChange={handleValuesChange}>
              <Form.Item
                label="Codex 登录地址"
                name="loginUrl"
                rules={[{ required: true, message: "请输入 Codex 登录地址" }]}>
                <Input placeholder="https://..." allowClear />
              </Form.Item>

              <Form.Item
                label="2925 邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入 2925 邮箱" },
                  { type: "email", message: "邮箱格式不正确" }
                ]}>
                <Input placeholder="name@example.com" allowClear />
              </Form.Item>

              <Form.Item
                label="邮箱密码"
                name="password"
                rules={[{ required: true, message: "请输入邮箱密码" }]}>
                <Input.Password placeholder="请输入密码" />
              </Form.Item>

            </Form>
          </Card>

          <Card className="panel-card" title="执行步骤">
            <div className="step-list">
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 1</span>
                  <span className="step-title">点击开始codex登录</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_CLICK_CODEX_LOGIN}
                  onClick={handleClickCodexLoginStep}>
                  执行
                </Button>
              </div>
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 2</span>
                  <span className="step-title">打开授权链接</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_OPEN_AUTH_LINK}
                  onClick={handleOpenAuthLinkStep}>
                  执行
                </Button>
              </div>
            </div>
          </Card>

          <Card className="panel-card" title="执行统计">
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">执行次数</span>
                <span className="stat-value">{stats.total}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">成功</span>
                <span className="stat-value">{stats.success}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">失败</span>
                <span className="stat-value">{stats.failed}</span>
              </div>
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
              <div className="log-list">
                {logs.map((log) => {
                  return (
                    <div className="log-row" key={log.id}>
                      <span className="log-time">{log.time}</span>
                      <span className="log-message">{log.message}</span>
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
            <Tag>单账号</Tag>
            <Tag>界面优先</Tag>
          </Space>
        </section>
      </main>
    </ConfigProvider>
  )
}

export default SidePanel
