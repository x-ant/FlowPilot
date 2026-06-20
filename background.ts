import { MESSAGE_HANDLERS } from "./background/message-handlers"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  BackgroundMessage,
  BackgroundMessageHandler,
  BackgroundMessageType,
  BackgroundResponse
} from "./background/types"

setupSidePanelBehavior()

const MESSAGE_FAILURE_MESSAGES: Record<BackgroundMessageType, string> = {
  "codex-login:start": "执行 Codex 登录入口点击失败",
  "codex-login:open-auth-link": "执行 Codex 授权链接打开失败",
  "codex-login:fill-auth-email": "执行 Codex 登录邮箱填写失败",
  "codex-login:fill-auth-code": "执行 Codex 登录验证码回填失败"
}

/**
 * 判断收到的 runtime message 是否是本模块支持的后台消息。
 *
 * Chrome runtime 消息可能来自扩展内其他入口，所以这里先做一次轻量过滤。
 *
 * @param message 原始 runtime message。
 * @return 如果是已注册的后台消息则返回 true。
 */
const isBackgroundMessage = (message: unknown): message is BackgroundMessage => {
  if (!message || typeof message !== "object") {
    return false
  }

  const type = (message as { type?: unknown }).type
  return typeof type === "string" && type in MESSAGE_HANDLERS
}

/**
 * 执行对应的后台消息处理器。
 *
 * MESSAGE_HANDLERS 本身保持按 message.type 精确约束；这里是统一分发入口，
 * 所以把 handler 收窄成可接收 BackgroundMessage 的通用处理器。
 *
 * @param message 已确认支持的后台消息。
 * @return 后台处理结果。
 */
const dispatchBackgroundMessage = (message: BackgroundMessage) => {
  const handler = MESSAGE_HANDLERS[
    message.type
  ] as BackgroundMessageHandler<BackgroundMessage>

  return handler(message)
}

/**
 * 根据异常和消息类型生成统一的失败响应。
 *
 * @param message 当前处理的后台消息。
 * @param error 捕获到的异常。
 * @return 可直接传给 sendResponse 的失败响应。
 */
const buildFailureResponse = (
  message: BackgroundMessage,
  error: unknown
): BackgroundResponse => {
  return {
    ok: false,
    message:
      error instanceof Error
        ? error.message
        : MESSAGE_FAILURE_MESSAGES[message.type]
  }
}

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
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
) => {
  if (!isBackgroundMessage(message)) {
    return false
  }

  void dispatchBackgroundMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse(buildFailureResponse(message, error))
    })

  return true
}

chrome.runtime.onMessage.addListener(handleBackgroundMessage)
