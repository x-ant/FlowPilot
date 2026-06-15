/**
 * 让用户点击扩展图标时打开 Chrome 侧边栏。
 *
 * 这个设置在安装和浏览器启动时都重新执行一次，避免 Chrome 重启后行为丢失。
 */
export const setupSidePanelBehavior = () => {
  const enableSidePanelOnActionClick = () => {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => {
        console.warn("设置点击扩展图标打开侧边栏失败", error)
      })
  }

  enableSidePanelOnActionClick()

  chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick)
  chrome.runtime.onStartup.addListener(enableSidePanelOnActionClick)
}

