import type { BrowserTabInfo } from "../../shared/flow-contracts"
import { raceWithAbort, throwIfAborted } from "../utils/abort"
import type { RunContext } from "../utils/run-context"
import { findOrOpenMatchedTab, waitForTabLoaded } from "../utils/tab-utils"
import { pollMail163VerificationCodeInPage } from "./mail-163-page-code"

const MAIL163_MAILBOX_URL = "https://mail.163.com/"
const MAIL163_HOSTNAME = "mail.163.com"

export type Mail163VerificationCodeResult = {
  code: string
  message: string
  mailTab?: BrowserTabInfo
}

export type FetchMail163VerificationCodeOptions = {
  targetEmail?: string
  verificationRequestedAt?: number
  excludeCodes?: string[]
}

/**
 * 判断标签页是否属于当前支持的 163 邮箱站点。
 *
 * @param rawUrl 标签页当前 URL。
 * @return URL 属于 `mail.163.com` 时返回 true。
 */
const isMail163Url = (rawUrl?: string) => {
  try {
    return (
      new URL(String(rawUrl || "")).hostname.toLowerCase() === MAIL163_HOSTNAME
    )
  } catch {
    return false
  }
}

/**
 * 判断 163 标签页是否已经是收件箱列表。
 *
 * 163 已登录后的收件箱也会使用 `/js6/main.jsp`，需要优先识别
 * `mbox.ListModule`，避免把真实收件箱误判为登录页。
 *
 * @param rawUrl 标签页当前 URL。
 * @return URL 指向 163 收件箱列表时返回 true。
 */
const isMail163InboxUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    if (url.hostname.toLowerCase() !== MAIL163_HOSTNAME) {
      return false
    }

    return (
      url.pathname.startsWith("/js6/main.jsp") &&
      decodeURIComponent(url.hash || "").includes("mbox.ListModule")
    )
  } catch {
    return false
  }
}

/**
 * 判断 163 标签页是否停在登录页。
 *
 * 当前项目不自动登录邮箱；命中登录页时直接提示用户手动登录，
 * 避免在登录页继续执行收信和验证码轮询。
 *
 * @param rawUrl 标签页当前 URL。
 * @return URL 是 163 登录页时返回 true。
 */
const isMail163LoginUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    if (url.hostname.toLowerCase() !== MAIL163_HOSTNAME) {
      return false
    }

    if (isMail163InboxUrl(rawUrl)) {
      return false
    }

    return url.pathname === "/"
  } catch {
    return false
  }
}

/**
 * 创建 163 邮箱验证码读取 runner。
 *
 * runner 只负责复用或打开 163 邮箱页面并注入验证码轮询逻辑，
 * 不处理 163 登录；调用前默认用户已经手动登录邮箱。
 *
 * @param context 当前运行上下文，用于响应停止信号。
 * @return 163 验证码读取方法。
 */
export const createMail163Runner = (context: RunContext = {}) => {
  const getAbortSignal = () => context.abortSignal

  /**
   * 在 163 邮箱页面轮询 OpenAI/ChatGPT 验证码。
   *
   * @param options 轮询配置。
   * @param options.targetEmail OpenAI 实际注册或登录邮箱，用于过滤 Duck 转发邮件。
   * @param options.verificationRequestedAt 触发验证码发送的时间，用于跳过旧邮件。
   * @param options.excludeCodes 已被页面拒绝的验证码，重试时会跳过。
   * @return 验证码读取结果；成功时包含 `code` 和邮箱 tab 信息。
   */
  const fetchMail163VerificationCode = async (
    options: FetchMail163VerificationCodeOptions = {}
  ): Promise<Mail163VerificationCodeResult> => {
    throwIfAborted(getAbortSignal())

    const tabId = await findOrOpenMatchedTab({
      targetUrl: MAIL163_MAILBOX_URL,
      errorMessage: "无法打开 163 邮箱页面",
      matcher: (tab) => isMail163Url(tab.url),
      navigateMatchedTab: false
    })
    throwIfAborted(getAbortSignal())

    /**
     * 组合验证码结果和当前 163 邮箱 tab 信息。
     *
     * @param code 读取到的验证码；失败时为空字符串。
     * @param message 给调用方展示的执行消息。
     * @return 标准 163 验证码读取结果。
     */
    const createResult = async (
      code: string,
      message: string
    ): Promise<Mail163VerificationCodeResult> => {
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

    await chrome.tabs.update(tabId, { active: true })
    await waitForTabLoaded(tabId)
    const currentTab = await chrome.tabs.get(tabId)
    if (isMail163LoginUrl(currentTab.url)) {
      return createResult("", "163 邮箱未登录，请先手动登录 163 邮箱")
    }

    throwIfAborted(getAbortSignal())

    const [codeInjectionResult] = await raceWithAbort(
      chrome.scripting.executeScript({
        target: { tabId },
        func: pollMail163VerificationCodeInPage,
        args: [
          {
            targetEmail: options.targetEmail || "",
            verificationRequestedAt: Number(
              options.verificationRequestedAt || 0
            ),
            excludeCodes: options.excludeCodes || [],
            timeoutMs: 90000
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
      return createResult("", result?.message || "未在 163 邮箱中找到验证码")
    }

    return createResult(result.code, result.message || "已读取 163 邮箱验证码")
  }

  return {
    fetchMail163VerificationCode
  }
}

export const { fetchMail163VerificationCode } = createMail163Runner()
