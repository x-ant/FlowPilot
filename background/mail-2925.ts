import { waitForTabLoaded } from "./tab-utils"
import type { BrowserTabInfo } from "./types"

const MAIL2925_MAILBOX_URL = "https://2925.com/#/mailList"
const MAIL2925_HOSTNAMES = ["2925.com", "www.2925.com"]

export type Mail2925VerificationCodeResult = {
  code: string
  message: string
  mailTab?: BrowserTabInfo
}

const isMail2925Url = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return MAIL2925_HOSTNAMES.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * 打开或复用 2925 邮箱标签页。
 *
 * @return 可用于脚本注入的 2925 标签页 id。
 */
export const findOrOpenMail2925Tab = async () => {
  const tabs = await chrome.tabs.query({})
  const matchedTab = tabs.find((tab) => {
    return isMail2925Url(tab.url)
  })

  if (matchedTab?.id) {
    await chrome.tabs.update(matchedTab.id, { active: true })
    await waitForTabLoaded(matchedTab.id)
    return matchedTab.id
  }

  const tab = await chrome.tabs.create({
    active: true,
    url: MAIL2925_MAILBOX_URL
  })

  if (!tab.id) {
    throw new Error("无法打开 2925 邮箱页面")
  }

  await waitForTabLoaded(tab.id)
  return tab.id
}

const ensureMail2925SessionInPage = async (payload: {
  email: string
  password: string
}) => {
  const email = String(payload?.email || "").trim()
  const password = String(payload?.password || "")
  const wait = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs)
    })
  }
  const normalizeText = (value: string) => {
    return String(value || "").replace(/\s+/g, " ").trim()
  }
  const isVisible = (element: Element | null) => {
    if (!element) {
      return false
    }

    const htmlElement = element as HTMLElement
    const rect = htmlElement.getBoundingClientRect()
    const style = window.getComputedStyle(htmlElement)
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    )
  }
  const setInputValue = (input: HTMLInputElement, value: string) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set

    if (valueSetter) {
      valueSetter.call(input, value)
    } else {
      input.value = value
    }

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  const findVisibleInput = (selectors: string[]) => {
    for (const selector of selectors) {
      const input = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          const candidate = element as HTMLInputElement
          return (
            isVisible(candidate) &&
            !candidate.disabled &&
            !candidate.readOnly &&
            candidate.type !== "hidden"
          )
        }
      ) as HTMLInputElement | undefined

      if (input) {
        return input
      }
    }

    return undefined
  }
  const findActionByText = (patterns: RegExp[], selectors: string[] = []) => {
    const selectorGroups = [
      ...selectors,
      "button, a, [role='button'], input[type='button'], input[type='submit']"
    ]

    for (const selector of selectorGroups) {
      const action = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          const htmlElement = element as HTMLElement
          if (!isVisible(htmlElement) || (htmlElement as HTMLButtonElement).disabled) {
            return false
          }

          if (selectors.includes(selector)) {
            return true
          }

          const text = normalizeText(
            [
              htmlElement.textContent,
              (htmlElement as HTMLInputElement).value,
              htmlElement.getAttribute("aria-label"),
              htmlElement.getAttribute("title")
            ]
              .filter(Boolean)
              .join(" ")
          )

          return patterns.some((pattern) => pattern.test(text))
        }
      ) as HTMLElement | undefined

      if (action) {
        return action
      }
    }

    return undefined
  }
  const isMailboxPage = () => {
    if (/#\/mailList/i.test(location.href)) {
      return true
    }

    const text = normalizeText(document.body?.innerText || "")
    return /收件箱|刷新|写信|邮件|mail/i.test(text) && !/密码|password/i.test(text)
  }
  const findAgreementCheckbox = () => {
    const checkboxes = document.querySelectorAll(
      "input[type='checkbox'], [role='checkbox'], .ivu-checkbox, .el-checkbox"
    )

    return Array.from(checkboxes).find((checkbox) => {
      const htmlElement = checkbox as HTMLElement
      const contextText = normalizeText(
        [
          htmlElement.textContent,
          htmlElement.getAttribute("aria-label"),
          htmlElement.getAttribute("title"),
          htmlElement.closest("label")?.textContent,
          htmlElement.parentElement?.textContent
        ]
          .filter(Boolean)
          .join(" ")
      )

      return isVisible(htmlElement) && /我已阅读并同意|服务协议|隐私政策/.test(contextText)
    }) as HTMLElement | undefined
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (isMailboxPage()) {
      return {
        ok: true,
        message: "2925 邮箱已处于收件箱"
      }
    }

    const emailInput = findVisibleInput([
      "input[type='email']",
      "input[name*='mail' i]",
      "input[id*='mail' i]",
      "input[name*='user' i]",
      "input[id*='user' i]",
      "input[placeholder*='邮箱']",
      "input[placeholder*='账号']",
      "input[placeholder*='用户名']",
      "input[type='text']"
    ])
    const passwordInput = findVisibleInput(["input[type='password']"])

    if (emailInput && passwordInput) {
      if (!email || !password) {
        return {
          ok: false,
          message: "2925 账号缺少邮箱或密码"
        }
      }

      const agreement = findAgreementCheckbox()
      const agreementChecked =
        (agreement as HTMLInputElement | undefined)?.checked === true ||
        agreement?.getAttribute("aria-checked") === "true"
      if (agreement && !agreementChecked) {
        agreement.click()
      }
      setInputValue(emailInput, email)
      setInputValue(passwordInput, password)

      const loginButton = findActionByText(
        [/登录/i, /login/i, /立即登录/i, /submit/i],
        ["button[type='submit']", ".ivu-btn-primary", ".el-button--primary"]
      )

      if (!loginButton) {
        return {
          ok: false,
          message: "未找到 2925 登录按钮"
        }
      }

      loginButton.click()

      for (let waitAttempt = 0; waitAttempt < 80; waitAttempt += 1) {
        await wait(500)
        if (isMailboxPage()) {
          return {
            ok: true,
            message: "已登录 2925 邮箱"
          }
        }
      }

      return {
        ok: false,
        message: "2925 登录后未进入收件箱"
      }
    }

    await wait(500)
  }

  return {
    ok: false,
    message: "未识别到 2925 收件箱或登录表单"
  }
}

