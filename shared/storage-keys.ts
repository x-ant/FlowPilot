/**
 * FlowPilot 使用的 chrome.storage.local key 集合。
 *
 * 这些字符串属于本地数据兼容协议。调整名称前必须提供旧 key 迁移逻辑，
 * 不能只修改常量值，否则会导致已有账号和配置看起来丢失。
 */
export const STORAGE_KEYS = {
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
} as const

export const ACTIVE_PAGE_STORAGE_KEY = STORAGE_KEYS.activePage
export const EXECUTION_LOG_STORAGE_KEY = STORAGE_KEYS.executionLogs
export const RUNTIME_SETTINGS_STORAGE_KEY = STORAGE_KEYS.runtimeSettings

export const LOGIN_STORAGE_KEYS = {
  cpaUrl: STORAGE_KEYS.login.cpaUrl,
  cpaManagementKey: STORAGE_KEYS.login.cpaManagementKey,
  accounts: STORAGE_KEYS.login.accounts
}
export const LOGIN_ACCOUNT_FORM_DRAFT_STORAGE_KEY =
  STORAGE_KEYS.login.accountFormDraft

export const REGISTER_STORAGE_KEYS = {
  cpaUrl: STORAGE_KEYS.register.cpaUrl,
  cpaManagementKey: STORAGE_KEYS.register.cpaManagementKey,
  accounts: STORAGE_KEYS.register.accounts
}
export const REGISTER_ACCOUNT_FORM_DRAFT_STORAGE_KEY =
  STORAGE_KEYS.register.accountFormDraft
export const REGISTER_ALARM_STORAGE_KEY = STORAGE_KEYS.register.alarmConfig
export const REGISTER_RUN_LOCK_STORAGE_KEY = STORAGE_KEYS.register.runLock
export const REGISTER_HERO_SMS_STORAGE_KEY =
  STORAGE_KEYS.register.heroSmsSettings
export const REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY =
  STORAGE_KEYS.register.heroSmsCountriesCache
export const REGISTER_HERO_SMS_OPERATORS_CACHE_KEY =
  STORAGE_KEYS.register.heroSmsOperatorsCache

export const OAUTH_TARGET_STORAGE_KEYS = {
  login: STORAGE_KEYS.login.oauthTarget,
  register: STORAGE_KEYS.register.oauthTarget
}
