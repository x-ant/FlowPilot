export type RegisterDebugStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type RegisterDebugStepAvailability = {
  disabled: boolean
  hasSelectedAccount: boolean
  hasOAuthConfig: boolean
  canSubmitCallback: boolean
}

export const REGISTER_DEBUG_STEP_ITEMS: Array<{
  step: RegisterDebugStep
  label: string
}> = [
  { step: 1, label: "1 打开 GPT 页面" },
  { step: 2, label: "2 点击注册并提交邮箱" },
  { step: 3, label: "3 提交验证码" },
  { step: 4, label: "4 填写名称年龄并继续" },
  { step: 5, label: "5 完成 OAuth 登录" },
  { step: 6, label: "6 手机号验证" },
  { step: 7, label: "7 提交 OAuth callback" }
]

/** 按原注册调试规则判断某一步按钮是否应禁用。 */
export const isRegisterDebugStepDisabled = (
  step: RegisterDebugStep,
  availability: RegisterDebugStepAvailability
) => {
  if (availability.disabled) {
    return true
  }

  if (step === 1) {
    return false
  }

  if (step === 5) {
    return !availability.hasSelectedAccount || !availability.hasOAuthConfig
  }

  if (step === 7) {
    return !availability.canSubmitCallback
  }

  return !availability.hasSelectedAccount
}
