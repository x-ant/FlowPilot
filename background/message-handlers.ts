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
 * 处理“开始 Codex 登录”消息。
 *
 * @param message 步骤 1 消息，包含登录地址。
 * @return 步骤执行结果。
 */
const handleStartCodexLogin = (message: StartCodexLoginMessage) => {
  return startCodexLogin(message.payload.loginUrl)
}

/**
 * 处理“打开授权链接”消息。
 *
 * @param message 步骤 2 消息，包含登录地址。
 * @return 步骤执行结果。
 */
const handleOpenCodexAuthLink = (message: OpenCodexAuthLinkMessage) => {
  return openCodexAuthLink(message.payload.loginUrl)
}

/**
 * 后台消息处理器映射表。
 *
 * 后续新增步骤时，在 types.ts 增加消息类型，然后在这里补一个 handler。
 *
 * @return 后台消息与处理函数的映射表。
 */
export const MESSAGE_HANDLERS: BackgroundMessageHandlerMap = {
  "codex-login:start": handleStartCodexLogin,
  "codex-login:open-auth-link": handleOpenCodexAuthLink
}
