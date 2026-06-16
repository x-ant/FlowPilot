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

const STORAGE_KEY = "codex-login:settings"
const STEP_CLICK_CODEX_LOGIN = "click-codex-login"

const initialStats: Stats = {
  total: 0,
  success: 0,
  failed: 0
}

const getStorage = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  return chrome.storage.local
}

const getTime = () => {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date())
}

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

const sendStartCodexLogin = (loginUrl: string) => {
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
        type: "codex-login:start",
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

function SidePanel() {
  const [form] = Form.useForm<Settings>()
  const [status, setStatus] = useState("准备就绪")
  const [stats, setStats] = useState(initialStats)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [runningStep, setRunningStep] = useState<string | null>(null)

  const storage = useMemo(getStorage, [])

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
    storage?.get(STORAGE_KEY, (result) => {
      const saved = result?.[STORAGE_KEY] as Settings | undefined
      if (saved) {
        form.setFieldsValue(saved)
        setStatus("已加载本地配置")
      }
    })
  }, [form, storage])

  const handleValuesChange = (_: Partial<Settings>, values: Settings) => {
    storage?.set({ [STORAGE_KEY]: values })
  }

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
