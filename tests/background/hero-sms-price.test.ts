import { describe, expect, it } from "vitest"

import {
  assertHeroSmsActivationCostWithinExpected,
  type HeroSmsActivation
} from "../../background/register/phone-verification"

const createActivation = (
  overrides: Partial<HeroSmsActivation> = {}
): HeroSmsActivation => {
  return {
    activationId: "test-activation",
    phoneNumber: "test-phone",
    activationCost: 0.1,
    currency: 840,
    countryId: 1,
    countryLabel: "Test Country",
    countryCode: 1,
    countryPhoneCode: 1,
    canGetAnotherSms: false,
    activationTime: "2026-01-01T00:00:00Z",
    activationEndTime: "2026-01-01T00:20:00Z",
    activationOperator: "any",
    selectedPrice: 0.1,
    ...overrides
  }
}

describe("assertHeroSmsActivationCostWithinExpected", () => {
  it("接受不高于请求档位的实际成本", () => {
    expect(() => {
      assertHeroSmsActivationCostWithinExpected(createActivation())
    }).not.toThrow()
  })

  it("拒绝高于请求固定档位的实际成本", () => {
    expect(() => {
      assertHeroSmsActivationCostWithinExpected(
        createActivation({ activationCost: 0.11 })
      )
    }).toThrow("HeroSMS 实际成本 0.11 高于本次请求固定档位 0.1")
  })

  it("拒绝缺少请求价格档位", () => {
    expect(() => {
      assertHeroSmsActivationCostWithinExpected(
        createActivation({ selectedPrice: undefined })
      )
    }).toThrow("HeroSMS 请求价格档位缺失")
  })

  it("拒绝无效实际成本", () => {
    expect(() => {
      assertHeroSmsActivationCostWithinExpected(
        createActivation({ activationCost: -1 })
      )
    }).toThrow("HeroSMS 实际成本无效")
  })
})
