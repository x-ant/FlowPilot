import { readLocalStorage, writeLocalStorage } from "../platform/chrome/storage"
import { OAUTH_TARGET_STORAGE_KEYS } from "./storage-keys"

export type OAuthSource = "cpa" | "sub2api"

export type Sub2ApiConfig = {
  url: string
  email: string
  password: string
  groupName: string
  proxyId: number | null
}

export type OAuthIntegrationConfig =
  | {
      source: "cpa"
      cpaUrl: string
      cpaManagementKey: string
    }
  | {
      source: "sub2api"
      sub2api: Sub2ApiConfig
    }

export type OAuthBinding =
  | {
      source: "cpa"
      oauthState: string
    }
  | {
      source: "sub2api"
      sessionId: string
      oauthState: string
      groupId: number
      proxyId?: number
    }

export type OAuthTargetSettings = {
  source: OAuthSource
  sub2api: Sub2ApiConfig
}

export const DEFAULT_SUB2API_CONFIG: Sub2ApiConfig = {
  url: "",
  email: "",
  password: "",
  groupName: "codex",
  proxyId: null
}

/**
 * 规范化本地存储中的 OAuth 接入设置。
 *
 * @param value 从 chrome.storage.local 读取的原始值。
 * @return 可直接用于页面展示和流程判断的设置。
 */
export const normalizeOAuthTargetSettings = (
  value: unknown
): OAuthTargetSettings => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<OAuthTargetSettings>)
      : {}
  const sub2api =
    source.sub2api && typeof source.sub2api === "object"
      ? source.sub2api
      : DEFAULT_SUB2API_CONFIG

  return {
    source: source.source === "cpa" ? "cpa" : "sub2api",
    sub2api: {
      url: String(sub2api.url || "").trim(),
      email: String(sub2api.email || "").trim(),
      password: String(sub2api.password || ""),
      groupName: String(sub2api.groupName || "codex").trim() || "codex",
      proxyId: (() => {
        const proxyId = Number(sub2api.proxyId)
        return Number.isSafeInteger(proxyId) && proxyId > 0 ? proxyId : null
      })()
    }
  }
}

/**
 * 组合当前页面实际使用的 OAuth 接入参数。
 *
 * @param settings 当前选择的来源和 Sub2API 配置。
 * @param cpaUrl 当前页面保存的 CPA 地址。
 * @param cpaManagementKey 当前页面保存的 CPA 管理密钥。
 * @return 带来源判别字段的 OAuth 接入参数。
 */
export const createOAuthIntegrationConfig = (
  settings: OAuthTargetSettings,
  cpaUrl: string,
  cpaManagementKey: string
): OAuthIntegrationConfig => {
  if (settings.source === "sub2api") {
    return {
      source: "sub2api",
      sub2api: normalizeOAuthTargetSettings(settings).sub2api
    }
  }

  return {
    source: "cpa",
    cpaUrl: String(cpaUrl || "").trim(),
    cpaManagementKey: String(cpaManagementKey || "").trim()
  }
}

/**
 * 判断当前来源是否已经具备发起 OAuth 的必要配置。
 *
 * @param config 当前页面组合出的接入参数。
 * @return 必填项完整时返回 true。
 */
export const hasRequiredOAuthIntegrationConfig = (
  config: OAuthIntegrationConfig
) => {
  return config.source === "cpa"
    ? Boolean(config.cpaUrl && config.cpaManagementKey)
    : Boolean(
        config.sub2api.url &&
          config.sub2api.email &&
          config.sub2api.password &&
          config.sub2api.groupName
      )
}

/**
 * 读取指定页面的 OAuth 来源设置。
 *
 * @param scope 登录页或注册页。
 * @return 已规范化的 OAuth 来源设置。
 */
export const loadOAuthTargetSettings = async (
  scope: keyof typeof OAUTH_TARGET_STORAGE_KEYS
): Promise<OAuthTargetSettings> => {
  const storageKey = OAUTH_TARGET_STORAGE_KEYS[scope]
  const result = await readLocalStorage([storageKey])
  return normalizeOAuthTargetSettings(result[storageKey])
}

/**
 * 保存指定页面的 OAuth 来源设置。
 *
 * @param scope 登录页或注册页。
 * @param settings 要保存的来源和 Sub2API 配置。
 * @return 存储完成后 resolve。
 */
export const saveOAuthTargetSettings = async (
  scope: keyof typeof OAUTH_TARGET_STORAGE_KEYS,
  settings: OAuthTargetSettings
) => {
  const storageKey = OAUTH_TARGET_STORAGE_KEYS[scope]
  await writeLocalStorage({
    [storageKey]: normalizeOAuthTargetSettings(settings)
  })
}
