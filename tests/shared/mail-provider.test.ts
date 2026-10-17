import { describe, expect, it } from "vitest"

import {
  getMailProviderDefinition,
  isMailProvider,
  MAIL_PROVIDER_OPTIONS
} from "../../shared/mail-provider"

describe("mail provider definitions", () => {
  it("为前端提供统一的邮箱选项和登录能力", () => {
    expect(MAIL_PROVIDER_OPTIONS).toEqual([
      { label: "163 邮箱", value: "163" },
      { label: "2925 邮箱 (已被限制)", value: "2925" }
    ])
    expect(getMailProviderDefinition("2925")).toMatchObject({
      loginUrl: "https://2925.com/#/mailList"
    })
    expect(getMailProviderDefinition("163")).toMatchObject({
      loginUrl: "https://mail.163.com/"
    })
  })

  it("只接受注册表中存在的邮箱服务", () => {
    expect(isMailProvider("2925")).toBe(true)
    expect(isMailProvider("163")).toBe(true)
    expect(isMailProvider("unknown")).toBe(false)
  })
})
