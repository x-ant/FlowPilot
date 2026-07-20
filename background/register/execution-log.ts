import {
  readLocalStorage,
  writeLocalStorage
} from "../../platform/chrome/storage"
import {
  createConsoleLogger,
  EXECUTION_LOG_LIMIT,
  getTimeLabel,
  mergeLogLists,
  normalizeLogHighlights,
  normalizeStoredLogs,
  type LogLevel,
  type LogWriteOptions
} from "../../shared/logging"
import { EXECUTION_LOG_STORAGE_KEY } from "../../shared/storage-keys"

const log = createConsoleLogger("register")

let registerExecutionLogWriteQueue: Promise<void> = Promise.resolve()

/**
 * 把后台注册任务日志写入统一执行日志。
 *
 * 多个后台步骤可能同时写日志；这里串行化读写，避免后写入的旧快照覆盖前一条日志。
 *
 * @param level 日志级别。
 * @param message 日志内容。
 * @param options 可选写入参数；指定 id 时会更新同一条日志。
 */
export const writeRegisterExecutionLog = (
  level: LogLevel,
  message: string,
  options?: LogWriteOptions
) => {
  const writeTask = async () => {
    const result = await readLocalStorage([EXECUTION_LOG_STORAGE_KEY])
    const currentLogs = normalizeStoredLogs(result[EXECUTION_LOG_STORAGE_KEY])
    const highlights = normalizeLogHighlights(options?.highlights)
    const nextLog = {
      id: options?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: getTimeLabel(),
      level,
      message: `[后台] ${message}`,
      ...(highlights.length > 0 ? { highlights } : {}),
      updatedAt: Date.now()
    }

    await writeLocalStorage({
      [EXECUTION_LOG_STORAGE_KEY]: mergeLogLists(currentLogs, [nextLog]).slice(
        -EXECUTION_LOG_LIMIT
      )
    })
  }

  registerExecutionLogWriteQueue = registerExecutionLogWriteQueue
    .catch(() => undefined)
    .then(writeTask)
  return registerExecutionLogWriteQueue
}

/**
 * 同时写 console 和统一执行日志。
 *
 * @param level 日志级别。
 * @param message 日志内容。
 * @param options 可选写入参数；指定 id 时会更新同一条日志。
 */
export const logRegisterBackground = (
  level: LogLevel,
  message: string,
  options?: LogWriteOptions
) => {
  log[level](message)
  void writeRegisterExecutionLog(level, message, options)
}
