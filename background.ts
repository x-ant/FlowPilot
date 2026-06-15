import { startCodexLogin } from "./background/codex-login"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  StartCodexLoginMessage,
  StartCodexLoginResponse
} from "./background/types"

setupSidePanelBehavior()

/**
 * 监听侧边栏发来的“开始登录”消息。
 *
 * 注意：监听器里 return true 表示 sendResponse 会异步调用，Chrome 不要提前关闭消息通道。
 */
chrome.runtime.onMessage.addListener(
  (
    message: StartCodexLoginMessage,
    _sender,
    sendResponse: (response: StartCodexLoginResponse) => void
  ) => {
    if (message?.type !== "codex-login:start") {
      return false
    }

    startCodexLogin(message.payload.loginUrl)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "执行 Codex 登录入口点击失败"
        })
      })

    return true
  }
)
