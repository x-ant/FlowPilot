import type { OAuthBinding } from "./oauth-integration"

/** 浏览器标签页的最小跨模块信息。 */
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

/** 登录步骤 1：获取并打开 OpenAI 授权页。 */
export type OpenCodexAuthLinkResponse = CodexLoginStepResponseBase
export type OpenCodexAuthLinkApiResponse = OpenCodexAuthLinkResponse & {
  oauthBinding?: OAuthBinding
}

/** OpenAI 认证流程当前可继续处理的状态。 */
export type CodexAuthFlowState =
  | "oauth_consent_ready"
  | "verification_invalid_code"
  | "account_unavailable"
  | "verification_pending"
  | "register_profile"
  | "password"
  | "extra_verification"
  | "callback"
  | "other"

/** 登录步骤 2/3 的响应，包含当前认证流状态。 */
export type CodexAuthProgressStepResponse = CodexLoginStepResponseBase & {
  accountInvalid?: boolean
  authState?: CodexAuthFlowState
  verificationRequestedAt?: number
  skipped?: boolean
}

/** 读取邮箱验证码并回填到验证码页的响应。 */
export type FetchAndSubmitCodexVerificationCodeResponse =
  CodexLoginStepResponseBase & {
    accountInvalid?: boolean
    mailTab?: BrowserTabInfo
  }

/** 登录步骤 5：确认 OAuth 授权并捕获回调 URL。 */
export type ConfirmCodexOAuthConsentResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
}

/** 登录步骤 6：向当前 OAuth 接入来源提交回调 URL。 */
export type SubmitCodexOAuthCallbackResponse = CodexLoginStepResponseBase & {
  callbackUrl?: string
  oauthBinding?: OAuthBinding
  verifiedStatus?: string
  managementTab?: BrowserTabInfo
}

/** 注册流程各步骤共用的响应。 */
export type CodexRegisterStepResponse = {
  ok: boolean
  message: string
  needRefreshOAuth?: boolean
  needsManualReview?: boolean
  accountInvalid?: boolean
  verificationRequestedAt?: number
  oauthStartedAt?: number
  oauthBinding?: OAuthBinding
  callbackUrl?: string
  targetTab?: BrowserTabInfo
}

/** 注入目标网页后执行页面动作的结果。 */
export type PageActionResult = {
  ok: boolean
  message: string
  buttonText?: string
}
