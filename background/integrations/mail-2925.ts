import { pollMail2925VerificationCodeInPage } from "./mail-2925-page-code"
import type { BrowserTabInfo } from "../types"
import { raceWithAbort, throwIfAborted } from "../utils/abort"
import type { RunContext } from "../utils/run-context"
import { findOrOpenMatchedTab, waitForTabLoaded } from "../utils/tab-utils"

const MAIL2925_MAILBOX_URL = "https://2925.com/#/mailList"
const MAIL2925_HOSTNAMES = ["2925.com", "www.2925.com"]

export type Mail2925VerificationCodeResult = {
  code: string
  message: string
  mailTab?: BrowserTabInfo
}

export type FetchMail2925VerificationCodeOptions = {
  verificationRequestedAt?: number
  excludeCodes?: string[]
}

/**
 * 解析并校验 2925 邮箱页面 URL。
 *
 * @param rawUrl 标签页当前 URL。
 * @return URL 属于 2925 邮箱站点时返回解析后的 URL；否则返回 undefined。
 */
const getMail2925Url = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    if (!MAIL2925_HOSTNAMES.includes(url.hostname.toLowerCase())) {
      return undefined
    }

    return url
  } catch {
    return undefined
  }
}

/**
 * 判断标签页是否已经处于 2925 收件箱列表页。
 *
 * @param rawUrl 标签页当前 URL。
 * @return 已位于 2925 收件箱时返回 true。
 */
const isMail2925MailboxUrl = (rawUrl?: string) => {
  const url = getMail2925Url(rawUrl)
  if (!url) {
    return false
  }

  return url.hash === "#/mailList" || url.hash.startsWith("#/mailList?")
}

/**
 * 创建 2925 邮箱验证码读取 runner。
 *
 * runner 只负责打开或复用已登录的 2925 收件箱，不再自动填写账号密码登录。
 *
 * @param context 当前运行上下文，用于响应停止信号。
 * @return 2925 验证码读取方法。
 */
export const createMail2925Runner = (context: RunContext = {}) => {
  const getAbortSignal = () => context.abortSignal

  /**
   * 把 2925 标签页切到收件箱。
   *
   * @param tabId 2925 邮箱标签页 ID。
   * @return 页面导航完成后 resolve。
   */
  const navigateMail2925TabToMailbox = async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId)

    if (isMail2925MailboxUrl(tab.url)) {
      await chrome.tabs.update(tabId, { active: true })
      return
    }

    await chrome.tabs.update(tabId, {
      active: true,
      url: MAIL2925_MAILBOX_URL
    })
  }

  /**
   * 从已登录的 2925 收件箱读取 OpenAI/ChatGPT 验证码。
   *
   * @param email OpenAI 实际注册或登录邮箱，用于过滤当前账号邮件。
   * @param options 验证码读取配置。
   * @param options.verificationRequestedAt 触发验证码发送的时间，用于跳过旧邮件。
   * @param options.excludeCodes 已被页面拒绝的验证码，重试时会跳过。
   * @return 验证码读取结果；成功时包含 `code` 和 2925 邮箱 tab 信息。
   */
  const fetchMail2925VerificationCode = async (
    email: string,
    options: FetchMail2925VerificationCodeOptions = {}
  ): Promise<Mail2925VerificationCodeResult> => {
    throwIfAborted(getAbortSignal())

    const tabId = await findOrOpenMatchedTab({
      targetUrl: MAIL2925_MAILBOX_URL,
      errorMessage: "无法打开 2925 邮箱页面",
      matcher: (tab) => {
        return Boolean(getMail2925Url(tab.url))
      }
    })
    throwIfAborted(getAbortSignal())

    /**
     * 组合验证码结果和当前 2925 邮箱 tab 信息。
     *
     * @param code 读取到的验证码；失败时为空字符串。
     * @param message 给调用方展示的执行消息。
     * @return 标准 2925 验证码读取结果。
     */
    const createResult = async (
      code: string,
      message: string
    ): Promise<Mail2925VerificationCodeResult> => {
      const mailTab = await chrome.tabs.get(tabId)
      return {
        code,
        message,
        mailTab: {
          id: tabId,
          url: mailTab.url
        }
      }
    }

    await waitForTabLoaded(tabId)
    await navigateMail2925TabToMailbox(tabId)
    await waitForTabLoaded(tabId)
    throwIfAborted(getAbortSignal())

    const [codeInjectionResult] = await raceWithAbort(
      chrome.scripting.executeScript({
        target: { tabId },
        func: pollMail2925VerificationCodeInPage,
        args: [
          {
            mailboxUrl: MAIL2925_MAILBOX_URL,
            timeoutMs: 90000,
            targetEmail: email,
            verificationRequestedAt: Number(
              options.verificationRequestedAt || 0
            ),
            excludeCodes: options.excludeCodes || []
          }
        ]
      }),
      getAbortSignal(),
      () => {
        void chrome.tabs.reload(tabId).catch(() => undefined)
      }
    )
    const result = codeInjectionResult?.result
    if (!result?.ok || !result.code) {
      return createResult("", result?.message || "未在 2925 邮箱中找到验证码")
    }

    return createResult(result.code, result.message || "已读取 2925 邮箱验证码")
  }

  return {
    fetchMail2925VerificationCode
  }
}

export const { fetchMail2925VerificationCode } = createMail2925Runner()
