export type PollMail2925VerificationCodePayload = {
  mailboxUrl: string
  timeoutMs?: number
}

export type PollMail2925VerificationCodeResult = {
  ok: boolean
  code: string
  message: string
}

/**
 * 在 2925 收件箱页面轮询 OpenAI/Codex 登录验证码。
 *
 * 这个函数会被注入到 2925 页面中执行，所以内部依赖的 DOM 工具函数必须保持自包含。
 *
 * @param payload 轮询配置。
 * @return 验证码读取结果。
 */
export const pollMail2925VerificationCodeInPage = async (
  payload: PollMail2925VerificationCodePayload
): Promise<PollMail2925VerificationCodeResult> => {
  const mailboxUrl = String(
    payload?.mailboxUrl || "https://2925.com/#/mailList"
  )
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
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
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
    if (location.hash === "#/mailList") {
      return
    }

    location.href = mailboxUrl
    await wait(1200)
  }
  const refreshInbox = async () => {
    await returnToInbox()

    const refreshButton = findAction(
      ["[class*='refresh' i]", "[title*='刷新']", "[aria-label*='刷新']"],
      /刷新|refresh/i
    )

    if (refreshButton) {
      refreshButton.click()
      await wait(1000)
    }
  }
  const openMailAndRead = async (item: HTMLElement) => {
    item.click()
    await wait(1500)
    const text = normalizeText(
      document.body?.innerText || document.body?.textContent || ""
    )
    await returnToInbox()
    return text
  }

  while (Date.now() - startedAt < timeoutMs) {
    await refreshInbox()

    const items = findMailItems().slice(0, 8)
    for (const item of items) {
      const timestamp = parseMailItemTimestamp(item)
      if (timestamp > 0 && timestamp < filterAfter) {
        continue
      }

      const previewText = getText(item)
      if (
        !/openai|chatgpt|login|verification|code|验证码|登录|認証|確認/i.test(
          previewText
        )
      ) {
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
