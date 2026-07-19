import {
  getManagedAccountLabel,
  type ManagedAccount
} from "../../shared/account-state"
import type { BrowserTabInfo } from "../types"
import type { RunContext } from "../utils/run-context"
import { createMail163Runner } from "./mail-163"
import { createMail2925Runner } from "./mail-2925"

export type VerificationCodeResult = {
  code: string
  message: string
  mailTab?: BrowserTabInfo
}

export type FetchVerificationCodeOptions = {
  verificationRequestedAt?: number
  excludeCodes?: string[]
}

/**
 * 创建统一邮箱验证码读取 runner。
 *
 * 业务步骤只需要传账号配置；runner 会根据账号的邮箱服务分发到
 * 2925 或 163 的具体实现。
 *
 * @param context 当前运行上下文，用于响应停止信号。
 * @return 统一验证码读取方法。
 */
export const createMailVerificationRunner = (context: RunContext = {}) => {
  const { fetchMail2925VerificationCode } = createMail2925Runner(context)
  const { fetchMail163VerificationCode } = createMail163Runner(context)

  /**
   * 按账号邮箱服务读取 OpenAI/ChatGPT 验证码。
   *
   * @param account 当前执行账号，包含邮箱服务和注册邮箱。
   * @param options 验证码读取选项。
   * @param options.verificationRequestedAt 触发验证码发送的时间，用于跳过旧邮件。
   * @param options.excludeCodes 已被页面拒绝的验证码，重试时会跳过。
   * @return 验证码读取结果；成功时包含 `code`。
   */
  const fetchVerificationCode = async (
    account: ManagedAccount,
    options: FetchVerificationCodeOptions = {}
  ): Promise<VerificationCodeResult> => {
    const targetEmail = getManagedAccountLabel(account)
    if (!targetEmail) {
      return {
        code: "",
        message: "缺少注册邮箱，无法匹配验证码邮件"
      }
    }

    if (account.mailProvider === "163") {
      return fetchMail163VerificationCode({
        targetEmail,
        verificationRequestedAt: options.verificationRequestedAt,
        excludeCodes: options.excludeCodes
      })
    }

    return fetchMail2925VerificationCode(account.mailboxEmail || targetEmail, {
      verificationRequestedAt: options.verificationRequestedAt,
      excludeCodes: options.excludeCodes
    })
  }

  return {
    fetchVerificationCode
  }
}
