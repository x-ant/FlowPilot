import { Button, Card, ConfigProvider, Empty, Space, Tabs, Tag, theme, Typography } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useMemo, useRef, useState } from "react";






import "antd/dist/reset.css";
import "./sidepanel.css";



import { createUiLogger, getTimeLabel, LOG_LEVEL_META, type LogItem } from "./shared/logging";
import { CodexLoginPage } from "./sidepanel/CodexLoginPage";
import { CodexRegisterPage } from "./sidepanel/CodexRegisterPage";
import { ACTIVE_PAGE_STORAGE_KEY, FLOW_PAGE_ITEMS, getStorage, type FlowPage } from "./sidepanel/shared";


const EXECUTION_LOG_STORAGE_KEY = "codex-login:execution-logs"
const EXECUTION_LOG_LIMIT = 6000

const normalizeStoredLogs = (value: unknown): LogItem[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      const record = item as Partial<LogItem>
      if (
        typeof record.id !== "string" ||
        typeof record.time !== "string" ||
        typeof record.message !== "string" ||
        !["error", "warn", "info", "debug"].includes(String(record.level))
      ) {
        return null
      }

      return {
        id: record.id,
        time: record.time,
        level: record.level as LogItem["level"],
        message: record.message
      }
    })
    .filter((item): item is LogItem => Boolean(item))
    .slice(-EXECUTION_LOG_LIMIT)
}

function SidePanel() {
  const [activePage, setActivePage] = useState<FlowPage>("codex-login")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isLogAtBottom, setIsLogAtBottom] = useState(true)
  const logListRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowLogsRef = useRef(true)

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
        ].slice(-EXECUTION_LOG_LIMIT)
      })
    })
  }, [])
  const scopedLog = useMemo(() => {
    const prefix =
      activePage === "codex-register" ? "[codex-register]" : "[codex-login]"

    return createUiLogger((level, message) => {
      log[level](`${prefix} ${message}`)
    })
  }, [activePage, log])

  useEffect(() => {
    const element = logListRef.current
    if (!element || !shouldFollowLogsRef.current) {
      return
    }

    element.scrollTop = element.scrollHeight
    setIsLogAtBottom(true)
  }, [logs])

  useEffect(() => {
    const storage = getStorage()
    storage?.get([ACTIVE_PAGE_STORAGE_KEY, EXECUTION_LOG_STORAGE_KEY], (result) => {
      setActivePage(
        result?.[ACTIVE_PAGE_STORAGE_KEY] === "codex-register"
          ? "codex-register"
          : "codex-login"
      )
      setLogs(normalizeStoredLogs(result?.[EXECUTION_LOG_STORAGE_KEY]))
      setLogsLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!logsLoaded) {
      return
    }

    getStorage()?.set({
      [EXECUTION_LOG_STORAGE_KEY]: logs.slice(-EXECUTION_LOG_LIMIT)
    })
  }, [logs, logsLoaded])

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
    shouldFollowLogsRef.current = true
    setIsLogAtBottom(true)
    getStorage()?.set({
      [EXECUTION_LOG_STORAGE_KEY]: []
    })
    setStatus("日志已清空")
  }

  const handleLogScroll = () => {
    const element = logListRef.current
    if (!element) {
      return
    }

    const isAtBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 24
    shouldFollowLogsRef.current = isAtBottom
    setIsLogAtBottom(isAtBottom)
  }

  const handleScrollLogsToBottom = () => {
    const element = logListRef.current
    if (!element) {
      return
    }
    // 当前滚动条距离顶部的位置 设置为 整个内容总高度，包括看不见的部分，实现滚动到底部
    element.scrollTop = element.scrollHeight
    shouldFollowLogsRef.current = true
    setIsLogAtBottom(true)
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
              log={scopedLog}
              setStatus={setStatus}
              onBusyChange={setBusy}
            />
          ) : (
            <CodexLoginPage
              log={scopedLog}
              setStatus={setStatus}
              onBusyChange={setBusy}
            />
          )}

          <Card
            className="panel-card"
            title="执行日志"
            extra={
              <Space size={8}>
                <Button
                  size="small"
                  disabled={logs.length === 0 || isLogAtBottom}
                  onClick={handleScrollLogsToBottom}>
                  滚动到底
                </Button>
                <Button size="small" onClick={handleClearLogs}>
                  清空
                </Button>
              </Space>
            }>
            {logs.length > 0 ? (
              <div
                className="log-list"
                ref={logListRef}
                onScroll={handleLogScroll}>
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
