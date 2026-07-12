import {
  createConsoleLogger,
  EXECUTION_LOG_LIMIT,
  EXECUTION_LOG_STORAGE_KEY,
  getTimeLabel,
  normalizeStoredLogs,
  type LogLevel
} from "../../shared/logging"
import {
  DEFAULT_REGISTER_ALARM_CONFIG,
  loadAccountPageState,
  normalizeRegisterAlarmConfig,
  normalizeRegisterRunLock,
  REGISTER_ALARM_NAME,
  REGISTER_ALARM_STORAGE_KEY,
  REGISTER_RUN_LOCK_STALE_MS,
  REGISTER_RUN_LOCK_STORAGE_KEY,
  REGISTER_STORAGE_KEYS,
  saveAccountPageState,
  type RegisterAlarmConfig,
  type RegisterRunLock
} from "../../shared/account-state"
import {
  runRegisterBatch,
  type RegisterStopStrategy
} from "./batch-runner"
import type { HeroSmsPhoneVerificationOptions } from "./phone-verification"
const REGISTER_HERO_SMS_STORAGE_KEY = "flowpilot:register:hero-sms-settings"

const log = createConsoleLogger("register-alarm")

let activeRegisterRun: {
  runId: string
  abortController: AbortController
  stopStrategy: RegisterStopStrategy
  manualPhoneStop: boolean
} | null = null

type HeroSmsSettings = {
  apiKey?: string
  countryId?: string
  operator?: string
  mockEnabled?: boolean
  maxPrice?: string
  fixedPrice?: string
}

const readStorage = (keys: string[]) => {
  return new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(keys, resolve)
  })
}

const writeStorage = (items: Record<string, unknown>) => {
  return new Promise<void>((resolve) => {
    chrome.storage.local.set(items, () => {
      resolve()
    })
  })
}

const removeStorage = (keys: string[]) => {
  return new Promise<void>((resolve) => {
    chrome.storage.local.remove(keys, () => {
      resolve()
    })
  })
}

let registerExecutionLogWriteQueue: Promise<void> = Promise.resolve()

/**
 * 把后台注册任务日志写入统一执行日志。
 *
 * 多个后台步骤可能同时写日志；这里串行化读写，避免后写入的旧快照覆盖前一条日志。
 *
 * @param level 日志级别。
 * @param message 日志内容。
 */
