import { describe, expect, it } from "vitest"

import {
  DEFAULT_REGISTER_ALARM_CONFIG,
  type RegisterRunLock
} from "../../shared/account-state"
import { getRegisterAlarmSummary } from "../../sidepanel/register-task/automation-summary"
import { getRegisterRunLockDisplay } from "../../sidepanel/register-task/task-status-display"
import { resolveRegisterTaskRuntimeState } from "../../sidepanel/register-task/useRegisterTaskControl"

const NOW = 1_000_000

const createRunLock = (
  patch: Partial<RegisterRunLock> = {}
): RegisterRunLock => {
  return {
    runId: "run-current",
    source: "manual",
    startedAt: NOW - 1_000,
    currentEmail: "account-id",
    message: "正在执行",
    ...patch
  }
}

describe("register task runtime state", () => {
  it("background 状态未知时把未过期任务锁视为运行中", () => {
    expect(resolveRegisterTaskRuntimeState(createRunLock(), null, NOW)).toEqual(
      {
        isBatchRunning: true,
        hasOrphanRegisterRunLock: false
      }
    )
  })

  it("同一 runId 已不在 background 内存时识别为残留锁", () => {
    const lock = createRunLock()

    expect(
      resolveRegisterTaskRuntimeState(
        lock,
        {
          lock,
          activeInMemory: false,
          stale: false
        },
        NOW
      )
    ).toEqual({
      isBatchRunning: false,
      hasOrphanRegisterRunLock: true
    })
  })

  it("background 返回其他 runId 时仍以当前未过期任务锁为准", () => {
    const lock = createRunLock()

    expect(
      resolveRegisterTaskRuntimeState(
        lock,
        {
          lock: createRunLock({ runId: "run-other" }),
          activeInMemory: false,
          stale: false
        },
        NOW
      )
    ).toEqual({
      isBatchRunning: true,
      hasOrphanRegisterRunLock: false
    })
  })

  it("已过期且无法由 background 确认的任务锁不再阻止执行", () => {
    const lock = createRunLock({
      startedAt: NOW - 3 * 60 * 60 * 1_000
    })

    expect(resolveRegisterTaskRuntimeState(lock, null, NOW)).toEqual({
      isBatchRunning: false,
      hasOrphanRegisterRunLock: false
    })
  })
})

describe("register automation summary", () => {
  it("按间隔和每天两种模式生成标题摘要", () => {
    expect(
      getRegisterAlarmSummary({
        ...DEFAULT_REGISTER_ALARM_CONFIG,
        mode: "interval",
        intervalMinutes: 45
      })
    ).toBe("每 45 分钟")
    expect(
      getRegisterAlarmSummary({
        ...DEFAULT_REGISTER_ALARM_CONFIG,
        mode: "daily",
        dailyTime: "03:30"
      })
    ).toBe("每天 03:30")
  })
})

describe("register run lock display", () => {
  it("保留任务锁信息，并为缺失数据提供可读占位", () => {
    const lock = createRunLock()

    expect(getRegisterRunLockDisplay(lock)).toEqual({
      startedAt: lock.startedAt,
      currentAccount: "account-id",
      lastMessage: "正在执行"
    })
    expect(getRegisterRunLockDisplay(null)).toEqual({
      startedAt: undefined,
      currentAccount: "未知",
      lastMessage: "未知"
    })
  })
})
