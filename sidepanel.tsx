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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"

import "antd/dist/reset.css"
import "./sidepanel.css"

import {
  createUiLogger,
  EXECUTION_LOG_LIMIT,
  EXECUTION_LOG_STORAGE_KEY,
  getTimeLabel,
  LOG_LEVEL_META,
  mergeLogLists,
  normalizeStoredLogs,
  type LogItem
} from "./shared/logging"
import {
  ACTIVE_PAGE_STORAGE_KEY,
  CodexLoginPage,
  CodexRegisterPage,
  FLOW_PAGE_ITEMS,
  type FlowPage
} from "./sidepanel/pages"
import { getStorage } from "./shared/account-state"

/**
 * Chrome 扩展侧边栏入口。
 *
 * 当前功能页和执行日志都会持久化到 chrome.storage.local。
 * 日志最多保留 6000 条，方便后期排查后台任务和页面自动化问题。
 *
 * @return 侧边栏 React 页面。
 */
function SidePanel() {
  const [activePage, setActivePage] = useState<FlowPage>("flowpilot-login")
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isLogAtBottom, setIsLogAtBottom] = useState(true)
  const logListRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowLogsRef = useRef(true)
  const isAutoScrollingLogsRef = useRef(false)
  const logScrollIntentRef = useRef(false)
  const logScrollIntentTimerRef = useRef<number | null>(null)
  const logWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * 判断两份日志是否完全一致，避免 storage 同步时重复写入。
   *
   * @param left 第一份日志。
   * @param right 第二份日志。
   * @return id、时间、级别、消息都一致时返回 true。
   */
  const isSameLogList = (left: LogItem[], right: LogItem[]) => {
    return (
      left.length === right.length &&
      left.every((item, index) => {
        const other = right[index]
        return (
          item.id === other.id &&
          item.time === other.time &&
          item.level === other.level &&
          item.message === other.message
        )
      })
    )
  }

  /**
   * 把侧边栏自己产生的一条日志追加到持久化存储。
   *
   * @param item 新增日志。
   */
  const appendLogToStorage = useCallback(
    (item: LogItem) => {
      const storage = getStorage()
      if (!storage) {
        return
      }

      logWriteQueueRef.current = logWriteQueueRef.current
        .catch(() => undefined)
        .then(() => {
          return new Promise<void>((resolve) => {
            storage.get([EXECUTION_LOG_STORAGE_KEY], (result) => {
              const storedLogs = normalizeStoredLogs(
                result?.[EXECUTION_LOG_STORAGE_KEY]
              )
              const mergedLogs = mergeLogLists(storedLogs, [item])
              if (isSameLogList(storedLogs, mergedLogs)) {
                resolve()
                return
              }

              storage.set(
                {
                  [EXECUTION_LOG_STORAGE_KEY]: mergedLogs
                },
                resolve
              )
            })
          })
        })
    },
    []
  )

  const log = useMemo(() => {
    return createUiLogger((level, message) => {
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time: getTimeLabel(),
        level,
        message
      }
      appendLogToStorage(item)
      setLogs((current) => {
        return mergeLogLists(current, [item])
      })
    })
  }, [appendLogToStorage])
  const activePageLabel = useMemo(() => {
    return activePage === "flowpilot-register" ? "注册流程" : "登录流程"
  }, [activePage])
  const scopedLog = useMemo(() => {
    const prefix = activePage === "flowpilot-register" ? "[注册流程]" : "[登录流程]"

    return createUiLogger((level, message) => {
      log[level](`${prefix} ${message}`)
    })
  }, [activePage, log])

  useLayoutEffect(() => {
    const element = logListRef.current
    if (!element || !shouldFollowLogsRef.current) {
      return
    }

    isAutoScrollingLogsRef.current = true
    element.scrollTop = element.scrollHeight
    setIsLogAtBottom(true)
    window.setTimeout(() => {
      isAutoScrollingLogsRef.current = false
    }, 0)
  }, [logs])

  useEffect(() => {
    return () => {
      if (logScrollIntentTimerRef.current) {
        window.clearTimeout(logScrollIntentTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const storage = getStorage()
    storage?.get(
      [ACTIVE_PAGE_STORAGE_KEY, EXECUTION_LOG_STORAGE_KEY],
      (result) => {
        setActivePage(
          result?.[ACTIVE_PAGE_STORAGE_KEY] === "flowpilot-register"
            ? "flowpilot-register"
            : "flowpilot-login"
        )
        setLogs(normalizeStoredLogs(result?.[EXECUTION_LOG_STORAGE_KEY]))
        setLogsLoaded(true)
      }
    )
  }, [])

  useEffect(() => {
    if (!logsLoaded) {
      return
    }

    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[EXECUTION_LOG_STORAGE_KEY]) {
        return
      }

      const nextLogs = normalizeStoredLogs(
        changes[EXECUTION_LOG_STORAGE_KEY].newValue
      )
      setLogs((current) => {
        const mergedLogs =
          nextLogs.length === 0 ? [] : mergeLogLists(current, nextLogs)
        return isSameLogList(current, mergedLogs) ? current : mergedLogs
      })
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChanged)
    }
  }, [logsLoaded])

  /**
   * 切换登录/注册功能页，并记住最后一次打开的页面。
   *
   * @param value Ant Design Tabs 传入的页面 key。
   */
  const handleActivePageChange = (value: string) => {
    const nextPage: FlowPage =
      value === "flowpilot-register" ? "flowpilot-register" : "flowpilot-login"
    setActivePage(nextPage)
    getStorage()?.set({
      [ACTIVE_PAGE_STORAGE_KEY]: nextPage
    })
    setStatus(nextPage === "flowpilot-register" ? "已打开注册页" : "已打开登录页")
  }

  /**
   * 清空当前侧边栏会话里的执行日志。
   */
  const handleClearLogs = () => {
    setLogs([])
    shouldFollowLogsRef.current = true
    logScrollIntentRef.current = false
    setIsLogAtBottom(true)
    getStorage()?.set({
      [EXECUTION_LOG_STORAGE_KEY]: []
    })
    setStatus("日志已清空")
  }

  /**
   * 记录日志区域是否停在底部。
   *
   * 用户向上查看旧日志时暂停自动滚动，避免新日志把视图拉走。
   */
  const markLogScrollIntent = () => {
    logScrollIntentRef.current = true
    if (logScrollIntentTimerRef.current) {
      window.clearTimeout(logScrollIntentTimerRef.current)
    }
    logScrollIntentTimerRef.current = window.setTimeout(() => {
      logScrollIntentRef.current = false
    }, 400)
  }

  const handleLogScroll = () => {
    const element = logListRef.current
    if (!element) {
      return
    }

    const isAtBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 24

    if (isAtBottom) {
      shouldFollowLogsRef.current = true
      logScrollIntentRef.current = false
      setIsLogAtBottom(true)
      return
    }

    if (isAutoScrollingLogsRef.current || !logScrollIntentRef.current) {
      return
    }

    shouldFollowLogsRef.current = false
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
    isAutoScrollingLogsRef.current = true
    element.scrollTop = element.scrollHeight
    shouldFollowLogsRef.current = true
    logScrollIntentRef.current = false
    setIsLogAtBottom(true)
    window.setTimeout(() => {
      isAutoScrollingLogsRef.current = false
    }, 0)
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
            <h1 className="brand-title">FlowPilot</h1>
            <p className="brand-subtitle">{activePageLabel} · 本地账号流程助手</p>
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

          {activePage === "flowpilot-register" ? (
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
                onMouseDown={markLogScrollIntent}
                onTouchStart={markLogScrollIntent}
                onWheel={markLogScrollIntent}
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
