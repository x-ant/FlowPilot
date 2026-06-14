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
