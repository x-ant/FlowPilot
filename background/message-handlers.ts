import { openCodexAuthLink, startCodexLogin } from "./codex-login"
import type {
  BackgroundMessage,
  BackgroundMessageHandler,
  BackgroundMessageType,
  OpenCodexAuthLinkMessage,
  StartCodexLoginMessage
} from "./types"

/**
 * 后台消息处理器映射表的类型。
 *
 * [Type in BackgroundMessageType] 会遍历所有消息 type，要求每个 type 都有一个 handler。
 * Extract<BackgroundMessage, { type: Type }> 会从消息联合类型里取出当前 type 对应的消息结构。
 *
 * 例如 Type 是 "codex-login:start" 时，handler 的 message 参数就是 StartCodexLoginMessage。
 */
type BackgroundMessageHandlerMap = {
  [Type in BackgroundMessageType]: BackgroundMessageHandler<
    Extract<BackgroundMessage, { type: Type }>
  >
}

/**
 * 后台消息处理器映射表。
 *
 * 后续新增步骤时，在 types.ts 增加消息类型，然后在这里补一个 handler。
 */
export const MESSAGE_HANDLERS: BackgroundMessageHandlerMap = {
  "codex-login:start": (message: StartCodexLoginMessage) => {
    return startCodexLogin(message.payload.loginUrl)
  },
  "codex-login:open-auth-link": (message: OpenCodexAuthLinkMessage) => {
    return openCodexAuthLink(message.payload.loginUrl)
  }
}
