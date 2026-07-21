import { Collapse, ConfigProvider, Space, Switch, Tabs, Tag, theme } from "antd"
import zhCN from "antd/locale/zh_CN"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import "antd/dist/reset.css"
import "./sidepanel.css"

import { getLocalStorage } from "./platform/chrome/storage"
import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  type RuntimeSettings
} from "./shared/account-state"
import {
  createUiLogger,
  getTimeLabel,
  mergeLogLists,
  normalizeLogHighlights,
  normalizeStoredLogs,
  type LogItem
} from "./shared/logging"
import {
  ACTIVE_PAGE_STORAGE_KEY,
  EXECUTION_LOG_STORAGE_KEY,
  RUNTIME_SETTINGS_STORAGE_KEY
} from "./shared/storage-keys"
import { LogPanel } from "./sidepanel/components/LogPanel"
import {
  CodexLoginPage,
  CodexRegisterPage,
  FLOW_PAGE_ITEMS,
  type FlowPage
} from "./sidepanel/pages"

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
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(
    DEFAULT_RUNTIME_SETTINGS
  )
  const [busy, setBusy] = useState(false)
  const logWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * 判断两个字符串列表是否一致。
   *
   * @param left 第一组字符串。
   * @param right 第二组字符串。
   * @return 长度和顺序都一致时返回 true。
   */
  const isSameStringList = (left: string[] = [], right: string[] = []) => {
    return (
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    )
  }

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
          item.message === other.message &&
          isSameStringList(item.highlights, other.highlights) &&
          item.updatedAt === other.updatedAt
        )
      })
    )
  }

  /**
   * 把侧边栏自己产生的一条日志追加到持久化存储。
   *
   * @param item 新增日志。
   */
  const appendLogToStorage = useCallback((item: LogItem) => {
    const storage = getLocalStorage()
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
  }, [])

  const log = useMemo(() => {
    return createUiLogger((level, message, options) => {
      const highlights = normalizeLogHighlights(options?.highlights)
      const item = {
        id:
          options?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time: getTimeLabel(),
        level,
        message,
        ...(highlights.length > 0 ? { highlights } : {}),
        updatedAt: Date.now()
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
    const prefix =
      activePage === "flowpilot-register" ? "[注册流程]" : "[登录流程]"

    return createUiLogger((level, message, options) => {
      log[level](`${prefix} ${message}`, options)
    })
  }, [activePage, log])
  useEffect(() => {
    const storage = getLocalStorage()
    storage?.get(
      [
        ACTIVE_PAGE_STORAGE_KEY,
        EXECUTION_LOG_STORAGE_KEY,
        RUNTIME_SETTINGS_STORAGE_KEY
      ],
      (result) => {
        setActivePage(
          result?.[ACTIVE_PAGE_STORAGE_KEY] === "flowpilot-register"
            ? "flowpilot-register"
            : "flowpilot-login"
        )
        setLogs(normalizeStoredLogs(result?.[EXECUTION_LOG_STORAGE_KEY]))
        setRuntimeSettings(
          normalizeRuntimeSettings(result?.[RUNTIME_SETTINGS_STORAGE_KEY])
        )
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
      if (areaName !== "local") {
        return
      }

      if (changes[EXECUTION_LOG_STORAGE_KEY]) {
        const nextLogs = normalizeStoredLogs(
          changes[EXECUTION_LOG_STORAGE_KEY].newValue
        )
        setLogs((current) => {
          const mergedLogs =
            nextLogs.length === 0 ? [] : mergeLogLists(current, nextLogs)
          return isSameLogList(current, mergedLogs) ? current : mergedLogs
        })
      }

      if (changes[RUNTIME_SETTINGS_STORAGE_KEY]) {
        setRuntimeSettings(
          normalizeRuntimeSettings(
            changes[RUNTIME_SETTINGS_STORAGE_KEY].newValue
          )
        )
      }
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
    getLocalStorage()?.set({
      [ACTIVE_PAGE_STORAGE_KEY]: nextPage
    })
    setStatus(
      nextPage === "flowpilot-register" ? "已打开注册页" : "已打开登录页"
    )
  }

  /**
   * 清空当前侧边栏会话里的执行日志。
   */
  const handleClearLogs = () => {
    setLogs([])
    getLocalStorage()?.set({
      [EXECUTION_LOG_STORAGE_KEY]: []
    })
    setStatus("日志已清空")
  }

  /**
   * 更新全局运行设置并立即保存。
   *
   * @param patch 要合并到当前运行设置的字段。
   */
  const handleRuntimeSettingsChange = (patch: Partial<RuntimeSettings>) => {
    const nextSettings = normalizeRuntimeSettings({
      ...runtimeSettings,
      ...patch
    })
    setRuntimeSettings(nextSettings)
    getLocalStorage()?.set({
      [RUNTIME_SETTINGS_STORAGE_KEY]: nextSettings
    })
    setStatus("运行设置已保存")
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
            <p className="brand-subtitle">
              {activePageLabel} · 本地账号流程助手
            </p>
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

          <Collapse
            className="panel-card"
            items={[
              {
                key: "runtime-settings",
                label: "运行设置",
                children: (
                  <Space size={12} wrap>
                    <Switch
                      checked={runtimeSettings.keepAwakeDuringRun}
                      onChange={(checked) => {
                        handleRuntimeSettingsChange({
                          keepAwakeDuringRun: checked
                        })
                      }}
                    />
                    <span className="debug-label">运行时保持唤醒</span>
                  </Space>
                )
              }
            ]}
          />

          <LogPanel logs={logs} onClear={handleClearLogs} />

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
