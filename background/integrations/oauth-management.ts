import type { OAuthBinding, OAuthIntegrationConfig } from "../../shared/oauth-integration"
import {
  requestCpaOAuthUrl,
  submitCpaOAuthCallback
} from "./cpa-management-api"
import {
  requestSub2ApiOAuthUrl,
  submitSub2ApiOAuthCallback
} from "./sub2api-api"

/**
 * 按当前来源获取 OpenAI OAuth URL。
 *
 * @param config CPA 或 Sub2API 接入参数。
 * @return OAuth URL 和提交 callback 时必须携带的来源绑定信息。
 */
export const requestManagedOAuthUrl = async (
  config: OAuthIntegrationConfig
) => {
  if (config.source === "sub2api") {
    return requestSub2ApiOAuthUrl(config.sub2api)
  }

  const result = await requestCpaOAuthUrl(
    config.cpaUrl,
    config.cpaManagementKey
  )
  return {
    oauthUrl: result.oauthUrl,
    binding: {
      source: "cpa",
      oauthState: result.oauthState
    } satisfies OAuthBinding
  }
}

/**
 * 按生成 OAuth URL 时的来源提交 callback。
 *
 * @param config CPA 或 Sub2API 接入参数。
 * @param binding 生成 OAuth URL 时保存的来源绑定信息。
 * @param callbackUrl OpenAI 返回的 localhost callback。
 * @param accountEmail 当前流程账号邮箱，Sub2API 创建账号时用于名称兜底。
 * @return 统一的 callback 提交结果。
 */
export const submitManagedOAuthCallback = async (
  config: OAuthIntegrationConfig,
  binding: OAuthBinding,
  callbackUrl: string,
  accountEmail = ""
) => {
  if (config.source !== binding.source) {
    throw new Error("OAuth 来源与当前授权会话不一致，请重新获取 OAuth URL")
  }
  if (config.source === "sub2api" && binding.source === "sub2api") {
    return submitSub2ApiOAuthCallback(
      config.sub2api,
      binding,
      callbackUrl,
      accountEmail
    )
  }
  if (config.source === "cpa" && binding.source === "cpa") {
    return submitCpaOAuthCallback(
      config.cpaUrl,
      config.cpaManagementKey,
      callbackUrl,
      binding.oauthState
    )
  }

  throw new Error("无法识别当前 OAuth 接入来源")
}
