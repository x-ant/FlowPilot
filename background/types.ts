/**
 * 后台请求的基础结构。
 *
 * TType 是请求类型字符串，例如 "codex-login:open-auth-link"。
 * TPayload 是这类请求携带的数据结构。
 */
type BackgroundRequestBase<TType extends string, TPayload> = {
  type: TType
  payload: TPayload
}

/**
 * 步骤 1：点击目标页面里的“开始codex登录”按钮，并打开 OpenAI 登录页。
 */
export type OpenCodexAuthLinkRequest = BackgroundRequestBase<
  "codex-login:open-auth-link",
  {
    targetUrl: string
  }
>

/**
 * 步骤 2：在 OpenAI 登录页填写邮箱并等待下一页。
 */
export type SubmitCodexLoginEmailRequest = BackgroundRequestBase<
  "codex-login:submit-login-email",
  {
    tabId: number
    email: string
  }
>

/**
 * 步骤 3：如果出现密码页，则填写密码并等待验证码页。
 */
export type SubmitCodexLoginPasswordRequest = BackgroundRequestBase<
  "codex-login:submit-login-password",
  {
    tabId: number
    password: string
  }
>

/**
 * 步骤 4：读取 2925 验证码并回填。
 */
export type FetchAndSubmitCodexVerificationCodeRequest = BackgroundRequestBase<
  "codex-login:submit-verification-code",
  {
    tabId: number
    email: string
    password: string
    verificationRequestedAt?: number
  }
>

/**
 * 兼容旧入口：在 OpenAI 登录页填写邮箱，读取 2925 验证码并回填。
 */
export type CompleteCodexLoginEmailAuthFlowRequest = BackgroundRequestBase<
  "codex-login:fill-auth-email-and-code",
  {
    tabId: number
    email: string
    password: string
  }
>

/**
 * 步骤 5：确认 OAuth 授权并捕获 localhost 回调 URL。
 */
export type ConfirmCodexOAuthConsentRequest = BackgroundRequestBase<
  "codex-login:confirm-oauth-consent",
  {
    tabId: number
  }
>

/**
 * 步骤 6：把 localhost 回调 URL 提交到管理页。
 */
export type SubmitCodexOAuthCallbackRequest = BackgroundRequestBase<
  "codex-login:submit-oauth-callback",
  {
    tabId?: number
    targetUrl: string
    callbackUrl: string
  }
>

/**
 * 兼容旧入口：确认 OAuth 授权并把 localhost 回调 URL 提交到管理页。
 */
export type ConfirmCodexOAuthCallbackRequest = BackgroundRequestBase<
  "codex-login:confirm-oauth-callback",
  {
    tabId: number
    targetUrl: string
  }
>

/**
 * 所有 background 可以处理的请求联合类型。
 *
 * 后续新增步骤时，把新的 Request 类型用 | 加到这里。
 */
export type BackgroundRequest =
  | OpenCodexAuthLinkRequest
  | SubmitCodexLoginEmailRequest
  | SubmitCodexLoginPasswordRequest
  | FetchAndSubmitCodexVerificationCodeRequest
  | CompleteCodexLoginEmailAuthFlowRequest
  | ConfirmCodexOAuthConsentRequest
  | SubmitCodexOAuthCallbackRequest
  | ConfirmCodexOAuthCallbackRequest

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
 * 步骤 1：点击目标页面里的“开始codex登录”按钮，并打开 OpenAI 登录页。
 */
export type OpenCodexAuthLinkResponse = CodexLoginStepResponseBase

export type CodexAuthFlowState =
  | "oauth_consent_ready"
  | "verification_invalid_code"
  | "verification_pending"
  | "password"
  | "extra_verification"
  | "callback"
  | "other"

/**
 * 步骤 2/3 的响应：除了页面信息，还会告诉侧边栏当前认证流走到了哪里。
 */
export type CodexAuthProgressStepResponse = CodexLoginStepResponseBase & {
  authState?: CodexAuthFlowState
  verificationRequestedAt?: number
  skipped?: boolean
}

/**
 * 步骤 2：在 OpenAI 登录页填写邮箱，读取 2925 验证码并回填。
 *
 * mailTab 表示读取验证码时用到的 2925 邮箱页面。
 */
export type CompleteCodexLoginEmailAuthFlowResponse =
  CodexLoginStepResponseBase & {
    mailTab?: BrowserTabInfo
  }

/**
 * 内部步骤：在 OpenAI 登录页填写邮箱并继续。
 */
export type SubmitCodexLoginEmailResponse = CodexLoginStepResponseBase

/**
 * 内部步骤：读取 2925 验证码并回填到邮箱验证码页。
 *
 * mailTab 表示读取验证码时用到的 2925 邮箱页面。
 */
export type FetchAndSubmitCodexVerificationCodeResponse =
  CodexLoginStepResponseBase & {
    mailTab?: BrowserTabInfo
  }

/**
 * 步骤 5：确认 OAuth 授权并捕获回调 URL。
 */
export type ConfirmCodexOAuthConsentResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
}

/**
 * 步骤 6：提交回调 URL 到 CPA 管理页。
 */
export type SubmitCodexOAuthCallbackResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
  managementTab?: BrowserTabInfo
}

/**
 * 兼容旧入口：确认 OAuth 授权并提交回调 URL。
 *
 * managementTab 表示被回填 callback URL 的 Codex 管理页。
 */
export type ConfirmCodexOAuthCallbackResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
  managementTab?: BrowserTabInfo
}

/**
 * 所有后台请求处理器统一返回的响应类型。
 */
export type BackgroundResponse =
  | OpenCodexAuthLinkResponse
  | CodexAuthProgressStepResponse
  | FetchAndSubmitCodexVerificationCodeResponse
  | CompleteCodexLoginEmailAuthFlowResponse
  | ConfirmCodexOAuthConsentResponse
  | SubmitCodexOAuthCallbackResponse
  | ConfirmCodexOAuthCallbackResponse

/**
 * 注入目标网页后，执行页面动作的结果。
 */
export type PageActionResult = {
  ok: boolean
  message: string
  buttonText?: string
}

/**
 * 从所有请求中提取 type 字段，得到所有可处理的请求类型字符串。
 */
export type BackgroundRequestType = BackgroundRequest["type"]

/**
 * 后台请求处理函数的统一格式。
 *
 * TRequest 必须是 BackgroundRequest 里的某一种请求。
 * 函数接收这条请求，并异步返回统一的后台响应。
 */
export type BackgroundRequestHandler<TRequest extends BackgroundRequest> = (
  request: TRequest
) => Promise<BackgroundResponse>
