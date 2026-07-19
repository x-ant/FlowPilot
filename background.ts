import { setupPowerKeepAwake } from "./background/app/power"
import { setupSidePanelBehavior } from "./background/app/side-panel"
import { setupRegisterAlarm } from "./background/register/alarm"

/**
 * 安全启动后台模块，避免某个初始化异常导致 MV3 service worker 注册失败。
 *
 * @param name 模块名称，用于后台 console 定位。
 * @param setup 模块初始化函数。
 */
const setupBackgroundModule = (name: string, setup: () => void) => {
  try {
    setup()
  } catch (error) {
    console.error(`[FlowPilot] 后台模块启动失败：${name}`, error)
  }
}

setupBackgroundModule("register-alarm", setupRegisterAlarm)
setupBackgroundModule("power-keep-awake", setupPowerKeepAwake)
setupBackgroundModule("side-panel", setupSidePanelBehavior)
