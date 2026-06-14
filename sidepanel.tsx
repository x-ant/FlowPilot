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

const STORAGE_KEY = "codex-login:settings"

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

const getTime = () =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date())

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

function SidePanel() {
  const [form] = Form.useForm<Settings>()
  const [status, setStatus] = useState("准备就绪")
  const [stats, setStats] = useState(initialStats)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(false)

  const storage = useMemo(getStorage, [])

  const addLog = (message: string) => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        time: getTime(),
        message
      },
      ...current
    ])
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

  const handleRun = async () => {
    try {
      setLoading(true)
      const values = await form.validateFields()
      const account = maskEmail(values.email)

      setStatus("已接收执行请求")
      setStats((current) => ({
        ...current,
        total: current.total + 1
      }))
      addLog(`${account} 表单校验通过，自动登录流程待接入`)
    } catch {
      setStatus("表单需要补充")
      setStats((current) => ({
        ...current,
        total: current.total + 1,
        failed: current.failed + 1
      }))
      addLog("登录地址、2925 邮箱和密码不能为空")
    } finally {
      setLoading(false)
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

              <Button
                className="primary-action"
                type="primary"
                size="large"
                loading={loading}
                onClick={handleRun}>
                执行
              </Button>
            </Form>
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
                {logs.map((log) => (
                  <div className="log-row" key={log.id}>
                    <span className="log-time">{log.time}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))}
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
