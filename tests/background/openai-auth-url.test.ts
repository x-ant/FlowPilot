import { describe, expect, it } from "vitest"

import {
  getOpenAiAuthUrlState,
  isCodexOAuthCallbackUrl
} from "../../background/utils/openai-auth-url"

describe("getOpenAiAuthUrlState", () => {
  it.each([
    ["https://auth.openai.com/log-in", "login_email_entry"],
    ["https://auth.openai.com/log-in/password", "login_password"],
    ["https://auth.openai.com/create-account/password", "register_password"],
    ["https://auth.openai.com/email-verification", "email_verification"],
    ["https://auth.openai.com/about-you", "register_profile"],
    ["https://auth.openai.com/choose-an-account", "oauth_account_choice"],
    ["https://auth.openai.com/add-phone", "phone_number_entry"],
    ["https://auth.openai.com/phone-verification", "phone_verification"],
    [
      "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
      "oauth_consent"
    ]
  ] as const)("识别 %s", (url, expectedState) => {
    expect(getOpenAiAuthUrlState(url)).toBe(expectedState)
  })

  it("拒绝相同路径下的非 OpenAI 域名", () => {
    expect(getOpenAiAuthUrlState("https://example.com/add-phone")).toBe("other")
  })
})

describe("isCodexOAuthCallbackUrl", () => {
  it("接受包含 code 和 state 的本机回调", () => {
    const callbackUrl =
      "http://localhost:1455/auth/callback?code=placeholder&state=placeholder"

    expect(isCodexOAuthCallbackUrl(callbackUrl)).toBe(true)
    expect(getOpenAiAuthUrlState(callbackUrl)).toBe("oauth_callback")
  })

  it("拒绝缺少 state 的本机回调", () => {
    expect(
      isCodexOAuthCallbackUrl(
        "http://localhost:1455/auth/callback?code=placeholder"
      )
    ).toBe(false)
  })
})
