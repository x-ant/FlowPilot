export type LogLevel = "error" | "warn" | "info" | "debug"

export type LogItem = {
  id: string
  time: string
  level: LogLevel
  message: string
  /** 由日志写入方声明的重点文本；展示层只负责渲染，不猜测业务文案。 */
  highlights?: string[]
  /** 最近一次写入时间戳；同 id 日志更新时用于把状态日志排到当前位置。 */
  updatedAt?: number
}

export type LogWriteOptions = {
  /** 指定日志 id 时，后续同 id 日志会覆盖同一行，用于展示长时间运行状态。 */
  id?: string
  /** 需要在执行日志里高亮的原文片段，必须来自当前 message。 */
  highlights?: string[]
}

export type LogMessageSegment = {
  text: string
  highlight?: boolean
}

export type LogLevelMeta = {
  label: string
  color: string
}

export type UiLogger = {
  error: (message: string, options?: LogWriteOptions) => void
  warn: (message: string, options?: LogWriteOptions) => void
  info: (message: string, options?: LogWriteOptions) => void
  debug: (message: string, options?: LogWriteOptions) => void
}

export type ConsoleLogger = {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export const EXECUTION_LOG_LIMIT = 6000

export const LOG_LEVEL_META: Record<LogLevel, LogLevelMeta> = {
  error: {
    label: "ERROR",
    color: "error"
  },
  warn: {
    label: "WARN",
    color: "warning"
  },
  info: {
    label: "INFO",
    color: "processing"
  },
  debug: {
    label: "DEBUG",
    color: "default"
  }
}

const normalizeLogLevel = (value: unknown): LogLevel => {
  return ["error", "warn", "info", "debug"].includes(String(value))
    ? (value as LogLevel)
    : "info"
}

/**
 * 规范化日志高亮片段。
 *
 * @param value 外部传入的高亮片段列表。
 * @return 去掉非字符串和空白项后的高亮片段。
 */
export const normalizeLogHighlights = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 按调用方声明的重点文本，把日志切分成普通片段和高亮片段。
 *
 * 这里只做通用文本结构化，不依赖 React 或 DOM，也不内置任何业务文案规则。
 *
 * @param message 原始日志文本。
 * @param highlights 需要高亮的原文片段。
 * @return 可供 UI 渲染的日志片段列表。
 */
export const splitLogMessageSegments = (
  message: string,
  highlights: string[] = []
): LogMessageSegment[] => {
  const normalizedHighlights = normalizeLogHighlights(highlights)
  if (normalizedHighlights.length === 0) {
    return [
      {
        text: message
      }
    ]
  }

  const segments: LogMessageSegment[] = []
  let startIndex = 0

  while (startIndex < message.length) {
    const nextMatch = normalizedHighlights.reduce<{
      index: number
      text: string
    } | null>((current, highlight) => {
      const index = message.indexOf(highlight, startIndex)
      if (index < 0) {
        return current
      }

      if (
        !current ||
        index < current.index ||
        (index === current.index && highlight.length > current.text.length)
      ) {
        return {
          index,
          text: highlight
        }
      }

      return current
    }, null)

    if (!nextMatch) {
      segments.push({
        text: message.slice(startIndex)
      })
      break
    }

    if (nextMatch.index > startIndex) {
      segments.push({
        text: message.slice(startIndex, nextMatch.index)
      })
    }

    segments.push({
      text: nextMatch.text,
      highlight: true
    })
    startIndex = nextMatch.index + nextMatch.text.length
  }

  return segments
}

/**
 * 规范化本地存储里的执行日志。
 *
 * @param value 从 chrome.storage.local 读取到的原始日志列表。
 * @return 可展示和继续持久化的日志列表。
 */
export const normalizeStoredLogs = (value: unknown): LogItem[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item): LogItem | null => {
      const record = item as Partial<LogItem>
      if (
        typeof record.id !== "string" ||
        typeof record.time !== "string" ||
        typeof record.message !== "string"
      ) {
        return null
      }

      const normalized: LogItem = {
        id: record.id,
        time: record.time,
        level: normalizeLogLevel(record.level),
        message: record.message
      }
      const highlights = normalizeLogHighlights(record.highlights)
      if (highlights.length > 0) {
        normalized.highlights = highlights
      }
      if (Number.isFinite(Number(record.updatedAt))) {
        normalized.updatedAt = Number(record.updatedAt)
      }

      return normalized
    })
    .filter((item): item is LogItem => Boolean(item))
    .slice(-EXECUTION_LOG_LIMIT)
}

/**
 * 合并多份日志，按日志 id 里的时间戳保持大致顺序，并去掉重复项。
 *
 * @param sources 需要合并的日志列表。
 * @return 合并后的日志列表，最多保留 `EXECUTION_LOG_LIMIT` 条。
 */
export const mergeLogLists = (...sources: LogItem[][]): LogItem[] => {
  const records = new Map<
    string,
    {
      item: LogItem
      order: number
      timestamp: number
    }
  >()

  sources.flat().forEach((item) => {
    const existing = records.get(item.id)
    const idTimestamp = Number(item.id.split("-")[0])
    const timestamp = Number.isFinite(Number(item.updatedAt))
      ? Number(item.updatedAt)
      : Number.isFinite(idTimestamp)
        ? idTimestamp
        : records.size
    if (existing) {
      existing.item = item
      existing.timestamp = timestamp
      return
    }

    records.set(item.id, {
      item,
      order: records.size,
      timestamp
    })
  })

  return Array.from(records.values())
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }

      const idOrder = left.item.id.localeCompare(right.item.id)
      return idOrder || left.order - right.order
    })
    .map((record) => {
      return record.item
    })
    .slice(-EXECUTION_LOG_LIMIT)
}

/**
 * 生成当前时间字符串，用于日志显示。
 *
 * @return 按 `HH:mm:ss` 格式生成的当前时间字符串。
 */
export const getTimeLabel = () => {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date())
}

/**
 * 创建 UI 日志对象，调用方式接近 slf4j / console。
 *
 * @param write 真实的日志写入函数。
 * @return 带 error / warn / info / debug 方法的日志对象。
 */
export const createUiLogger = (
  write: (level: LogLevel, message: string, options?: LogWriteOptions) => void
): UiLogger => {
  return {
    error: (message: string, options?: LogWriteOptions) => {
      write("error", message, options)
    },
    warn: (message: string, options?: LogWriteOptions) => {
      write("warn", message, options)
    },
    info: (message: string, options?: LogWriteOptions) => {
      write("info", message, options)
    },
    debug: (message: string, options?: LogWriteOptions) => {
      write("debug", message, options)
    }
  }
}

/**
 * 创建一个简单的 console 日志对象。
 *
 * @param scope 日志前缀，例如模块名。
 * @return 带 error / warn / info / debug 方法的 console 风格对象。
 */
export const createConsoleLogger = (scope?: string): ConsoleLogger => {
  const prefix = scope ? `[${scope}]` : ""

  return {
    error: (...args: unknown[]) => {
      console.error(...(prefix ? [prefix, ...args] : args))
    },
    warn: (...args: unknown[]) => {
      console.warn(...(prefix ? [prefix, ...args] : args))
    },
    info: (...args: unknown[]) => {
      console.info(...(prefix ? [prefix, ...args] : args))
    },
    debug: (...args: unknown[]) => {
      console.debug(...(prefix ? [prefix, ...args] : args))
    }
  }
}
