import { pollMail2925VerificationCodeInPage } from "./mail-2925-page-code";
import { ensureMail2925SessionInPage, type EnsureMail2925SessionPayload } from "./mail-2925-page-session";
import type { BrowserTabInfo } from "./types";
import { findOrOpenMatchedTab, waitForTabLoaded } from "./utils/tab-utils";


const MAIL2925_MAILBOX_URL = "https://2925.com/#/mailList"
const MAIL2925_HOSTNAMES = ["2925.com", "www.2925.com"]

export type Mail2925VerificationCodeResult = {
  code: string
  message: string
  mailTab?: BrowserTabInfo
}

/**
 * 是否是2925邮箱页面
 *
 * @param rawUrl
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
 * 是否是收件箱界面
 *
 * @param rawUrl
 */
const isMail2925MailboxUrl = (rawUrl?: string) => {
  return getMail2925Url(rawUrl)?.hash === "#/mailList"
}

/**
 * 把指定 2925 标签页切到默认收件箱。
 *
 * 2925 的不同分类也会使用 mailList 路由，例如已删除是
 * #/mailList?type=已删除，所以这里必须精确跳到 #/mailList。
 *
 * @param tabId 2925 标签页 id。
 * @return 无。
 */
const navigateMail2925TabToMailbox = async (tabId: number) => {
  const tab = await chrome.tabs.get(tabId)

  if (isMail2925MailboxUrl(tab.url)) {
    await chrome.tabs.update(tabId, { active: true })
  } else {
    await chrome.tabs.update(tabId, {
      active: true,
      url: MAIL2925_MAILBOX_URL
    })
  }
}

/**
 * 读取 2925 邮箱验证码。
 *
 * 第一版只做单账号本地学习场景：打开/复用 2925 页，确认登录态，然后轮询收件箱。
 *
 * @param email 2925 邮箱地址。
 * @param password 2925 邮箱密码。
 * @return 读取结果。
 */
export const fetchMail2925VerificationCode = async (
  email: string,
  password: string
): Promise<Mail2925VerificationCodeResult> => {

  // region ========== 方法域 ==========
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
  // endregion

  // 找tab
  const tabId = await findOrOpenMatchedTab({
    targetUrl: MAIL2925_MAILBOX_URL,
    errorMessage: "无法打开 2925 邮箱页面",
    matcher: (tab) => {
      return Boolean(getMail2925Url(tab.url))
    }
  })

  // region ========== 没登录就先登录 ==========
  await waitForTabLoaded(tabId)
  const [sessionInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: ensureMail2925SessionInPage,
    args: [
      {
        email,
        password
      } satisfies EnsureMail2925SessionPayload
    ]
  })
  const session = sessionInjectionResult?.result
  if (!session?.ok) {
    return createResult("", session?.message || "2925 邮箱登录态确认失败")
  }
  // endregion

  // region ========== 登录就调到收件箱页面 ==========
  await navigateMail2925TabToMailbox(tabId)
  await waitForTabLoaded(tabId)
  const [codeInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: pollMail2925VerificationCodeInPage,
    args: [
      {
        mailboxUrl: MAIL2925_MAILBOX_URL,
        timeoutMs: 90000
      }
    ]
  })
  const result = codeInjectionResult?.result
  if (!result?.ok || !result.code) {
    return createResult("", result?.message || "未在 2925 邮箱中找到验证码")
  }
  // endregion

  return createResult(result.code, result.message || "已读取 2925 邮箱验证码")
}
