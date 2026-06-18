/**
 * 后台消息的基础结构。
 *
 * TType 是消息类型字符串，例如 "codex-login:start"。
 * TPayload 是这类消息携带的数据结构。
 */
type BackgroundMessageBase<TType extends string, TPayload> = {
  type: TType
  payload: TPayload
}

/**
 * 步骤 1：点击目标页面里的“开始codex登录”按钮。
 */
export type StartCodexLoginMessage = BackgroundMessageBase<
  "codex-login:start",
  {
    loginUrl: string
  }
>

/**
 * 步骤 2：点击目标页面里的“打开链接”按钮。
 */
export type OpenCodexAuthLinkMessage = BackgroundMessageBase<
  "codex-login:open-auth-link",
  {
    loginUrl: string
  }
>

/**
 * 所有 background 可以处理的消息联合类型。
 *
 * 后续新增步骤时，把新的 Message 类型用 | 加到这里。
 */
export type BackgroundMessage =
  | StartCodexLoginMessage
  | OpenCodexAuthLinkMessage

/**
 * Codex 登录步骤的后台响应结构。
 */
export type StartCodexLoginResponse = {
  ok: boolean
  message: string
  tabId?: number
  url?: string
  authUrl?: string
}

/**
 * 所有后台消息处理器统一返回的响应类型。
 *
 * 后续如果每个步骤响应字段不同，可以改成多个响应类型的联合类型。
 */
export type BackgroundResponse = StartCodexLoginResponse

/**
 * 注入目标网页后，点击页面按钮的执行结果。
 */
export type ClickPageButtonResult = {
  ok: boolean
  message: string
  buttonText?: string
  authUrl?: string
}

/**
 * 从所有消息中提取 type 字段，得到所有可处理的消息类型字符串。
 */
export type BackgroundMessageType = BackgroundMessage["type"]

/**
 * 后台消息处理函数的统一格式。
 *
 * TMessage 必须是 BackgroundMessage 里的某一种消息。
 * 函数接收这条消息，并异步返回统一的后台响应。
 */
export type BackgroundMessageHandler<TMessage extends BackgroundMessage> = (
  message: TMessage
) => Promise<BackgroundResponse>
