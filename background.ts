import { MESSAGE_HANDLERS } from "./background/message-handlers"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  BackgroundMessage,
  BackgroundResponse
} from "./background/types"

setupSidePanelBehavior()

/**
 * 处理侧边栏发来的后台消息，并按 message.type 分发到对应 handler。
 *
 * 注意：返回 true 表示 sendResponse 会异步调用，Chrome 不要提前关闭消息通道。
 *
 * @param message 侧边栏发送的后台消息。
 * @param _sender 消息发送方信息，这里不使用。
 * @param sendResponse 回传给侧边栏的响应函数。
 * @return 如果会异步调用 sendResponse，则返回 true。
 */
const handleBackgroundMessage = (
  message: BackgroundMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
) => {
  // 根据消息类型把请求交给对应的后台处理函数，并把异步结果回传给侧边栏。
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

chrome.runtime.onMessage.addListener(handleBackgroundMessage)
