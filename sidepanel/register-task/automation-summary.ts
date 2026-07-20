import type { RegisterAlarmConfig } from "../../shared/account-state"

/** 获取自动触发配置在折叠面板标题旁的摘要。 */
export const getRegisterAlarmSummary = (config: RegisterAlarmConfig) => {
  return config.mode === "interval"
    ? `每 ${config.intervalMinutes} 分钟`
    : `每天 ${config.dailyTime}`
}
