export type LogLevel = "error" | "warn" | "info" | "debug"

export type LogItem = {
  id: string
  time: string
  level: LogLevel
  message: string
}

export type LogLevelMeta = {
  label: string
  color: string
}

export type UiLogger = {
  error: (message: string) => void
  warn: (message: string) => void
  info: (message: string) => void
  debug: (message: string) => void
}

export type ConsoleLogger = {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export const EXECUTION_LOG_STORAGE_KEY = "codex-login:execution-logs"
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
  write: (level: LogLevel, message: string) => void
): UiLogger => {
  return {
    error: (message: string) => {
      write("error", message)
    },
    warn: (message: string) => {
      write("warn", message)
    },
    info: (message: string) => {
      write("info", message)
    },
    debug: (message: string) => {
      write("debug", message)
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
