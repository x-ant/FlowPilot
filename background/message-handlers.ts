import {
  confirmCodexOAuthAndSubmitCallback,
  fillCodexLoginEmailAndVerificationCode,
  openCodexAuthLink
} from "./codex-login"
import type {
  BackgroundRequest,
  BackgroundRequestHandler,
  BackgroundRequestType,
  ConfirmCodexOAuthCallbackRequest,
  FillCodexLoginEmailAndVerificationCodeRequest,
  OpenCodexAuthLinkRequest
} from "./types"

/**
 * 后台请求处理器映射表的类型。
 *
 * [Type in BackgroundRequestType] 会遍历所有请求 type，要求每个 type 都有一个 handler。
 * Extract<BackgroundRequest, { type: Type }> 会从请求联合类型里取出当前 type 对应的请求结构。
 * 从联合类型 BackgroundRequest 抽取出匹配 { type: Type } 的类型。
 *
 * 例如 Type 是 "codex-login:open-auth-link" 时，handler 的 request 参数就是 OpenCodexAuthLinkRequest。
 */
type BackgroundRequestHandlerMap = {
  [Type in BackgroundRequestType]: BackgroundRequestHandler<
    Extract<BackgroundRequest, { type: Type }>
  >
}

/**
 * 处理“打开授权链接”请求。
 *
 * @param request 步骤 1 请求，包含登录地址。
 * @return 步骤执行结果。
 */
const handleOpenCodexAuthLink = (request: OpenCodexAuthLinkRequest) => {
  return openCodexAuthLink(request.payload.targetUrl)
}

/**
 * 处理“填写邮箱并回填验证码”请求。
 *
 * @param request 步骤 2 请求，包含登录页标签页 id、邮箱和密码。
 * @return 步骤执行结果。
 */
const handleFillCodexLoginEmailAndVerificationCode = (
  request: FillCodexLoginEmailAndVerificationCodeRequest
) => {
  return fillCodexLoginEmailAndVerificationCode(
    request.payload.tabId,
    request.payload.email,
    request.payload.password
  )
}

/**
 * 处理“确认 OAuth 并提交回调 URL”请求。
 *
 * @param request 步骤 3 请求，包含授权页 tabId 和管理页地址。
 * @return 步骤执行结果。
 */
const handleConfirmCodexOAuthCallback = (
  request: ConfirmCodexOAuthCallbackRequest
) => {
  return confirmCodexOAuthAndSubmitCallback(
    request.payload.tabId,
    request.payload.targetUrl
  )
}

/**
 * 后台请求处理器映射表。
 *
 * 后续新增步骤时，在 types.ts 增加请求类型，然后在这里补一个 handler。
 *
 * @return 后台请求与处理函数的映射表。
 */
export const REQUEST_HANDLERS: BackgroundRequestHandlerMap = {
  "codex-login:open-auth-link": handleOpenCodexAuthLink,
  "codex-login:fill-auth-email-and-code": handleFillCodexLoginEmailAndVerificationCode,
  "codex-login:confirm-oauth-callback": handleConfirmCodexOAuthCallback
}
