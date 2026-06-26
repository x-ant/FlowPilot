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
 * 注入目标网页后，执行页面动作的结果。
 */
export type PageActionResult = {
  ok: boolean
  message: string
  buttonText?: string
}
