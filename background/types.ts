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
    targetUrl: string
  }
>

/**
 * 步骤 2：打开 OpenAI 登录页或授权链接。
 */
export type OpenCodexAuthLinkMessage = BackgroundMessageBase<
  "codex-login:open-auth-link",
  {
    targetUrl: string
  }
>

/**
 * 步骤 3：在 OpenAI 登录页填写邮箱并继续。
 */
export type FillOpenaiLoginEmailMessage = BackgroundMessageBase<
  "codex-login:fill-auth-email",
  {
    tabId: number
    email: string
  }
>

/**
 * 步骤 4：读取 2925 验证码并回填到邮箱验证码页。
 */
export type FillOpenaiLoginVerificationCodeMessage = BackgroundMessageBase<
  "codex-login:fill-auth-code",
  {
    tabId: number
    email: string
    password: string
  }
>

/**
 * 步骤 5：确认 OAuth 授权并把 localhost 回调 URL 提交到管理页。
 */
export type ConfirmCodexOAuthCallbackMessage = BackgroundMessageBase<
  "codex-login:confirm-oauth-callback",
  {
    tabId: number
    targetUrl: string
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
  | FillOpenaiLoginEmailMessage
  | FillOpenaiLoginVerificationCodeMessage
  | ConfirmCodexOAuthCallbackMessage

/**
 * 浏览器标签页的最小信息。
 */
export type BrowserTabInfo = {
  id?: number
  url?: string
}

/**
 * Codex 登录步骤响应的公共字段。
 *
 * targetTab 表示当前步骤主要操作的页面。各步骤如果有额外上下文，
 * 再通过自己的响应类型组合出来，避免把所有字段都堆成 optional。
 */
export type CodexLoginStepResponseBase = {
  ok: boolean
  message: string
  targetTab?: BrowserTabInfo
}

/**
 * 注入页面脚本后的通用页面动作响应。
 */
export type CodexLoginPageActionResponse = CodexLoginStepResponseBase

/**
 * 步骤 1：点击目标页面里的“开始codex登录”按钮。
 */
export type StartCodexLoginStepResponse = CodexLoginStepResponseBase

/**
 * 步骤 2：打开 OpenAI 登录页或授权链接。
 */
export type OpenCodexAuthLinkResponse = CodexLoginStepResponseBase

/**
 * 步骤 3：在 OpenAI 登录页填写邮箱并继续。
 */
export type FillOpenaiLoginEmailResponse = CodexLoginStepResponseBase

/**
 * 步骤 4：读取 2925 验证码并回填到邮箱验证码页。
 *
 * mailTab 表示读取验证码时用到的 2925 邮箱页面。
 */
export type FillOpenaiLoginVerificationCodeResponse =
  CodexLoginStepResponseBase & {
    mailTab?: BrowserTabInfo
  }

/**
 * 步骤 5：确认 OAuth 授权并提交回调 URL。
 *
 * managementTab 表示被回填 callback URL 的 Codex 管理页。
 */
export type ConfirmCodexOAuthCallbackResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
  managementTab?: BrowserTabInfo
}

/**
 * 所有后台消息处理器统一返回的响应类型。
 */
export type BackgroundResponse =
  | StartCodexLoginStepResponse
  | OpenCodexAuthLinkResponse
  | FillOpenaiLoginEmailResponse
  | FillOpenaiLoginVerificationCodeResponse
  | ConfirmCodexOAuthCallbackResponse

/**
 * 注入目标网页后，点击页面按钮的执行结果。
 */
export type ClickPageButtonResult = {
  ok: boolean
  message: string
  buttonText?: string
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