const writeRegisterExecutionLog = (level: LogLevel, message: string) => {
  const writeTask = async () => {
    const result = await readStorage([EXECUTION_LOG_STORAGE_KEY])
    const currentLogs = normalizeStoredLogs(result[EXECUTION_LOG_STORAGE_KEY])

    await writeStorage({
      [EXECUTION_LOG_STORAGE_KEY]: [
        ...currentLogs,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          time: getTimeLabel(),
          level,
          message: `[后台] ${message}`
        }
      ].slice(-EXECUTION_LOG_LIMIT)
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
 */
const logRegisterBackground = (level: LogLevel, message: string) => {
  log[level](message)
  void writeRegisterExecutionLog(level, message)
}

const createRunId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getRegisterRunLock = async () => {
  const result = await readStorage([REGISTER_RUN_LOCK_STORAGE_KEY])
  return normalizeRegisterRunLock(result[REGISTER_RUN_LOCK_STORAGE_KEY])
}

const isFreshRunLock = (lock: RegisterRunLock | null) => {
  return Boolean(
    lock && Date.now() - lock.startedAt < REGISTER_RUN_LOCK_STALE_MS
  )
}

const saveRegisterRunLock = async (lock: RegisterRunLock) => {
  await writeStorage({
    [REGISTER_RUN_LOCK_STORAGE_KEY]: lock
  })
}

const patchRegisterRunLock = async (
  runId: string,
  patch: Partial<RegisterRunLock>
) => {
  const lock = await getRegisterRunLock()
  if (!lock || lock.runId !== runId) {
    return
  }

  await saveRegisterRunLock({
    ...lock,
    ...patch,
    runId
  })
}

const releaseRegisterRunLock = async (runId: string) => {
  const lock = await getRegisterRunLock()
  if (lock?.runId === runId) {
    await removeStorage([REGISTER_RUN_LOCK_STORAGE_KEY])
  }
}

const getRegisterAlarmConfig = async () => {
  const result = await readStorage([REGISTER_ALARM_STORAGE_KEY])
  return normalizeRegisterAlarmConfig(
    result[REGISTER_ALARM_STORAGE_KEY] || DEFAULT_REGISTER_ALARM_CONFIG
  )
}

const saveRegisterAlarmConfig = async (config: RegisterAlarmConfig) => {
  const normalizedConfig = normalizeRegisterAlarmConfig(config)
  await writeStorage({
    [REGISTER_ALARM_STORAGE_KEY]: Object.fromEntries(
      Object.entries(normalizedConfig).filter(([, value]) => {
        return value !== undefined
      })
    )
  })
}

const getNextDailyAlarmTime = (dailyTime: string) => {
  const [hour, minute] = dailyTime.split(":").map((item) => Number(item))
  const next = new Date()
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1)
  }

  return next.getTime()
}

export const scheduleRegisterAlarm = async () => {
  const config = await getRegisterAlarmConfig()
  await chrome.alarms.clear(REGISTER_ALARM_NAME)

  if (!config.enabled) {
    return
  }

  if (config.mode === "daily") {
    await chrome.alarms.create(REGISTER_ALARM_NAME, {
      when: getNextDailyAlarmTime(config.dailyTime)
    })
    return
  }

  await chrome.alarms.create(REGISTER_ALARM_NAME, {
    delayInMinutes: config.intervalMinutes,
    periodInMinutes: config.intervalMinutes
  })
}

const buildHeroSmsOptions = async (
  logPrefix: string,
  onPhoneVerificationPhase?: HeroSmsPhoneVerificationOptions["onPhoneVerificationPhase"]
): Promise<HeroSmsPhoneVerificationOptions> => {
  const result = await readStorage([REGISTER_HERO_SMS_STORAGE_KEY])
  const settings =
    (result[REGISTER_HERO_SMS_STORAGE_KEY] as HeroSmsSettings | undefined) || {}
  const apiKey = String(settings.apiKey || "").trim()
  const maxPrice = String(settings.maxPrice || "").trim()
  const fixedPrice = String(settings.fixedPrice || "").trim()
  const countryId = Math.floor(Number(settings.countryId))

  if (!settings.mockEnabled && !apiKey) {
    throw new Error("缺少 HeroSMS 接码 API")
  }

  if (
    !maxPrice ||
    !Number.isFinite(Number(maxPrice)) ||
    Number(maxPrice) <= 0
  ) {
    throw new Error("缺少有效 HeroSMS 价格上限")
  }

  if (!Number.isFinite(countryId) || countryId < 0 || countryId > 999) {
    throw new Error("缺少有效 HeroSMS 国家")
  }

  if (
    fixedPrice &&
    (!Number.isFinite(Number(fixedPrice)) || Number(fixedPrice) <= 0)
  ) {
    throw new Error("HeroSMS 固定价格档位无效")
  }

  if (fixedPrice && Number(fixedPrice) > Number(maxPrice)) {
    throw new Error("HeroSMS 固定价格档位不能高于价格上限")
  }

  return {
    apiKey: settings.mockEnabled ? apiKey || "mock-api-key" : apiKey,
    countryId,
    countryLabel: `Country #${countryId}`,
    operator: String(settings.operator || "any").trim() || "any",
    mockEnabled: Boolean(settings.mockEnabled),
    maxPrice,
    fixedPrice,
    onLog: (level, message) => {
      logRegisterBackground(level, `[${logPrefix}] Step 6 ${message}`)
    },
    onPhoneVerificationPhase
  }
}

const patchAlarmConfig = async (patch: Partial<RegisterAlarmConfig>) => {
  const config = await getRegisterAlarmConfig()
  await saveRegisterAlarmConfig({
    ...config,
    ...patch
  })
}

const startRegisterBatchJob = async ({
  source,
  selectedEmails,
  targetAllWhenNoSelection,
  triggerLabel
}: {
  source: RegisterRunLock["source"]
  selectedEmails: string[]
  targetAllWhenNoSelection: boolean
  triggerLabel: string
}) => {
  if (activeRegisterRun) {
    return {
      ok: false,
      message: "注册任务正在当前后台执行"
    }
  }

  const existingLock = await getRegisterRunLock()
  if (isFreshRunLock(existingLock)) {
    return {
      ok: false,
      message: `注册任务正在执行：${existingLock?.message || existingLock?.currentEmail || "处理中"}`
    }
  }

  if (existingLock) {
    await releaseRegisterRunLock(existingLock.runId)
  }

  const state = await loadAccountPageState(REGISTER_STORAGE_KEYS, {
    requireEmailGenerator: true
  })
  const cpaUrl = state.cpaUrl.trim()
  const cpaManagementKey = state.cpaManagementKey.trim()
  if (!cpaUrl || !cpaManagementKey) {
    return {
      ok: false,
      message: "缺少 CPA 地址或 CPA 管理密钥"
    }
  }

  const runId = createRunId()
  const abortController = new AbortController()
  activeRegisterRun = {
    runId,
    abortController,
    stopStrategy: "none",
    manualPhoneStop: false
  }
  await saveRegisterRunLock({
    runId,
    source,
    startedAt: Date.now(),
    currentEmail: "",
    message: `${triggerLabel}已启动`,
    phonePhase: ""
  })
  await writeRegisterExecutionLog("info", `${triggerLabel}已启动`)

  void (async () => {
    let latestAccounts = state.accounts
    const logPrefix = source === "manual" ? "手动注册" : "自动注册"

    try {
      const heroSmsOptions = await buildHeroSmsOptions(logPrefix, (phase) => {
        const message =
          phase === "phone_submitted"
            ? "手机号已提交，正在等待验证码"
            : "手机号验证码等待已结束"
        void patchRegisterRunLock(runId, {
          phonePhase: phase,
          message
        })
        void writeRegisterExecutionLog("info", `[${logPrefix}] ${message}`)
      })

      const result = await runRegisterBatch({
        cpaUrl,
        cpaManagementKey,
        accounts: state.accounts,
        selectedEmails,
        heroSmsOptions,
        abortSignal: abortController.signal,
        targetAllWhenNoSelection,
        getStopStrategy: () => activeRegisterRun?.stopStrategy || "none",
        isManualPhoneStop: () => Boolean(activeRegisterRun?.manualPhoneStop),
        shouldCancel: () => activeRegisterRun?.stopStrategy === "immediate",
        onAccountsChange: (accounts) => {
          latestAccounts = accounts
          saveAccountPageState(REGISTER_STORAGE_KEYS, {
            cpaUrl,
            cpaManagementKey,
            accounts
          })
        },
        onLog: (level, message) => {
          logRegisterBackground(level, message)
        },
        onRunningEmail: (email) => {
          void patchRegisterRunLock(runId, {
            currentEmail: email
          })
        },
        onStatus: (message) => {
          void patchRegisterRunLock(runId, {
            message
          })
          void writeRegisterExecutionLog("info", message)
        }
      })
      await writeRegisterExecutionLog("info", result.message)

      await writeStorage({
        [REGISTER_STORAGE_KEYS.cpaUrl]: cpaUrl,
        [REGISTER_STORAGE_KEYS.cpaManagementKey]: cpaManagementKey,
        [REGISTER_STORAGE_KEYS.accounts]: latestAccounts
      })

      if (source === "alarm") {
        await patchAlarmConfig({
          lastMessage: result.message
        })
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "注册批量任务执行失败"
      logRegisterBackground("warn", message)
      await patchRegisterRunLock(runId, {
        message
      })
      if (source === "alarm") {
        await patchAlarmConfig({
          lastMessage: message
        })
      }
    } finally {
      if (activeRegisterRun?.runId === runId) {
        activeRegisterRun = null
      }
      await releaseRegisterRunLock(runId)
      const latestConfig = await getRegisterAlarmConfig()
      if (
        source === "alarm" &&
        latestConfig.enabled &&
        latestConfig.mode === "daily"
      ) {
        await scheduleRegisterAlarm()
      }
    }
  })().catch((error) => {
    logRegisterBackground(
      "warn",
      error instanceof Error ? error.message : "注册批量任务启动失败"
    )
  })

  return {
    ok: true,
    message: `${triggerLabel}已提交到后台执行`
  }
}

export const runRegisterAlarmNow = async (source = "alarm") => {
  const config = await getRegisterAlarmConfig()
  const isScheduledAlarm = source === "alarm"
  const triggerLabel = isScheduledAlarm ? "自动注册" : "单次注册"
  await writeRegisterExecutionLog("info", `${triggerLabel}已触发：${source}`)
  if (isScheduledAlarm) {
    await patchAlarmConfig({
      lastTriggeredAt: Date.now(),
      lastMessage: `${triggerLabel}已触发：${source}`
    })
  }

  try {
    const result = await startRegisterBatchJob({
      source: isScheduledAlarm ? "alarm" : "manual",
      selectedEmails: [],
      targetAllWhenNoSelection: true,
      triggerLabel
    })
    if (isScheduledAlarm) {
      await patchAlarmConfig({
        lastMessage: result.message
      })
    }
    if (!result.ok && config.enabled && config.mode === "daily") {
      await scheduleRegisterAlarm()
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : `${triggerLabel}执行失败`
    log.warn(message)
    if (isScheduledAlarm) {
      await patchAlarmConfig({
        lastMessage: message
      })
    }
    if (config.enabled && config.mode === "daily") {
      await scheduleRegisterAlarm()
    }
    return {
      ok: false,
      message
    }
  }
}

const stopRegisterBatchJob = async (strategy: RegisterStopStrategy) => {
  const lock = await getRegisterRunLock()
  if (!lock || !isFreshRunLock(lock)) {
    return {
      ok: false,
      message: "没有正在执行的注册任务"
    }
  }

  if (activeRegisterRun?.runId !== lock.runId) {
    return {
      ok: false,
      message:
        "注册任务不在当前后台上下文中，无法停止；可等待任务锁过期或重启扩展"
    }
  }

  activeRegisterRun.stopStrategy = strategy
  if (strategy === "immediate") {
    activeRegisterRun.manualPhoneStop = lock.phonePhase === "phone_submitted"
    activeRegisterRun.abortController.abort()
  }

  const message =
    strategy === "immediate"
      ? "正在立即停止注册任务"
      : strategy === "after_phone"
        ? "已设置为手机号结束后停止"
        : "已设置为成功则完成回填后停止"
  await patchRegisterRunLock(lock.runId, {
    message
  })

  return {
    ok: true,
    message
  }
}

const getRegisterRunStatus = async () => {
  const lock = await getRegisterRunLock()
  const activeInMemory = Boolean(
    lock && activeRegisterRun?.runId === lock.runId
  )

  return {
    lock,
    activeInMemory,
    stale: Boolean(lock && !isFreshRunLock(lock))
  }
}

const clearStaleRegisterRunLock = async () => {
  const status = await getRegisterRunStatus()
  if (!status.lock) {
    return {
      ok: true,
      message: "没有需要清理的注册任务锁"
    }
  }

  if (status.activeInMemory && !status.stale) {
    return {
      ok: false,
      message: "注册任务仍在后台执行，不能清理运行锁"
    }
  }

  const state = await loadAccountPageState(REGISTER_STORAGE_KEYS, {
    requireEmailGenerator: true
  })
  const now = Date.now()
  const nextAccounts = state.accounts.map((account) => {
    if (account.status !== "running") {
      return account
    }

    return {
      ...account,
      status: "failed" as const,
      lastMessage: "后台任务已中断，已清理残留任务锁",
      updatedAt: now
    }
  })

  await saveAccountPageState(REGISTER_STORAGE_KEYS, {
    ...state,
    accounts: nextAccounts
  })
  await releaseRegisterRunLock(status.lock.runId)
  await writeRegisterExecutionLog(
    "warn",
    "已清除残留注册任务锁，并把执行中的账号标记为失败"
  )
  return {
    ok: true,
    message: "已清除残留注册任务锁"
  }
}

export const setupRegisterAlarm = () => {
  void scheduleRegisterAlarm()
  chrome.runtime.onInstalled.addListener(() => {
    void scheduleRegisterAlarm()
  })
  chrome.runtime.onStartup.addListener(() => {
    void scheduleRegisterAlarm()
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REGISTER_ALARM_NAME) {
      void runRegisterAlarmNow("alarm")
    }
  })
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "flowpilot:register:alarm-save") {
      void (async () => {
        const config = normalizeRegisterAlarmConfig(message.config)
        await saveRegisterAlarmConfig(config)
        await scheduleRegisterAlarm()
        sendResponse({
          ok: true,
          config,
          message: config.enabled ? "自动触发已保存" : "自动触发已停用"
        })
      })()
      return true
    }

    if (message?.type === "flowpilot:register:alarm-run-now") {
      void (async () => {
        sendResponse(await runRegisterAlarmNow("手动测试"))
      })()
      return true
    }

    if (message?.type === "flowpilot:register:batch-start") {
      void (async () => {
        const selectedEmails = Array.isArray(message.selectedEmails)
          ? message.selectedEmails.map((email: unknown) => String(email))
          : []
        const result = await startRegisterBatchJob({
          source: "manual",
          selectedEmails,
          targetAllWhenNoSelection: false,
          triggerLabel: "手动注册"
        })
        sendResponse(result)
      })()
      return true
    }

    if (message?.type === "flowpilot:register:batch-stop") {
      void (async () => {
        const strategy: RegisterStopStrategy =
          message.strategy === "after_phone" ||
          message.strategy === "finish_current_if_phone_success"
            ? message.strategy
            : "immediate"
        sendResponse(await stopRegisterBatchJob(strategy))
      })()
      return true
    }

    if (message?.type === "flowpilot:register:run-status") {
      void (async () => {
        sendResponse({
          ok: true,
          ...(await getRegisterRunStatus())
        })
      })()
      return true
    }

    if (message?.type === "flowpilot:register:clear-run-lock") {
      void (async () => {
        sendResponse(await clearStaleRegisterRunLock())
      })()
      return true
    }

    return false
  })
}
