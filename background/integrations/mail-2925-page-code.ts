export type PollMail2925VerificationCodePayload = {
  mailboxUrl: string
  timeoutMs?: number
  targetEmail?: string
  verificationRequestedAt?: number
  excludeCodes?: string[]
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
  const refreshIntervalMs = 12000
  const startedAt = Date.now()
  let lastRefreshAt = 0
  const targetEmail = String(payload?.targetEmail || "")
    .trim()
    .toLowerCase()
  // 最小就是0
  const requestTimestamp = Math.max(
    0,
    Number(payload?.verificationRequestedAt || 0)
  )
  // 有时候，实际09发送2925邮箱，但是收件时间显示07，慢了2分钟，所以做这个时钟容忍误差
  const clockToleranceMs = 120 * 1000
  // 允许60秒误差，实际可能还剩59秒，但是已经是下一分钟了
  const staleToleranceMs = 60 * 1000
  // 如果是不是0，就取传入的时间往前一分钟，如果是0，就当前时间往前找10分钟
  let filterAfter = requestTimestamp
    ? Math.max(0, requestTimestamp - staleToleranceMs - clockToleranceMs)
    : startedAt - 10 * 60 * 1000
  const excludedCodes = new Set(
    (payload?.excludeCodes || [])
      .map((code) => String(code || "").trim())
      .filter(Boolean)
  )
  const seenCodes = new Set<string>()
  let lastSkipMessage = ""
  const formatDebugTime = (timestamp: number) => {
    return timestamp
      ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
      : "无"
  }
  const debugLog = (message: string, extra?: unknown) => {
    const loggedAt = Date.now()
    const logExtra =
      extra && typeof extra === "object" && !Array.isArray(extra)
        ? {
            loggedAt,
            loggedAtTime: formatDebugTime(loggedAt),
            ...(extra as Record<string, unknown>)
          }
        : {
            loggedAt,
            loggedAtTime: formatDebugTime(loggedAt),
            extra
          }

    console.info(`[flowpilot][2925验证码] ${message}`, logExtra)
  }
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
  const parseTimestampText = (text: string) => {
    const normalized = normalizeText(text)
    const now = new Date()
    const date = new Date(now)
    // 2925时钟可能慢2分钟， “刚刚/几秒前/几分钟前”这种描述，实际是20分，但是2925认为是18分，
    // 导致过滤时间时推到真实时间20分，2925时钟上19分到达的邮件就被错过了，
    // 已2925邮箱为准，刚刚/几秒前/几分钟前 就不能取Date.now()，要以传入的发送验证码的时间为基准处理
    // 传入的发送验证码的时间 是已经兼容时钟错误的时间，往前推了几分钟
    // 同时更新过滤时间的时候，采用2925邮箱的错误时间往前推进，
    // 刚刚/几秒前/几分钟前 这种就取不断推进的 传入的发送验证码的时间（filterAfter）
    const capRelativeTimestamp = (timestamp: number) => {
      return filterAfter ? Math.min(timestamp, filterAfter) : timestamp
    }
    let match = normalized.match(/(\d+)\s*分钟前/)
    if (match) {
      return capRelativeTimestamp(Date.now() - Number(match[1]) * 60 * 1000)
    }

    match = normalized.match(/(\d+)\s*秒前|刚刚/)
    if (match || /刚刚/.test(normalized)) {
      const secondsAgo = match?.[1] ? Number(match[1]) : 0
      return capRelativeTimestamp(Date.now() - secondsAgo * 1000)
    }

    match = normalized.match(
      /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/
    )
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6] || 0),
        0
      ).getTime()
    }

    match = normalized.match(/昨天\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (match) {
      date.setDate(now.getDate() - 1)
      date.setHours(
        Number(match[1]),
        Number(match[2]),
        Number(match[3] || 0),
        0
      )
      return date.getTime()
    }

    match = normalized.match(/今天\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (match) {
      date.setHours(
        Number(match[1]),
        Number(match[2]),
        Number(match[3] || 0),
        0
      )
      return date.getTime()
    }

    match = normalized.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (match) {
      date.setHours(
        Number(match[1]),
        Number(match[2]),
        Number(match[3] || 0),
        0
      )
      return date.getTime()
    }

    match = normalized.match(
      /(\d{1,2})[-月](\d{1,2})(?:日)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/
    )
    if (match) {
      date.setMonth(Number(match[1]) - 1, Number(match[2]))
      date.setHours(
        Number(match[3]),
        Number(match[4]),
        Number(match[5] || 0),
        0
      )
      return date.getTime()
    }

    return 0
  }
  const parseMailItemTimestamp = (item: HTMLElement) => {
    return parseTimestampText(getText(item))
  }
  const extractEmails = (text: string) => {
    const matches =
      String(text || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []
    return [...new Set(matches.map((item) => item.toLowerCase()))]
  }
  const normalizeTargetEmailHints = (email: string) => {
    const normalized = String(email || "")
      .trim()
      .toLowerCase()
    if (!normalized) {
      return []
    }

    const hints = [normalized]
    const atIndex = normalized.indexOf("@")
    if (atIndex > 0) {
      hints.push(
        `${normalized.slice(0, atIndex)}=${normalized.slice(atIndex + 1)}`
      )
    }

    return hints
  }
  const extractForwardedTargetEmails = (text: string) => {
    const normalizedText = String(text || "").toLowerCase()
    const matches =
      normalizedText.match(
        /bounce\+[a-z0-9._%+-]*-([a-z0-9._%+-]+)=([a-z0-9.-]+\.[a-z]{2,})@[a-z0-9.-]+\.[a-z]{2,}/gi
      ) || []

    return matches
      .map((candidate) => {
        const match = String(candidate || "").match(
          /bounce\+[a-z0-9._%+-]*-([a-z0-9._%+-]+)=([a-z0-9.-]+\.[a-z]{2,})@/i
        )
        return match
          ? `${match[1].toLowerCase()}@${match[2].toLowerCase()}`
          : ""
      })
      .filter(Boolean)
  }
  const isTargetRecipient = (text: string) => {
    if (!targetEmail) {
      return true
    }

    const normalizedText = String(text || "").toLowerCase()
    const hints = normalizeTargetEmailHints(targetEmail)
    if (hints.some((hint) => normalizedText.includes(hint))) {
      return true
    }

    const emails = [
      ...extractEmails(normalizedText),
      ...extractForwardedTargetEmails(normalizedText)
    ]
    return emails.some((email) => email === targetEmail)
  }
  const parseMailDetailTimestamp = (text: string) => {
    const normalized = normalizeText(text)
    const labeledTimeMatch = normalized.match(
      /(?:时间|时\s*间|date|time|sent|received)[：:\s]*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s*\d{1,2}:\d{2}(?::\d{2})?)/
    )
    if (labeledTimeMatch?.[1]) {
      return parseTimestampText(labeledTimeMatch[1])
    }

    return parseTimestampText(normalized)
  }
  const validateMailDetail = (text: string, listTimestamp: number) => {
    const detailTimestamp = parseMailDetailTimestamp(text) || listTimestamp

    if (targetEmail && !isTargetRecipient(text)) {
      return {
        ok: false,
        message: `跳过非当前账号邮件（目标 ${targetEmail}）`
      }
    }

    if (filterAfter && (!detailTimestamp || detailTimestamp < filterAfter)) {
      const requestedLabel = requestTimestamp
        ? new Date(requestTimestamp).toLocaleString("zh-CN", { hour12: false })
        : "本次轮询开始时间"
      const mailLabel = detailTimestamp
        ? new Date(detailTimestamp).toLocaleString("zh-CN", { hour12: false })
        : "未知时间"

      return {
        ok: false,
        message: `跳过旧验证码邮件（邮件时间 ${mailLabel}，请求时间 ${requestedLabel}）`
      }
    }

    return {
      ok: true,
      message: detailTimestamp
        ? `邮件时间 ${new Date(detailTimestamp).toLocaleString("zh-CN", { hour12: false })}`
        : "邮件时间未知"
    }
  }
  const waitForInboxReady = async (timeout = 5000) => {
    const waitStartedAt = Date.now()
    while (Date.now() - waitStartedAt < timeout) {
      if (
        (location.hash === "#/mailList" ||
          location.hash.startsWith("#/mailList?")) &&
        findMailItems().length > 0
      ) {
        return true
      }

      await wait(300)
    }

    return false
  }
  const returnToInbox = async () => {
    if (
      location.hash === "#/mailList" ||
      location.hash.startsWith("#/mailList?")
    ) {
      return false
    }

    location.href = mailboxUrl
    // 回到列表本身会触发 2925 前端重新加载列表，后续不需要立刻再点刷新。
    lastRefreshAt = Date.now()
    await waitForInboxReady()
    return true
  }
  const refreshInbox = async () => {
    const navigatedToInbox = await returnToInbox()
    if (navigatedToInbox) {
      return
    }

    if (Date.now() - lastRefreshAt < refreshIntervalMs) {
      return
    }

    const refreshButton = findAction(
      ["[class*='refresh' i]", "[title*='刷新']", "[aria-label*='刷新']"],
      /刷新|refresh/i
    )

    if (refreshButton) {
      lastRefreshAt = Date.now()
      refreshButton.click()
      await wait(1000)
      await waitForInboxReady()
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

  debugLog("开始轮询", {
    verificationRequestedAt: requestTimestamp,
    verificationRequestedAtTime: formatDebugTime(requestTimestamp),
    requestTimestamp,
    requestTime: formatDebugTime(requestTimestamp),
    filterAfter,
    filterAfterTime: formatDebugTime(filterAfter),
    targetEmail
  })

  while (Date.now() - startedAt < timeoutMs) {
    await refreshInbox()
    let currentScanMaxTimestamp = 0

    for (let itemIndex = 0; itemIndex < 8; itemIndex += 1) {
      // 打开邮件再返回列表时，2925 可能重新加载列表；如果新邮件插入顶部，
      // itemIndex 会有漂移风险。页面没有稳定邮件 id，弱文本去重可能误跳新验证码，
      // 所以这里保持按当前列表扫描，最终正确性依赖详情页的收件人和时间校验。
      const item = findMailItems().slice(0, 8)[itemIndex]
      if (!item) {
        break
      }

      const timestamp = parseMailItemTimestamp(item)
      if (timestamp > currentScanMaxTimestamp) {
        currentScanMaxTimestamp = timestamp
      }
      const previewText = getText(item)
      const matchedPreview =
        /openai|chatgpt|login|verification|code|验证码|登录|認証|確認/i.test(
          previewText
        )
      const matchedTargetInPreview = isTargetRecipient(previewText)

      if (matchedTargetInPreview) {
        debugLog("检查列表邮件", {
          itemIndex,
          verificationRequestedAt: requestTimestamp,
          verificationRequestedAtTime: formatDebugTime(requestTimestamp),
          timestamp,
          time: formatDebugTime(timestamp),
          filterAfter,
          filterAfterTime: formatDebugTime(filterAfter),
          matchedPreview,
          matchedTargetInPreview,
          previewText
        })
      }

      if (timestamp > 0 && timestamp < filterAfter) {
        lastSkipMessage = `列表时间早于过滤时间（列表时间 ${formatDebugTime(timestamp)}，过滤时间 ${formatDebugTime(filterAfter)}）`
        if (matchedTargetInPreview) {
          debugLog("跳过列表旧邮件", {
            itemIndex,
            verificationRequestedAt: requestTimestamp,
            verificationRequestedAtTime: formatDebugTime(requestTimestamp),
            timestamp,
            time: formatDebugTime(timestamp),
            filterAfter,
            filterAfterTime: formatDebugTime(filterAfter),
            previewText
          })
        }
        continue
      }

      if (!matchedPreview) {
        if (matchedTargetInPreview) {
          debugLog("跳过非验证码候选邮件", {
            itemIndex,
            previewText
          })
        }
        continue
      }

      if (matchedTargetInPreview) {
        debugLog("打开验证码候选邮件", {
          itemIndex,
          timestamp,
          time: formatDebugTime(timestamp),
          previewText
        })
      }
      const bodyText = await openMailAndRead(item)
      const validation = validateMailDetail(bodyText, timestamp)
      if (!validation.ok) {
        lastSkipMessage = validation.message
        if (!validation.message.includes("跳过非当前账号邮件")) {
          debugLog("详情校验失败", {
            itemIndex,
            message: validation.message
          })
        }
        continue
      }

      const bodyCode = extractVerificationCode(bodyText)
      if (bodyCode && excludedCodes.has(bodyCode)) {
        lastSkipMessage = `跳过已失败的验证码 ${bodyCode}`
        debugLog("跳过已失败验证码", {
          itemIndex,
          bodyCode
        })
        continue
      }

      if (bodyCode && !seenCodes.has(bodyCode)) {
        seenCodes.add(bodyCode)
        debugLog("读取到验证码", {
          itemIndex,
          bodyCode,
          message: validation.message
        })
        return {
          ok: true,
          code: bodyCode,
          message: `已打开 2925 邮件并读取验证码（${validation.message}）`
        }
      }
    }

    if (currentScanMaxTimestamp > filterAfter) {
      const previousFilterAfter = filterAfter
      filterAfter = currentScanMaxTimestamp
      debugLog("扫描后推进邮件时间过滤基准", {
        previousFilterAfter,
        previousFilterAfterTime: formatDebugTime(previousFilterAfter),
        currentScanMaxTimestamp,
        currentScanMaxTime: formatDebugTime(currentScanMaxTimestamp),
        nextFilterAfter: filterAfter,
        nextFilterAfterTime: formatDebugTime(filterAfter)
      })
    }

    await wait(5000)
  }

  return {
    ok: false,
    code: "",
    message: lastSkipMessage
      ? `未在 2925 邮箱中找到新的匹配验证码；${lastSkipMessage}`
      : "未在 2925 邮箱中找到验证码"
  }
}
