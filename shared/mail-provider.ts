export const MAIL_PROVIDER_KEYS = ["2925", "163"] as const

export type MailProvider = (typeof MAIL_PROVIDER_KEYS)[number]

export type MailProviderDefinition = {
  label: string
  shortLabel: string
  loginUrl: string
}

/**
 * 邮箱服务的共享展示定义。
 *
 * 账号表单和展示逻辑统一读取这里，避免新增邮箱服务时
 * 在多个前端组件里重复添加服务名称和登录地址。
 */
export const MAIL_PROVIDER_DEFINITIONS = {
  "2925": {
    label: "2925 邮箱",
    shortLabel: "2925",
    loginUrl: "https://2925.com/#/mailList"
  },
  "163": {
    label: "163 邮箱",
    shortLabel: "163",
    loginUrl: "https://mail.163.com/"
  }
} satisfies Record<MailProvider, MailProviderDefinition>

export const DEFAULT_MAIL_PROVIDER: MailProvider = "2925"

export const MAIL_PROVIDER_OPTIONS = MAIL_PROVIDER_KEYS.map((mailProvider) => {
  return {
    label: MAIL_PROVIDER_DEFINITIONS[mailProvider].label,
    value: mailProvider
  }
})

/**
 * 判断外部值是否为当前支持的邮箱服务。
 *
 * @param value 表单或本地存储中的原始值。
 * @return 值存在于邮箱服务定义表时返回 true。
 */
export const isMailProvider = (value: unknown): value is MailProvider => {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MAIL_PROVIDER_DEFINITIONS, value)
  )
}

/**
 * 读取指定邮箱服务的共享展示定义。
 *
 * @param mailProvider 已规范化的邮箱服务。
 * @return 邮箱服务对应的名称和登录地址配置。
 */
export const getMailProviderDefinition = (mailProvider: MailProvider) => {
  return MAIL_PROVIDER_DEFINITIONS[mailProvider]
}
