import { Collapse, Form, Input, Select, Tag } from "antd"
import { useMemo, useState } from "react"

import {
  listSub2ApiOAuthOptions,
  type Sub2ApiOAuthOptions
} from "../../background/integrations/sub2api-api"
import type { OAuthTargetConfigState } from "./useOAuthTargetConfig"

type OAuthConfigPanelProps = {
  target: OAuthTargetConfigState
  cpaUrl: string
  cpaManagementKey: string
  disabled: boolean
  onCpaConfigChange: (cpaUrl: string, cpaManagementKey: string) => void
}

/**
 * 展示 CPA 与 Sub2API 共用的 OAuth 来源配置。
 *
 * @param props OAuth 来源状态、CPA 配置和修改回调。
 * @return 当前来源对应的最小配置表单。
 */
export function OAuthConfigPanel({
  target,
  cpaUrl,
  cpaManagementKey,
  disabled,
  onCpaConfigChange
}: OAuthConfigPanelProps) {
  const { settings, patchSettings } = target
  const [oauthOptions, setOAuthOptions] = useState<Sub2ApiOAuthOptions>({
    groups: [],
    proxies: []
  })
  const [isOptionsLoading, setIsOptionsLoading] = useState(false)
  const [optionsLoadError, setOptionsLoadError] = useState("")
  const selectedGroupName = settings.sub2api.groupName
  const selectedProxyId = settings.sub2api.proxyId
  const groupSelectOptions = oauthOptions.groups.map((group) => ({
    label: `${group.name} #${group.id}`,
    value: group.name
  }))
  const proxySelectOptions = useMemo(() => {
    const options = oauthOptions.proxies.map((proxy) => ({
      label: proxy.label,
      value: String(proxy.id)
    }))
    if (
      selectedProxyId &&
      !oauthOptions.proxies.some((proxy) => proxy.id === selectedProxyId)
    ) {
      options.unshift({
        label: `已选择代理 #${selectedProxyId}`,
        value: String(selectedProxyId)
      })
    }
    return [{ label: "不使用代理", value: "" }, ...options]
  }, [oauthOptions.proxies, selectedProxyId])

  /**
   * 登录 Sub2API 并刷新 OpenAI 分组和已启用代理列表。
   *
   * @return 加载完成后 resolve；错误会显示在两个下拉字段下方。
   */
  const loadOAuthOptions = async () => {
    if (isOptionsLoading) {
      return
    }
    if (
      !settings.sub2api.url ||
      !settings.sub2api.email ||
      !settings.sub2api.password
    ) {
      setOptionsLoadError("请先填写 Sub2API 地址、登录邮箱和密码")
      return
    }

    setIsOptionsLoading(true)
    setOptionsLoadError("")
    try {
      setOAuthOptions(await listSub2ApiOAuthOptions(settings.sub2api))
    } catch (error) {
      setOptionsLoadError(
        error instanceof Error ? error.message : "加载 Sub2API 配置选项失败"
      )
    } finally {
      setIsOptionsLoading(false)
    }
  }

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "oauth-target",
          label: "OAuth 接入",
          extra: (
            <Tag
              color={settings.source === "sub2api" ? "processing" : "default"}>
              {settings.source === "sub2api" ? "Sub2API" : "CPA"}
            </Tag>
          ),
          children: (
            <Form layout="vertical" requiredMark={false}>
              <Form.Item label="OAuth 接入来源">
                <Select
                  style={{ width: "100%" }}
                  value={settings.source}
                  options={[
                    { label: "Sub2API", value: "sub2api" },
                    { label: "CPA", value: "cpa" }
                  ]}
                  onChange={(source) => {
                    patchSettings({
                      source: source === "sub2api" ? "sub2api" : "cpa"
                    })
                  }}
                  disabled={disabled}
                />
              </Form.Item>

              {settings.source === "cpa" ? (
                <>
                  <Form.Item label="CPA 地址">
                    <Input
                      value={cpaUrl}
                      placeholder="https://..."
                      allowClear
                      onChange={(event) => {
                        onCpaConfigChange(event.target.value, cpaManagementKey)
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                  <Form.Item label="CPA 管理密钥">
                    <Input.Password
                      value={cpaManagementKey}
                      placeholder="用于 CPA 管理接口"
                      allowClear
                      onChange={(event) => {
                        onCpaConfigChange(cpaUrl, event.target.value)
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item label="Sub2API 地址">
                    <Input
                      value={settings.sub2api.url}
                      placeholder="https://your-sub2api-domain"
                      allowClear
                      onChange={(event) => {
                        patchSettings({ sub2api: { url: event.target.value } })
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                  <Form.Item label="Sub2API 登录邮箱">
                    <Input
                      value={settings.sub2api.email}
                      placeholder="管理员邮箱"
                      allowClear
                      onChange={(event) => {
                        patchSettings({
                          sub2api: { email: event.target.value }
                        })
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                  <Form.Item label="Sub2API 登录密码">
                    <Input.Password
                      value={settings.sub2api.password}
                      placeholder="管理员密码"
                      allowClear
                      onChange={(event) => {
                        patchSettings({
                          sub2api: { password: event.target.value }
                        })
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                  <Form.Item
                    label="目标分组"
                    help={optionsLoadError || "仅展示 OpenAI 平台分组"}
                    validateStatus={optionsLoadError ? "error" : undefined}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={selectedGroupName}
                      options={groupSelectOptions}
                      loading={isOptionsLoading}
                      onOpenChange={(open) => {
                        if (open) {
                          void loadOAuthOptions()
                        }
                      }}
                      onChange={(groupName) => {
                        patchSettings({
                          sub2api: { groupName }
                        })
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                  <Form.Item
                    label="代理"
                    help={optionsLoadError || "仅展示 Sub2API 已启用代理"}
                    validateStatus={optionsLoadError ? "error" : undefined}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={selectedProxyId ? String(selectedProxyId) : ""}
                      options={proxySelectOptions}
                      loading={isOptionsLoading}
                      onOpenChange={(open) => {
                        if (open) {
                          void loadOAuthOptions()
                        }
                      }}
                      onChange={(value) => {
                        const proxyId = Number(value)
                        patchSettings({
                          sub2api: {
                            proxyId:
                              Number.isSafeInteger(proxyId) && proxyId > 0
                                ? proxyId
                                : null
                          }
                        })
                      }}
                      disabled={disabled}
                    />
                  </Form.Item>
                </>
              )}
            </Form>
          )
        }
      ]}
    />
  )
}
