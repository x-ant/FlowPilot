import { pollMail2925VerificationCodeInPage } from "./mail-2925-page-code"
import {
  ensureMail2925SessionInPage,
  type EnsureMail2925SessionPayload
} from "./mail-2925-page-session"
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

const isMail2925MailboxUrl = (rawUrl?: string) => {
  const url = getMail2925Url(rawUrl)
  if (!url) {
    return false
  }

  return url.hash === "#/mailList" || url.hash.startsWith("#/mailList?")
}

export const createMail2925Runner = (context: RunContext = {}) => {
  const getAbortSignal = () => context.abortSignal

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

  const fetchMail2925VerificationCode = async (
    email: string,
    password: string,
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
    throwIfAborted(getAbortSignal())
    if (!session?.ok) {
      return createResult("", session?.message || "2925 邮箱登录态确认失败")
    }

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
