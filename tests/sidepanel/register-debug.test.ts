import { describe, expect, it } from "vitest"

import {
  isRegisterDebugStepDisabled,
  REGISTER_DEBUG_STEP_ITEMS,
  type RegisterDebugStepAvailability
} from "../../sidepanel/register-debug/register-debug-steps"

const AVAILABLE: RegisterDebugStepAvailability = {
  disabled: false,
  hasSelectedAccount: true,
  hasOAuthConfig: true,
  canSubmitCallback: true
}

describe("register debug steps", () => {
  it("保持七个调试步骤的顺序", () => {
    expect(REGISTER_DEBUG_STEP_ITEMS.map((item) => item.step)).toEqual([
      1, 2, 3, 4, 5, 6, 7
    ])
  })

  it("页面忙碌时禁用全部步骤", () => {
    for (const { step } of REGISTER_DEBUG_STEP_ITEMS) {
      expect(
        isRegisterDebugStepDisabled(step, {
          ...AVAILABLE,
          disabled: true
        })
      ).toBe(true)
    }
  })

  it("Step 1 不要求账号，其余普通步骤要求已选择账号", () => {
    const withoutAccount = {
      ...AVAILABLE,
      hasSelectedAccount: false
    }

    expect(isRegisterDebugStepDisabled(1, withoutAccount)).toBe(false)
    expect(isRegisterDebugStepDisabled(2, withoutAccount)).toBe(true)
    expect(isRegisterDebugStepDisabled(6, withoutAccount)).toBe(true)
  })

  it("OAuth 和 callback 步骤保留各自额外条件", () => {
    expect(
      isRegisterDebugStepDisabled(5, {
        ...AVAILABLE,
        hasOAuthConfig: false
      })
    ).toBe(true)
    expect(
      isRegisterDebugStepDisabled(7, {
        ...AVAILABLE,
        canSubmitCallback: false
      })
    ).toBe(true)
    expect(isRegisterDebugStepDisabled(5, AVAILABLE)).toBe(false)
    expect(isRegisterDebugStepDisabled(7, AVAILABLE)).toBe(false)
  })
})
