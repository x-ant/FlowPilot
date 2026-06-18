import { MESSAGE_HANDLERS } from "./background/message-handlers"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  BackgroundMessage,
  BackgroundResponse
} from "./background/types"

setupSidePanelBehavior()

/**
 * 监听侧边栏发来的后台消息，并按 message.type 分发到对应 handler。
 *
 * 注意：监听器里 return true 表示 sendResponse 会异步调用，Chrome 不要提前关闭消息通道。
 */
chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    switch (message.type) {
      case "codex-login:start":
        MESSAGE_HANDLERS["codex-login:start"](message)
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
      case "codex-login:open-auth-link":
        MESSAGE_HANDLERS["codex-login:open-auth-link"](message)
          .then(sendResponse)
          .catch((error) => {
            sendResponse({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : "执行 Codex 授权链接打开失败"
            })
          })
        return true
      default:
        return false
    }
  }
)
