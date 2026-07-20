import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage
} from "../../platform/chrome/storage"
import {
  loadAccountPageState,
  normalizeRegisterRunLock,
  REGISTER_RUN_LOCK_STALE_MS,
  saveAccountPageState,
  type RegisterRunLock
} from "../../shared/account-state"
import {
  REGISTER_HERO_SMS_STORAGE_KEY,
  REGISTER_RUN_LOCK_STORAGE_KEY,
  REGISTER_STORAGE_KEYS
} from "../../shared/storage-keys"
import {
  createOAuthIntegrationConfig,
  hasRequiredOAuthIntegrationConfig,
  loadOAuthTargetSettings
} from "../../shared/sub2api"
import { releasePowerKeepAwake, requestPowerKeepAwake } from "../app/power"
import { runRegisterBatch, type RegisterStopStrategy } from "./batch-runner"
import {
  logRegisterBackground,
  writeRegisterExecutionLog
} from "./execution-log"
import type { HeroSmsPhoneVerificationOptions } from "./phone-verification"

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

export type StartRegisterBatchJobOptions = {
  source: RegisterRunLock["source"]
  selectedEmails: string[]
  allowInvalidWhenSelected?: boolean
  accountIntervalMinSeconds?: number
  accountIntervalMaxSeconds?: number
  targetAllWhenNoSelection: boolean
  triggerLabel: string
  onAlarmLastMessage?: (message: string) => Promise<void>
  onDailyAlarmFinished?: () => Promise<void>
}

const createRunId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getRegisterRunLock = async () => {
  const result = await readLocalStorage([REGISTER_RUN_LOCK_STORAGE_KEY])
  return normalizeRegisterRunLock(result[REGISTER_RUN_LOCK_STORAGE_KEY])
}

const isFreshRunLock = (lock: RegisterRunLock | null) => {
  return Boolean(
    lock && Date.now() - lock.startedAt < REGISTER_RUN_LOCK_STALE_MS
  )
}

const saveRegisterRunLock = async (lock: RegisterRunLock) => {
  await writeLocalStorage({
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
    await removeLocalStorage([REGISTER_RUN_LOCK_STORAGE_KEY])
  }
}

const buildHeroSmsOptions = async (
  logPrefix: string,
  onPhoneVerificationPhase?: HeroSmsPhoneVerificationOptions["onPhoneVerificationPhase"]
): Promise<HeroSmsPhoneVerificationOptions> => {
  const result = await readLocalStorage([REGISTER_HERO_SMS_STORAGE_KEY])
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
    onLog: (level, message, options) => {
      logRegisterBackground(level, `[${logPrefix}] Step 6 ${message}`, options)
    },
    onPhoneVerificationPhase
  }
}

/**
 * 启动一次注册批量任务。
 *
 * 这里只负责运行态：任务锁、保持唤醒、调用批量执行器、停止策略和账号状态落库；
 * 定时任务是否启用、何时再次调度由 alarm.ts 决定。
 *
 * @param options 启动批量任务所需的账号范围、触发来源和回调。
 * @return 是否成功提交到后台执行。
 */
export const startRegisterBatchJob = async ({
  source,
  selectedEmails,
  allowInvalidWhenSelected = false,
  accountIntervalMinSeconds,
  accountIntervalMaxSeconds,
  targetAllWhenNoSelection,
  triggerLabel,
  onAlarmLastMessage,
  onDailyAlarmFinished
}: StartRegisterBatchJobOptions) => {
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
  const integration = createOAuthIntegrationConfig(
    await loadOAuthTargetSettings("register"),
    cpaUrl,
    cpaManagementKey
  )
  if (!hasRequiredOAuthIntegrationConfig(integration)) {
    return {
      ok: false,
      message: "OAuth 接入配置不完整"
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
  requestPowerKeepAwake(`register:${runId}`)

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
        integration,
        accounts: state.accounts,
        selectedEmails,
        heroSmsOptions,
        abortSignal: abortController.signal,
        allowInvalidWhenSelected,
        accountIntervalMinSeconds,
        accountIntervalMaxSeconds,
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

      await writeLocalStorage({
        [REGISTER_STORAGE_KEYS.cpaUrl]: cpaUrl,
        [REGISTER_STORAGE_KEYS.cpaManagementKey]: cpaManagementKey,
        [REGISTER_STORAGE_KEYS.accounts]: latestAccounts
      })

      if (source === "alarm") {
        await onAlarmLastMessage?.(result.message)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "注册批量任务执行失败"
      logRegisterBackground("warn", message)
      await patchRegisterRunLock(runId, {
        message
      })
      if (source === "alarm") {
        await onAlarmLastMessage?.(message)
      }
    } finally {
      releasePowerKeepAwake(`register:${runId}`)
      await releaseRegisterRunLock(runId)
      if (activeRegisterRun?.runId === runId) {
        activeRegisterRun = null
      }
      if (source === "alarm") {
        await onDailyAlarmFinished?.()
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

/**
 * 按指定策略停止当前注册批量任务。
 *
 * @param strategy 停止策略。
 * @return 停止请求是否被当前后台任务接受。
 */
export const stopRegisterBatchJob = async (strategy: RegisterStopStrategy) => {
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
      : "已设置为成功则完成回填后停止"
  await patchRegisterRunLock(lock.runId, {
    message
  })
  await writeRegisterExecutionLog("warn", message)

  return {
    ok: true,
    message
  }
}

/**
 * 获取当前注册任务运行状态。
 *
 * @return 当前任务锁、内存任务是否存在、任务锁是否过期。
 */
export const getRegisterRunStatus = async () => {
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

/**
 * 清理已经失去内存任务的残留注册任务锁。
 *
 * @return 清理结果。
 */
export const clearStaleRegisterRunLock = async () => {
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
