import { describe, expect, it } from "vitest"

import {
  DEFAULT_REGISTER_ALARM_CONFIG,
  normalizeRegisterAlarmConfig
} from "../../shared/account-state"

describe("normalizeRegisterAlarmConfig", () => {
  it("使用安全默认值规范化空配置", () => {
    expect(normalizeRegisterAlarmConfig(undefined)).toMatchObject({
      ...DEFAULT_REGISTER_ALARM_CONFIG,
      lastTriggeredAt: 0,
      lastMessage: "",
      runningStartedAt: 0
    })
  })

  it("限制触发间隔并保证最大账号间隔不小于最小值", () => {
    const config = normalizeRegisterAlarmConfig({
      intervalMinutes: -5,
      accountIntervalMinSeconds: 90,
      accountIntervalMaxSeconds: 30
    })

    expect(config.intervalMinutes).toBe(1)
    expect(config.accountIntervalMinSeconds).toBe(90)
    expect(config.accountIntervalMaxSeconds).toBe(90)
  })

  it("保留合法账号 ID 并过滤空值", () => {
    const config = normalizeRegisterAlarmConfig({
      selectedEmails: [" account-1 ", "", "account-2"]
    })

    expect(config.selectedEmails).toEqual(["account-1", "account-2"])
  })
})
