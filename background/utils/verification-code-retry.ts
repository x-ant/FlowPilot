type VerificationCodeRetryMailResult = {
  code: string
  message: string
}

type VerificationCodeRetrySubmitResult<TResult> = {
  result: TResult
  invalidCode: boolean
  attemptMessage?: string
}

type VerificationCodeRetryOptions<TMailResult, TResult> = {
  maxAttempts?: number
  fetchCode: (excludeCodes: string[]) => Promise<TMailResult>
  submitCode: (
    mailResult: TMailResult
  ) => Promise<VerificationCodeRetrySubmitResult<TResult>>
  buildNoCodeResult: (
    mailResult: TMailResult,
    attemptMessages: string[]
  ) => TResult
  buildFallbackResult: (attemptMessages: string[]) => TResult
}

/**
 * 复用邮箱验证码“错误后排除旧码再读一次”的重试壳子。
 *
 * 具体邮箱读取、页面填写和返回值结构由调用方处理；这里只维护
 * `excludeCodes`、尝试次数，以及 OpenAI 判定验证码错误后的继续条件。
 *
 * @param options 验证码重试配置。
 * @param options.maxAttempts 最大尝试次数，默认 2 次。
 * @param options.fetchCode 读取邮箱验证码，参数是已被页面拒绝的验证码列表。
 * @param options.submitCode 填写并提交验证码，返回是否被页面判定为验证码错误。
 * @param options.buildNoCodeResult 邮箱未读到验证码时构造调用方结果。
 * @param options.buildFallbackResult 理论兜底结果，正常情况下不会走到。
 * @return 调用方自定义的步骤执行结果。
 */
export const retryVerificationCodeOnInvalidCode = async <
  TMailResult extends VerificationCodeRetryMailResult,
  TResult
>(
  options: VerificationCodeRetryOptions<TMailResult, TResult>
): Promise<TResult> => {
  const maxAttempts = Math.max(1, options.maxAttempts || 2)
  const excludedCodes: string[] = []
  const attemptMessages: string[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const mailResult = await options.fetchCode(excludedCodes)
    if (!mailResult.code) {
      return options.buildNoCodeResult(mailResult, attemptMessages)
    }

    const submitResult = await options.submitCode(mailResult)
    if (submitResult.invalidCode) {
      excludedCodes.push(mailResult.code)
      if (submitResult.attemptMessage) {
        attemptMessages.push(
          `${submitResult.attemptMessage}；已排除本次验证码并准备重新读取`
        )
      }

      if (attempt < maxAttempts) {
        continue
      }
    }

    return submitResult.result
  }

  return options.buildFallbackResult(attemptMessages)
}
