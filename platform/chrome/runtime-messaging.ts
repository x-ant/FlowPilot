import type {
  FlowPilotRuntimeMessage,
  RuntimeMessageResponse,
  RuntimeMessageResponseFor,
  RuntimeMessageType
} from "../../shared/runtime-messages"

/**
 * 向扩展 background 发送一条有类型约束的消息。
 *
 * 请求的 `type` 会自动决定 Promise 的响应类型；继续使用 callback 形式是为了
 * 显式读取 `chrome.runtime.lastError`，保留清晰的错误信息。
 */
export const sendRuntimeMessage = <TMessage extends FlowPilotRuntimeMessage>(
  message: TMessage
) => {
  return new Promise<RuntimeMessageResponse<TMessage>>((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("Chrome runtime API 不可用"))
      return
    }

    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(response as RuntimeMessageResponse<TMessage>)
    })
  })
}

/**
 * 由 background 监听器返回与消息类型匹配的响应。
 */
export const sendRuntimeMessageResponse = <TType extends RuntimeMessageType>(
  sendResponse: (response?: unknown) => void,
  _type: TType,
  response: RuntimeMessageResponseFor<TType>
) => {
  sendResponse(response)
}
