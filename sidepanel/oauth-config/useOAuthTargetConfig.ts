import { useEffect, useState } from "react"

import {
  DEFAULT_SUB2API_CONFIG,
  loadOAuthTargetSettings,
  saveOAuthTargetSettings,
  type OAuthTargetSettings,
  type Sub2ApiConfig
} from "../../shared/oauth-integration"

/**
 * 管理登录页或注册页各自的 OAuth 来源设置。
 *
 * @param scope 当前配置所属的登录页或注册页。
 * @return 当前设置和持久化修改方法。
 */
export const useOAuthTargetConfig = (scope: "login" | "register") => {
  const [settings, setSettings] = useState<OAuthTargetSettings>({
    source: "sub2api",
    sub2api: DEFAULT_SUB2API_CONFIG
  })

  useEffect(() => {
    void loadOAuthTargetSettings(scope).then(setSettings)
  }, [scope])

  /**
   * 修改来源或 Sub2API 配置，并立即保存到 chrome.storage.local。
   *
   * @param patch 要合并到当前设置的字段。
   */
  const patchSettings = (
    patch: Partial<Omit<OAuthTargetSettings, "sub2api">> & {
      sub2api?: Partial<Sub2ApiConfig>
    }
  ) => {
    setSettings((current) => {
      const next: OAuthTargetSettings = {
        ...current,
        ...patch,
        sub2api: {
          ...current.sub2api,
          ...patch.sub2api
        }
      }
      void saveOAuthTargetSettings(scope, next)
      return next
    })
  }

  return { settings, patchSettings }
}

export type OAuthTargetConfigState = ReturnType<typeof useOAuthTargetConfig>
