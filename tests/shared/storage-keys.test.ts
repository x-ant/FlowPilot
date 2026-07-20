import { describe, expect, it } from "vitest"

import { STORAGE_KEYS } from "../../shared/storage-keys"

describe("STORAGE_KEYS", () => {
  it("保持已有账号和运行配置 key 不变", () => {
    expect(STORAGE_KEYS).toEqual({
      activePage: "flowpilot:active-page",
      executionLogs: "flowpilot:execution-logs",
      runtimeSettings: "flowpilot:runtime-settings",
      login: {
        cpaUrl: "flowpilot:login:cpa-url",
        cpaManagementKey: "flowpilot:login:cpa-management-key",
        accounts: "flowpilot:login:accounts",
        accountFormDraft: "flowpilot:login:account-form-draft",
        oauthTarget: "flowpilot:login:oauth-target"
      },
      register: {
        cpaUrl: "flowpilot:register:cpa-url",
        cpaManagementKey: "flowpilot:register:cpa-management-key",
        accounts: "flowpilot:register:accounts",
        accountFormDraft: "flowpilot:register:account-form-draft",
        oauthTarget: "flowpilot:register:oauth-target",
        alarmConfig: "flowpilot:register:alarm-config",
        runLock: "flowpilot:register:run-lock",
        heroSmsSettings: "flowpilot:register:hero-sms-settings",
        heroSmsCountriesCache: "flowpilot:register:hero-sms-countries-cache",
        heroSmsOperatorsCache: "flowpilot:register:hero-sms-operators-cache"
      }
    })
  })
})
