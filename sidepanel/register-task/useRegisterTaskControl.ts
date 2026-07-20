import { useCallback, useEffect, useState } from "react"

import { sendRuntimeMessage } from "../../platform/chrome/runtime-messaging"
import { getLocalStorage } from "../../platform/chrome/storage"
import {
  DEFAULT_REGISTER_ALARM_CONFIG,
  normalizeRegisterAlarmConfig,
  normalizeRegisterRunLock,
  REGISTER_RUN_LOCK_STALE_MS,
  type RegisterAlarmConfig,
  type RegisterRunLock
} from "../../shared/account-state"
import type { UiLogger } from "../../shared/logging"
import {
  RUNTIME_MESSAGE_TYPES,
  type RegisterStopStrategy
} from "../../shared/runtime-messages"
import {
  REGISTER_ALARM_STORAGE_KEY,
  REGISTER_RUN_LOCK_STORAGE_KEY
} from "../../shared/storage-keys"

export type RegisterRunStatus = {
  lock: RegisterRunLock | null
  activeInMemory: boolean
  stale: boolean
}

type UseRegisterTaskControlOptions = {
  log: UiLogger
  setStatus: (status: string) => void
  setRunningEmail: (email: string) => void
}

type StartRegisterBatchOptions = {
  selectedEmails: string[]
  runnableCount: number
}

/**
 * 根据持久化任务锁和当前 background 内存状态判断注册任务是否仍在运行。
 *
 * background 能确认同一 runId 时以内存状态为准；无法匹配时沿用旧行为，
 * 在任务锁过期前按运行中处理，避免重复启动。
 */
export const resolveRegisterTaskRuntimeState = (
  registerRunLock: RegisterRunLock | null,
  registerRunStatus: RegisterRunStatus | null,
  now = Date.now()
) => {
  const isRegisterRunLockFresh = Boolean(
    registerRunLock &&
      now - registerRunLock.startedAt < REGISTER_RUN_LOCK_STALE_MS
  )
  const isRegisterRunStatusMatched = Boolean(
    registerRunStatus &&
      registerRunLock &&
      registerRunStatus.lock?.runId === registerRunLock.runId
  )

  return {
    isBatchRunning: isRegisterRunStatusMatched
      ? Boolean(registerRunStatus?.activeInMemory)
      : isRegisterRunLockFresh,
    hasOrphanRegisterRunLock: Boolean(
      registerRunLock &&
        registerRunStatus &&
        isRegisterRunStatusMatched &&
        !registerRunStatus.activeInMemory
    )
  }
}

/**
 * 管理注册自动触发配置和后台批量任务的侧边栏状态。
 *
 * 账号筛选、OAuth/HeroSMS 配置校验仍由注册页面负责；这里只封装 Chrome
 * 存储同步和 runtime 消息交互。
 */