const pollMail2925VerificationCodeInPage = async (payload: {
  timeoutMs?: number
}) => {
  const timeoutMs = Math.max(30000, Number(payload?.timeoutMs) || 90000)
  const startedAt = Date.now()
  const filterAfter = startedAt - 10 * 60 * 1000
  const seenCodes = new Set<string>()
  const wait = (timeout: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, timeout)
    })
  }
  const normalizeText = (value: string) => {
    return String(value || "").replace(/\s+/g, " ").trim()
  }
  const isVisible = (element: Element | null) => {
    if (!element) {
      return false
    }

    const htmlElement = element as HTMLElement
    const rect = htmlElement.getBoundingClientRect()
    const style = window.getComputedStyle(htmlElement)
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    )
  }
  const getText = (element: Element | null) => {
    const htmlElement = element as HTMLElement | null
    return normalizeText(
      [
        htmlElement?.innerText,
        htmlElement?.textContent,
        htmlElement?.getAttribute?.("aria-label"),
        htmlElement?.getAttribute?.("title")
      ]
        .filter(Boolean)
        .join(" ")
    )
  }
  const findAction = (selectors: string[], textPattern?: RegExp) => {
    for (const selector of selectors) {
      const matched = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          if (!isVisible(element)) {
            return false
          }

          return true
        }
      ) as HTMLElement | undefined

      if (matched) {
        return matched
      }
    }

    if (!textPattern) {
      return undefined
    }

    return Array.from(
      document.querySelectorAll("button, a, [role='button'], [role='link']")
    ).find((element) => {
      return isVisible(element) && textPattern.test(getText(element))
    }) as HTMLElement | undefined
  }
  const findMailItems = () => {
    const selectors = [
      ".mail-item",
      ".letter-item",
      ".el-table__row",
      "[class*='mailItem' i]",
      "[class*='mail-item' i]",
      "[class*='MailItem' i]",
      "tr[class*='mail' i]",
      "li[class*='mail' i]",
      "[class*='listItem' i]",
      "[class*='list-item' i]"
    ]
    const items: HTMLElement[] = []
    const seen = new Set<HTMLElement>()

    for (const selector of selectors) {
      const matched = Array.from(document.querySelectorAll(selector)).filter(
        (element) => isVisible(element)
      ) as HTMLElement[]

      for (const item of matched) {
        if (!seen.has(item)) {
          seen.add(item)
          items.push(item)
        }
      }
    }

    return items
  }
  const extractVerificationCode = (text: string) => {
    const normalized = normalizeText(text)
    const labeledMatch = normalized.match(
      /(?:login\s+code|log-in\s+code|verification\s+code|one[-\s]*time\s+code|passcode|验证码|登录验证码|代码为|認証コード|確認コード)[^\d]{0,30}(\d{6})/i
    )
    if (labeledMatch?.[1]) {
      return labeledMatch[1]
    }

    const plainMatch = normalized.match(/\b(\d{6})\b/)
    return plainMatch?.[1] || ""
  }
  const parseMailItemTimestamp = (item: HTMLElement) => {
    const text = getText(item)
    const now = new Date()
    let match = text.match(/(\d+)\s*分钟前/)
    if (match) {
      return Date.now() - Number(match[1]) * 60 * 1000
    }

    match = text.match(/(\d+)\s*秒前|刚刚/)
    if (match || /刚刚/.test(text)) {
      return Date.now()
    }

    match = text.match(/(?:今天\s*)?(\d{1,2}):(\d{2})/)
    if (match) {
      now.setHours(Number(match[1]), Number(match[2]), 0, 0)
      return now.getTime()
    }

    match = text.match(/(\d{1,2})[-月](\d{1,2})(?:日)?\s*(\d{1,2}):(\d{2})/)
    if (match) {
      now.setMonth(Number(match[1]) - 1, Number(match[2]))
      now.setHours(Number(match[3]), Number(match[4]), 0, 0)
      return now.getTime()
    }

    return 0
  }
  const returnToInbox = async () => {
    const inboxLink = findAction(
      ["a[href*='mailList']", "[class*='inbox' i]", "[title*='收件箱']"],
      /收件箱|inbox/i
    )
    if (inboxLink) {
      inboxLink.click()
      await wait(600)
      return
    }

    if (!/#\/mailList/i.test(location.href)) {
      window.history.back()
      await wait(600)
    }
  }
  const refreshInbox = async () => {
    const refreshButton = findAction(
      ["[class*='refresh' i]", "[title*='刷新']", "[aria-label*='刷新']"],
      /刷新|refresh/i
    )

    if (refreshButton) {
      refreshButton.click()
      await wait(1000)
      return
    }

    await returnToInbox()
  }
  const openMailAndRead = async (item: HTMLElement) => {
    item.click()
    await wait(1500)
    const text = normalizeText(document.body?.innerText || document.body?.textContent || "")
    await returnToInbox()
    return text
  }

  while (Date.now() - startedAt < timeoutMs) {
    await returnToInbox()
    await refreshInbox()

    const items = findMailItems().slice(0, 8)
    for (const item of items) {
      const timestamp = parseMailItemTimestamp(item)
      if (timestamp > 0 && timestamp < filterAfter) {
        continue
      }

      const previewText = getText(item)
      if (!/openai|chatgpt|login|verification|code|验证码|登录|認証|確認/i.test(previewText)) {
        continue
      }

      const previewCode = extractVerificationCode(previewText)
      if (previewCode && !seenCodes.has(previewCode)) {
        seenCodes.add(previewCode)
        return {
          ok: true,
          code: previewCode,
          message: "已从 2925 邮件列表读取验证码"
        }
      }

      const bodyText = await openMailAndRead(item)
      const bodyCode = extractVerificationCode(bodyText)
      if (bodyCode && !seenCodes.has(bodyCode)) {
        seenCodes.add(bodyCode)
        return {
          ok: true,
          code: bodyCode,
          message: "已打开 2925 邮件并读取验证码"
        }
      }
    }

    await wait(3000)
  }

  return {
    ok: false,
    code: "",
    message: "未在 2925 邮箱中找到验证码"
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
  const tabId = await findOrOpenMail2925Tab()
  const [sessionInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: ensureMail2925SessionInPage,
    args: [{ email, password }]
  })

  const session = sessionInjectionResult?.result as
    | {
        ok?: boolean
        message?: string
      }
    | undefined

  if (!session?.ok) {
    const tab = await chrome.tabs.get(tabId)
    return {
      code: "",
      mailTab: {
        id: tabId,
        url: tab.url
      },
      message: session?.message || "2925 邮箱登录态确认失败"
    }
  }

  const [codeInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: pollMail2925VerificationCodeInPage,
    args: [{ timeoutMs: 90000 }]
  })

  const result = codeInjectionResult?.result as
    | {
        ok?: boolean
        code?: string
        message?: string
      }
    | undefined
  const tab = await chrome.tabs.get(tabId)

  if (!result?.ok || !result.code) {
    return {
      code: "",
      mailTab: {
        id: tabId,
        url: tab.url
      },
      message: result?.message || "未在 2925 邮箱中找到验证码"
    }
  }

  return {
    code: result.code,
    mailTab: {
      id: tabId,
      url: tab.url
    },
    message: result.message || "已读取 2925 邮箱验证码"
  }
}
