import {
  readLocalStorage,
  writeLocalStorage
} from "../../platform/chrome/storage"
import {
  DEFAULT_REGISTER_ALARM_CONFIG,
  normalizeRegisterAlarmConfig,
  REGISTER_ALARM_NAME,
  type RegisterAlarmConfig
} from "../../shared/account-state"
import { REGISTER_ALARM_STORAGE_KEY } from "../../shared/storage-keys"
import type { RegisterStopStrategy } from "./batch-runner"
import {
  logRegisterBackground,
  writeRegisterExecutionLog
} from "./execution-log"
import {
  clearStaleRegisterRunLock,
  getRegisterRunStatus,
  startRegisterBatchJob,
  stopRegisterBatchJob
} from "./run-controller"

const getRegisterAlarmConfig = async () => {
  const result = await readLocalStorage([REGISTER_ALARM_STORAGE_KEY])
  return normalizeRegisterAlarmConfig(
    result[REGISTER_ALARM_STORAGE_KEY] || DEFAULT_REGISTER_ALARM_CONFIG
  )
}

const saveRegisterAlarmConfig = async (config: RegisterAlarmConfig) => {
  const normalizedConfig = normalizeRegisterAlarmConfig(config)
  await writeLocalStorage({
    [REGISTER_ALARM_STORAGE_KEY]: Object.fromEntries(
      Object.entries(normalizedConfig).filter(([, value]) => {
        return value !== undefined
      })
    )
  })
}

const patchAlarmConfig = async (patch: Partial<RegisterAlarmConfig>) => {
  const config = await getRegisterAlarmConfig()
  await saveRegisterAlarmConfig({
    ...config,
    ...patch
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

/**
 * 按当前注册自动触发配置刷新 Chrome alarm。
 *
 * @return alarm 刷新完成后 resolve。
 */
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

/**
 * 立即触发一次注册批量任务。
 *
 * 这里只决定触发来源和自动触发状态；真正的任务运行控制在 run-controller.ts。
 *
 * @param source 触发来源，alarm 表示 Chrome 定时任务。
 * @return 是否成功提交到后台执行。
 */
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
      accountIntervalMinSeconds: config.accountIntervalMinSeconds,
      accountIntervalMaxSeconds: config.accountIntervalMaxSeconds,
      targetAllWhenNoSelection: true,
      triggerLabel,
      onAlarmLastMessage: (message) => {
        return patchAlarmConfig({
          lastMessage: message
        })
      },
      onDailyAlarmFinished: async () => {
        const latestConfig = await getRegisterAlarmConfig()
        if (latestConfig.enabled && latestConfig.mode === "daily") {
          await scheduleRegisterAlarm()
        }
      }
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
    const message =
      error instanceof Error ? error.message : `${triggerLabel}执行失败`
    logRegisterBackground("warn", message)
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

/**
 * 注册自动触发和侧边栏注册任务消息入口。
 *
 * alarm.ts 只负责 Chrome alarm 生命周期和消息分发；
 * 批量任务的运行态、停止策略和任务锁由 run-controller.ts 维护。
 */
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
        const config = await getRegisterAlarmConfig()
        const selectedEmails = Array.isArray(message.selectedEmails)
          ? message.selectedEmails.map((email: unknown) => String(email))
          : []
        const result = await startRegisterBatchJob({
          source: "manual",
          selectedEmails,
          allowInvalidWhenSelected: true,
          accountIntervalMinSeconds: config.accountIntervalMinSeconds,
          accountIntervalMaxSeconds: config.accountIntervalMaxSeconds,
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
