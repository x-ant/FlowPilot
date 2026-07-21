import { Button, Card, Empty, Segmented, Space, Tag, Typography } from "antd"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"

import {
  LOG_LEVEL_META,
  splitLogMessageSegments,
  type LogItem
} from "../../shared/logging"

type LogLevelFilter = "all" | "warn-error" | "error"

const LOG_LEVEL_FILTER_OPTIONS: Array<{
  label: string
  value: LogLevelFilter
}> = [
  {
    label: "全部",
    value: "all"
  },
  {
    label: "WARN+ERROR",
    value: "warn-error"
  },
  {
    label: "ERROR",
    value: "error"
  }
]

type LogPanelProps = {
  logs: LogItem[]
  onClear: () => void
}

/**
 * 展示执行日志并管理筛选、自动跟随和手动滚动交互。
 *
 * 日志数据和持久化由侧边栏入口控制；该组件只管理不需要持久化的展示状态。
 *
 * @param props 当前日志列表和清空回调。
 * @return 执行日志面板。
 */
export function LogPanel({ logs, onClear }: LogPanelProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("all")
  const [isAtBottom, setIsAtBottom] = useState(true)
  const logListRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const shouldFollowRef = useRef(true)
  const isAutoScrollingRef = useRef(false)
  const scrollIntentRef = useRef(false)
  const scrollIntentTimerRef = useRef<number | null>(null)
  const visibleLogs = useMemo(() => {
    if (levelFilter === "error") {
      return logs.filter((item) => item.level === "error")
    }

    if (levelFilter === "warn-error") {
      return logs.filter(
        (item) => item.level === "warn" || item.level === "error"
      )
    }

    return logs
  }, [levelFilter, logs])

  /**
   * 只在底部状态真正变化时更新 React 状态，避免滚动事件重复渲染。
   *
   * @param nextValue 日志区域是否位于底部。
   */
  const setAtBottomSafely = useCallback((nextValue: boolean) => {
    if (isAtBottomRef.current === nextValue) {
      return
    }

    isAtBottomRef.current = nextValue
    setIsAtBottom(nextValue)
  }, [])

  useLayoutEffect(() => {
    const element = logListRef.current
    if (!element || !shouldFollowRef.current) {
      return
    }

    isAutoScrollingRef.current = true
    element.scrollTop = element.scrollHeight
    setAtBottomSafely(true)
    window.setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 0)
  }, [visibleLogs, setAtBottomSafely])

  useEffect(() => {
    return () => {
      if (scrollIntentTimerRef.current) {
        window.clearTimeout(scrollIntentTimerRef.current)
      }
    }
  }, [])

  /**
   * 标记这次滚动来自用户操作，用于在查看旧日志时暂停自动跟随。
   */
  const markScrollIntent = () => {
    scrollIntentRef.current = true
    if (scrollIntentTimerRef.current) {
      window.clearTimeout(scrollIntentTimerRef.current)
    }
    scrollIntentTimerRef.current = window.setTimeout(() => {
      scrollIntentRef.current = false
    }, 400)
  }

  const handleScroll = () => {
    const element = logListRef.current
    if (!element) {
      return
    }

    const nextIsAtBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 24

    if (nextIsAtBottom) {
      shouldFollowRef.current = true
      scrollIntentRef.current = false
      setAtBottomSafely(true)
      return
    }

    if (isAutoScrollingRef.current || !scrollIntentRef.current) {
      return
    }

    shouldFollowRef.current = false
    setAtBottomSafely(false)
  }

  /**
   * 手动滚动到底部，并恢复自动跟随新日志。
   */
  const handleScrollToBottom = () => {
    const element = logListRef.current
    if (!element) {
      return
    }

    isAutoScrollingRef.current = true
    element.scrollTop = element.scrollHeight
    shouldFollowRef.current = true
    scrollIntentRef.current = false
    setAtBottomSafely(true)
    window.setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 0)
  }

  /**
   * 重置面板滚动状态后，把日志清空交给数据拥有者处理。
   */
  const handleClear = () => {
    shouldFollowRef.current = true
    scrollIntentRef.current = false
    setAtBottomSafely(true)
    onClear()
  }

  return (
    <Card
      className="panel-card"
      title="执行日志"
      extra={
        <Space size={8}>
          <Button
            size="small"
            disabled={visibleLogs.length === 0 || isAtBottom}
            onClick={handleScrollToBottom}>
            滚动到底
          </Button>
          <Button size="small" onClick={handleClear}>
            清空
          </Button>
        </Space>
      }>
      <div className="log-toolbar">
        <span className="debug-label">日志级别</span>
        <Segmented<LogLevelFilter>
          size="small"
          options={LOG_LEVEL_FILTER_OPTIONS}
          value={levelFilter}
          onChange={setLevelFilter}
        />
      </div>
      {visibleLogs.length > 0 ? (
        <div
          className="log-list"
          ref={logListRef}
          onMouseDown={markScrollIntent}
          onTouchStart={markScrollIntent}
          onWheel={markScrollIntent}
          onScroll={handleScroll}>
          {visibleLogs.map((logItem) => {
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
                  <span className="log-message">
                    {splitLogMessageSegments(
                      logItem.message,
                      logItem.highlights
                    ).map((segment, index) => {
                      if (!segment.highlight) {
                        return segment.text
                      }

                      return (
                        <span
                          className="log-message-highlight"
                          key={`${index}-${segment.text}`}>
                          {segment.text}
                        </span>
                      )
                    })}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Typography.Text type="secondary">
              {logs.length > 0 ? "当前级别没有日志" : "暂无日志"}
            </Typography.Text>
          }
        />
      )}
    </Card>
  )
}
