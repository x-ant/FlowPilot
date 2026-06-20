import { REQUEST_HANDLERS } from "./background/message-handlers"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  BackgroundRequest,
  BackgroundRequestHandler,
  BackgroundRequestType,
  BackgroundResponse
} from "./background/types"

setupSidePanelBehavior()

const REQUEST_FAILURE_MESSAGES: Record<BackgroundRequestType, string> = {
  "codex-login:start": "执行 Codex 登录入口点击失败",
  "codex-login:open-auth-link": "执行 Codex 授权链接打开失败",
  "codex-login:fill-auth-email": "执行 Codex 登录邮箱填写失败",
  "codex-login:fill-auth-code": "执行 Codex 登录验证码回填失败",
  "codex-login:confirm-oauth-callback": "执行 Codex OAuth 回调提交失败"
}

/**
 * 判断收到的 runtime message 是否是本模块支持的后台请求。
 *
 * Chrome runtime 消息可能来自扩展内其他入口，所以这里先做一次轻量过滤。
 *
 * message is BackgroundRequest 表示类型缩小到 BackgroundRequest，
 * 有且仅有返回值是 true，message 才能被后续代码判断为 BackgroundRequest。
 *
 * @param message 原始 runtime message。
 * @return 如果是已注册的后台请求则返回 true。
 */
const isBackgroundRequest = (
  message: unknown
): message is BackgroundRequest => {
  if (!message || typeof message !== "object") {
    return false
  }

  const type = (message as { type?: unknown }).type
  return typeof type === "string" && type in REQUEST_HANDLERS
}

/**
 * 执行对应的后台请求处理器。
 *
 * REQUEST_HANDLERS 本身保持按 request.type 精确约束；这里是统一分发入口，
 * 所以把 handler 收窄成可接收 BackgroundRequest 的通用处理器。
 *
 * @param request 已确认支持的后台请求。
 * @return 后台处理结果。
 */
const dispatchBackgroundRequest = (request: BackgroundRequest) => {
  const handler = REQUEST_HANDLERS[
    request.type
  ] as BackgroundRequestHandler<BackgroundRequest>

  return handler(request)
}

/**
 * 根据异常和消息类型生成统一的失败响应。
 *
 * @param request 当前处理的后台请求。
 * @param error 捕获到的异常。
 * @return 可直接传给 sendResponse 的失败响应。
 */
const buildFailureResponse = (
  request: BackgroundRequest,
  error: unknown
): BackgroundResponse => {
  return {
    ok: false,
    message:
      error instanceof Error
        ? error.message
        : REQUEST_FAILURE_MESSAGES[request.type]
  }
}

/**
 * 处理侧边栏发来的后台请求，并按 request.type 分发到对应 handler。
 *
 * 注意：返回 true 表示 sendResponse 会异步调用，Chrome 不要提前关闭消息通道。
 *
 * @param message Chrome runtime 收到的原始 message。
 * @param _sender 消息发送方信息，这里不使用。
 * @param sendResponse 回传给侧边栏的响应函数。
 * @return 如果会异步调用 sendResponse，则返回 true。
 */
const handleBackgroundRequest = (
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
) => {
  if (!isBackgroundRequest(message)) {
    return false
  }

  void dispatchBackgroundRequest(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse(buildFailureResponse(message, error))
    })

  return true
}

chrome.runtime.onMessage.addListener(handleBackgroundRequest)
