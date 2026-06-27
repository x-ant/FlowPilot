import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Space,
  Tabs,
  Tag,
  theme,
  Typography
} from "antd"
import zhCN from "antd/locale/zh_CN"
import { useEffect, useMemo, useRef, useState } from "react"

import "antd/dist/reset.css"
import "./sidepanel.css"

import {
  createUiLogger,
  getTimeLabel,
  LOG_LEVEL_META,
  type LogItem
} from "./shared/logging"
import { CodexLoginPage } from "./sidepanel/CodexLoginPage"
import { CodexRegisterPage } from "./sidepanel/CodexRegisterPage"
import {
  ACTIVE_PAGE_STORAGE_KEY,
  FLOW_PAGE_ITEMS,
  getStorage,
  type FlowPage
} from "./sidepanel/shared"

function SidePanel() {
  const [activePage, setActivePage] = useState<FlowPage>("codex-login")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    const element = logListRef.current
    if (!element) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [logs])

  useEffect(() => {
    const storage = getStorage()
    storage?.get([ACTIVE_PAGE_STORAGE_KEY], (result) => {
      setActivePage(
        result?.[ACTIVE_PAGE_STORAGE_KEY] === "codex-register"
          ? "codex-register"
          : "codex-login"
      )
    })
  }, [])

  const handleActivePageChange = (value: string) => {
    const nextPage: FlowPage =
      value === "codex-register" ? "codex-register" : "codex-login"
    setActivePage(nextPage)
    getStorage()?.set({
      [ACTIVE_PAGE_STORAGE_KEY]: nextPage
    })
    setStatus(nextPage === "codex-register" ? "已打开注册页" : "已打开登录页")
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
            <h1 className="brand-title">{activePage}</h1>
            <p className="brand-subtitle">多账号登录助手</p>
          </div>
          <Tag color="processing">{status}</Tag>
        </header>

        <section className="panel-stack">
          <Tabs
            activeKey={activePage}
            items={FLOW_PAGE_ITEMS.map((item) => {
              return {
                ...item,
                disabled: busy
              }
            })}
            onChange={handleActivePageChange}
          />

          {activePage === "codex-register" ? (
            <CodexRegisterPage
              log={log}
              setStatus={setStatus}
              onBusyChange={setBusy}
            />
          ) : (
            <CodexLoginPage
              log={log}
              setStatus={setStatus}
              onBusyChange={setBusy}
            />
          )}

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
