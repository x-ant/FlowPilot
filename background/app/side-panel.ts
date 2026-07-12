import { createConsoleLogger } from "../../shared/logging";


const log = createConsoleLogger("side-panel")

/**
 * 让用户点击扩展图标时打开 Chrome 侧边栏。
 *
 * 这个设置在安装和浏览器启动时都重新执行一次，避免 Chrome 重启后行为丢失。
 *
 * @return 无。
 */
export const setupSidePanelBehavior = () => {
  /**
   * 让点击扩展图标时自动打开侧边栏。
   *
   * @return 无。
   */
  const enableSidePanelOnActionClick = () => {
    if (!chrome.sidePanel?.setPanelBehavior) {
      log.error("当前浏览器环境不支持 chrome.sidePanel.setPanelBehavior")
      return
    }

    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => {
        log.error("设置点击扩展图标打开侧边栏失败", error)
      })
  }

  enableSidePanelOnActionClick()

  chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick)
  chrome.runtime.onStartup.addListener(enableSidePanelOnActionClick)
}
