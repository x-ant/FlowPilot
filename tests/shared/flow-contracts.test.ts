import { describe, expect, expectTypeOf, it } from "vitest"

import type {
  CodexAuthProgressStepResponse,
  CodexLoginStepResponseBase,
  CodexRegisterStepResponse
} from "../../shared/flow-contracts"

describe("flow contracts", () => {
  it("登录步骤响应沿用公共结果和标签页结构", () => {
    const response: CodexAuthProgressStepResponse = {
      ok: true,
      message: "登录步骤完成",
      authState: "oauth_consent_ready",
      targetTab: {
        id: 12,
        url: "https://example.test/auth"
      }
    }

    expectTypeOf(response).toMatchTypeOf<CodexLoginStepResponseBase>()
    expect(response.targetTab?.id).toBe(12)
  })

  it("注册步骤响应包含页面继续执行所需的可选上下文", () => {
    const response: CodexRegisterStepResponse = {
      ok: false,
      message: "需要人工确认",
      needsManualReview: true,
      needRefreshOAuth: true,
      verificationRequestedAt: 100,
      oauthStartedAt: 200,
      callbackUrl: "http://localhost/callback",
      targetTab: {
        id: 15
      }
    }

    expect(response).toMatchObject({
      needsManualReview: true,
      needRefreshOAuth: true,
      targetTab: { id: 15 }
    })
  })
})
