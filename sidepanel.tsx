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

const EXECUTION_LOG_LIMIT = 6000

/**
 * Chrome 扩展侧边栏入口。
 *
 * 只持久化当前功能页；执行日志保留在内存里，关闭侧边栏后重新开始，
 * 避免把账号执行细节长期写入浏览器存储。
 *
 * @return 侧边栏 React 页面。
 */
function SidePanel() {
  const [activePage, setActivePage] = useState<FlowPage>("codex-login")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
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
    storage?.get([ACTIVE_PAGE_STORAGE_KEY], (result) => {
      setActivePage(
        result?.[ACTIVE_PAGE_STORAGE_KEY] === "codex-register"
          ? "codex-register"
          : "codex-login"
      )
    })
  }, [])

  /**
   * 切换登录/注册功能页，并记住最后一次打开的页面。
   *
   * @param value Ant Design Tabs 传入的页面 key。
   */
  const handleActivePageChange = (value: string) => {
    const nextPage: FlowPage =
      value === "codex-register" ? "codex-register" : "codex-login"
    setActivePage(nextPage)
    getStorage()?.set({
      [ACTIVE_PAGE_STORAGE_KEY]: nextPage
    })
    setStatus(nextPage === "codex-register" ? "已打开注册页" : "已打开登录页")
  }

  /**
   * 清空当前侧边栏会话里的执行日志。
   */
  const handleClearLogs = () => {
    setLogs([])
    shouldFollowLogsRef.current = true
    setIsLogAtBottom(true)
    setStatus("日志已清空")
  }

  /**
   * 记录日志区域是否停在底部。
   *
   * 用户向上查看旧日志时暂停自动滚动，避免新日志把视图拉走。
   */
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

  /**
   * 手动把日志区域滚动到底部，并恢复自动跟随新日志。
   */
  const handleScrollLogsToBottom = () => {
    const element = logListRef.current
    if (!element) {
      return
    }
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
            <Tag>调试步骤</Tag>
          </Space>
        </section>
      </main>
    </ConfigProvider>
  )
}

export default SidePanel