export const useRegisterTaskControl = ({
  log,
  setStatus,
  setRunningEmail
}: UseRegisterTaskControlOptions) => {
  const [alarmConfig, setAlarmConfig] = useState<RegisterAlarmConfig>(
    DEFAULT_REGISTER_ALARM_CONFIG
  )
  const [appliedAlarmConfig, setAppliedAlarmConfig] =
    useState<RegisterAlarmConfig>(DEFAULT_REGISTER_ALARM_CONFIG)
  const [registerRunLock, setRegisterRunLock] =
    useState<RegisterRunLock | null>(null)
  const [registerRunStatus, setRegisterRunStatus] =
    useState<RegisterRunStatus | null>(null)
  const [isClearingRunLock, setIsClearingRunLock] = useState(false)
  const [isAlarmSaving, setIsAlarmSaving] = useState(false)
  const [isAlarmTesting, setIsAlarmTesting] = useState(false)
  const [isBatchStopping, setIsBatchStopping] = useState(false)
  const [isStopStrategyModalOpen, setIsStopStrategyModalOpen] = useState(false)

  const { isBatchRunning, hasOrphanRegisterRunLock } =
    resolveRegisterTaskRuntimeState(registerRunLock, registerRunStatus)

  const refreshRegisterRunStatus = useCallback(async () => {
    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerRunStatus
      })
      setRegisterRunStatus({
        lock: response.lock,
        activeInMemory: Boolean(response.activeInMemory),
        stale: Boolean(response.stale)
      })
      setRegisterRunLock(response.lock)
    } catch (error) {
      log.warn(error instanceof Error ? error.message : "读取注册任务状态失败")
    }
  }, [log])

  useEffect(() => {
    getLocalStorage()?.get(
      [REGISTER_ALARM_STORAGE_KEY, REGISTER_RUN_LOCK_STORAGE_KEY],
      (result) => {
        const nextAlarmConfig = normalizeRegisterAlarmConfig(
          result[REGISTER_ALARM_STORAGE_KEY]
        )
        setAlarmConfig(nextAlarmConfig)
        setAppliedAlarmConfig(nextAlarmConfig)
        setRegisterRunLock(
          normalizeRegisterRunLock(result[REGISTER_RUN_LOCK_STORAGE_KEY])
        )
        void refreshRegisterRunStatus()
      }
    )
  }, [refreshRegisterRunStatus])

  useEffect(() => {
    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") {
        return
      }

      if (changes[REGISTER_ALARM_STORAGE_KEY]) {
        const nextAlarmConfig = normalizeRegisterAlarmConfig(
          changes[REGISTER_ALARM_STORAGE_KEY].newValue
        )
        setAlarmConfig(nextAlarmConfig)
        setAppliedAlarmConfig(nextAlarmConfig)
      }

      if (changes[REGISTER_RUN_LOCK_STORAGE_KEY]) {
        setRegisterRunLock(
          normalizeRegisterRunLock(
            changes[REGISTER_RUN_LOCK_STORAGE_KEY].newValue
          )
        )
        void refreshRegisterRunStatus()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChanged)
    }
  }, [refreshRegisterRunStatus])

  useEffect(() => {
    setRunningEmail(isBatchRunning ? registerRunLock?.currentEmail || "" : "")
  }, [isBatchRunning, registerRunLock?.currentEmail, setRunningEmail])

  useEffect(() => {
    if (!isBatchRunning) {
      setIsBatchStopping(false)
      setIsStopStrategyModalOpen(false)
    }
  }, [isBatchRunning])

  const saveAlarmConfig = async () => {
    const nextConfig = normalizeRegisterAlarmConfig({
      ...alarmConfig,
      selectedEmails: []
    })

    setIsAlarmSaving(true)
    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerAlarmSave,
        config: nextConfig
      })
      const savedConfig = normalizeRegisterAlarmConfig(
        response.config || nextConfig
      )
      setAlarmConfig(savedConfig)
      setAppliedAlarmConfig(savedConfig)
      setStatus(response.message)
      log.info(
        `${response.message}；模式 ${
          savedConfig.mode === "interval"
            ? `${savedConfig.intervalMinutes} 分钟间隔`
            : `每天 ${savedConfig.dailyTime}`
        }；账号间隔 ${savedConfig.accountIntervalMinSeconds}~${savedConfig.accountIntervalMaxSeconds} 秒`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "保存自动触发配置失败"
      setStatus("保存自动触发配置失败")
      log.warn(message)
    } finally {
      setIsAlarmSaving(false)
    }
  }

  const runAlarmNow = async () => {
    setIsAlarmTesting(true)
    setStatus("正在触发单次注册")
    log.info("[注册流程] 正在触发单次注册")
    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerAlarmRunNow
      })
      if (!response.ok) {
        throw new Error(response.message || "单次注册触发失败")
      }

      setStatus(response.message)
      log.info(response.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "触发单次注册失败"
      setStatus("触发单次注册失败")
      log.warn(message)
    } finally {
      setIsAlarmTesting(false)
    }
  }

  const clearRunLock = async () => {
    setIsClearingRunLock(true)
    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerClearRunLock
      })
      setStatus(response.message)
      log[response.ok ? "info" : "warn"](response.message)
      await refreshRegisterRunStatus()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "清除注册任务锁失败"
      setStatus("清除注册任务锁失败")
      log.warn(message)
    } finally {
      setIsClearingRunLock(false)
    }
  }

  const startBatch = async ({
    selectedEmails,
    runnableCount
  }: StartRegisterBatchOptions) => {
    setIsBatchStopping(false)
    setIsStopStrategyModalOpen(false)

    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerBatchStart,
        selectedEmails
      })
      setStatus(response.message)
      log[response.ok ? "info" : "warn"](
        `${response.message}；计划执行 ${runnableCount} 个选中账号`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "提交注册任务到后台失败"
      setStatus("提交注册任务到后台失败")
      log.warn(message)
    }
  }

  const requestStopBatch = async (
    strategy: Exclude<RegisterStopStrategy, "none">
  ) => {
    if (isBatchStopping) {
      return
    }

    setIsBatchStopping(true)
    try {
      const response = await sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerBatchStop,
        strategy
      })
      setStatus(response.message)
      log.warn(response.message)
      if (!response.ok) {
        setIsBatchStopping(false)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "发送停止请求失败"
      setStatus("发送停止请求失败")
      log.warn(message)
      setIsBatchStopping(false)
    }
  }

  const stopBatch = () => {
    if (isBatchStopping) {
      return
    }

    if (registerRunLock?.phonePhase === "phone_submitted") {
      setIsStopStrategyModalOpen(true)
      return
    }

    void requestStopBatch("immediate")
  }

  const chooseStopStrategy = (
    strategy: Exclude<RegisterStopStrategy, "none">
  ) => {
    setIsStopStrategyModalOpen(false)
    void requestStopBatch(strategy)
  }

  return {
    alarmConfig,
    setAlarmConfig,
    appliedAlarmConfig,
    registerRunLock,
    isBatchRunning,
    hasOrphanRegisterRunLock,
    isClearingRunLock,
    isAlarmSaving,
    isAlarmTesting,
    isBatchStopping,
    isStopStrategyModalOpen,
    saveAlarmConfig,
    runAlarmNow,
    clearRunLock,
    startBatch,
    stopBatch,
    chooseStopStrategy
  }
}
