import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  RUNTIME_SETTINGS_STORAGE_KEY
} from "../../shared/account-state"

const keepAwakeReasons = new Set<string>()
let keepAwakeDuringRun = DEFAULT_RUNTIME_SETTINGS.keepAwakeDuringRun

/**
 * 按当前引用计数刷新 Chrome 保持唤醒状态。
 *
 * `chrome.power.requestKeepAwake("display")` 只能在 Chrome 和系统已经醒着时，
 * 阻止屏幕关闭和系统进入睡眠；它不能唤醒已经睡眠、休眠或关机的电脑。
 * 所以“运行时保持唤醒”的能力边界是：流程开始后防止运行中睡着，
 * 不是让定时任务在电脑睡着后自动唤醒并执行。
 */
const refreshPowerKeepAwake = () => {
  if (!chrome.power) {
    return
  }

  try {
    if (keepAwakeDuringRun && keepAwakeReasons.size > 0) {
      chrome.power.requestKeepAwake("display")
      return
    }

    chrome.power.releaseKeepAwake()
  } catch {
    // 保持唤醒只是辅助能力，失败不影响主流程。
  }
}

/**
 * 为正在运行的流程申请保持屏幕和系统唤醒。
 *
 * 这里仅记录运行中的申请来源；是否真正调用 Chrome Power API 还要看全局
 * “运行时保持唤醒”开关。设置定时任务本身不会调用这里，只有登录/注册
 * 批量流程实际开始执行时才会申请。
 *
 * @param reason 申请来源；同一个来源重复申请只计一次。
 */
export const requestPowerKeepAwake = (reason: string) => {
  keepAwakeReasons.add(reason)
  refreshPowerKeepAwake()
}

/**
 * 释放指定来源的保持唤醒申请。
 *
 * @param reason 申请来源。
 */
export const releasePowerKeepAwake = (reason: string) => {
  keepAwakeReasons.delete(reason)
  refreshPowerKeepAwake()
}

/**
 * 注册侧边栏发来的保持唤醒消息。
 */
export const setupPowerKeepAwake = () => {
  chrome.storage.local.get([RUNTIME_SETTINGS_STORAGE_KEY], (result) => {
    keepAwakeDuringRun = normalizeRuntimeSettings(
      result?.[RUNTIME_SETTINGS_STORAGE_KEY]
    ).keepAwakeDuringRun
    refreshPowerKeepAwake()
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[RUNTIME_SETTINGS_STORAGE_KEY]) {
      return
    }

    keepAwakeDuringRun = normalizeRuntimeSettings(
      changes[RUNTIME_SETTINGS_STORAGE_KEY].newValue
    ).keepAwakeDuringRun
    refreshPowerKeepAwake()
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "flowpilot:power-keep-awake") {
      return false
    }

    const reason = String(message.reason || "sidepanel")
    if (message.action === "acquire") {
      requestPowerKeepAwake(reason)
      sendResponse({ ok: true })
      return true
    }

    if (message.action === "release") {
      releasePowerKeepAwake(reason)
      sendResponse({ ok: true })
      return true
    }

    sendResponse({
      ok: false,
      message: "未知保持唤醒操作"
    })
    return true
  })
}
