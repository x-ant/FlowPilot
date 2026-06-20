import { REQUEST_HANDLERS } from "./background/message-handlers"
import { setupSidePanelBehavior } from "./background/side-panel"
import type {
  BackgroundRequest,
  BackgroundRequestHandler,
  BackgroundResponse
} from "./background/types"

setupSidePanelBehavior()

type AnyBackgroundRequestHandler = BackgroundRequestHandler<BackgroundRequest>

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
  const handler = REQUEST_HANDLERS[request.type] as AnyBackgroundRequestHandler

  return handler(request)
}

/**
 * 处理侧边栏发来的后台请求，并按 request.type 分发到对应 handler。
 *
 * 注意：返回 true 表示 sendResponse 会异步调用，Chrome 不要提前关闭消息通道。
 *
 * @param message Chrome runtime 收到的原始 message。
 * @param _sender 消息发送方信息，下划线表示“这个参数我知道有，但当前不使用”。
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

  // void 表示这个异步 Promise 链已经被启动和处理了，但当前函数不等待它，也不返回它；
  void dispatchBackgroundRequest(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "后台请求处理失败"
      })
    })

  // 如果异步回复，就返回 true，如果同步回复或不处理，就可以返回 false 或不返回
  // 否则就会在函数返回后关闭消息通道，
  // 提示 The message port closed before a response was received.
  return true
}

chrome.runtime.onMessage.addListener(handleBackgroundRequest)
