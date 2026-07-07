import { Checkbox, Collapse, Input, Select } from "antd"

import type { HeroSmsConfigState } from "./useHeroSmsConfig"

type HeroSmsConfigPanelProps = {
  heroSms: Pick<
    HeroSmsConfigState,
    | "settings"
    | "countryOptions"
    | "operatorOptions"
    | "isCountriesLoading"
    | "isOperatorsLoading"
    | "patchSettings"
  >
  disabled: boolean
}

export function HeroSmsConfigPanel({
  heroSms,
  disabled
}: HeroSmsConfigPanelProps) {
  const {
    settings,
    countryOptions,
    operatorOptions,
    isCountriesLoading,
    isOperatorsLoading,
    patchSettings
  } = heroSms
  const isHeroSmsUnavailable = !settings.mockEnabled && !settings.apiKey.trim()

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "hero-sms",
          label: "接码配置",
          children: (
            <div className="debug-grid debug-grid--two">
              <div className="debug-field">
                <span className="debug-label">国家选项</span>
                <Select
                  value={
                    countryOptions.length
                      ? settings.countryId || undefined
                      : undefined
                  }
                  placeholder="填写 API 后加载"
                  showSearch
                  filterOption={(input, option) => {
                    const keyword = input.trim().toLowerCase()
                    const searchText = String(
                      option?.searchText || option?.label || option?.value || ""
                    ).toLowerCase()
                    return searchText.includes(keyword)
                  }}
                  loading={isCountriesLoading}
                  options={countryOptions}
                  onChange={(value) => {
                    patchSettings({
                      countryId: value,
                      operator: "any"
                    })
                  }}
                  disabled={
                    disabled ||
                    isHeroSmsUnavailable ||
                    countryOptions.length === 0
                  }
                />
              </div>
              <div className="debug-field">
                <span className="debug-label">运营商选项</span>
                <Select
                  value={
                    operatorOptions.length
                      ? settings.operator || undefined
                      : undefined
                  }
                  placeholder="选择国家后加载"
                  showSearch
                  loading={isOperatorsLoading}
                  options={operatorOptions}
                  onChange={(value) => {
                    patchSettings({ operator: value })
                  }}
                  disabled={
                    disabled ||
                    isHeroSmsUnavailable ||
                    settings.countryId === "" ||
                    operatorOptions.length === 0
                  }
                />
              </div>
              <div className="debug-field">
                <span className="debug-label">HeroSMS Mock</span>
                <Checkbox
                  checked={settings.mockEnabled}
                  onChange={(event) => {
                    patchSettings({
                      mockEnabled: event.target.checked,
                      operator: "any"
                    })
                  }}
                  disabled={disabled}>
                  不请求 HeroSMS
                </Checkbox>
              </div>
              <div className="debug-field">
                <span className="debug-label">接码 API</span>
                <Input.Password
                  value={settings.apiKey}
                  placeholder="HeroSMS API key"
                  allowClear
                  onChange={(event) => {
                    patchSettings({ apiKey: event.target.value })
                  }}
                  disabled={disabled || settings.mockEnabled}
                />
              </div>
              <div className="debug-field">
                <span className="debug-label">价格上限</span>
                <Input
                  value={settings.maxPrice}
                  placeholder="必填，例如 0.12"
                  allowClear
                  onChange={(event) => {
                    patchSettings({ maxPrice: event.target.value })
                  }}
                  disabled={disabled}
                />
              </div>
              <div className="debug-field">
                <span className="debug-label">固定价格档位</span>
                <Input
                  value={settings.fixedPrice}
                  placeholder="可选，例如 0.08"
                  allowClear
                  onChange={(event) => {
                    patchSettings({
                      fixedPrice: event.target.value
                    })
                  }}
                  disabled={disabled}
                />
              </div>
            </div>
          )
        }
      ]}
    />
  )
}
