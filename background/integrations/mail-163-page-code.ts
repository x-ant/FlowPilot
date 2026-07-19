export type PollMail163VerificationCodePayload = {
  targetEmail?: string
  verificationRequestedAt?: number
  excludeCodes?: string[]
  timeoutMs?: number
}

export type PollMail163VerificationCodeResult = {
  ok: boolean
  code: string
  message: string
}

/**
 * 在 163 邮箱页面轮询 OpenAI/ChatGPT 验证码。
 *
 * 这个函数会被注入到 163 邮箱页面执行，默认用户已经手动登录，
 * 只负责进入收件箱、刷新邮件、过滤目标邮件并读取验证码。
 *
 * @param payload 轮询配置。
 * @param payload.targetEmail OpenAI 实际注册或登录邮箱，用于匹配 Duck 转发邮件。
 * @param payload.verificationRequestedAt 触发验证码发送的时间，用于跳过旧邮件。
 * @param payload.excludeCodes 已被 OpenAI 拒绝的验证码，重试时跳过。
 * @param payload.timeoutMs 最大轮询时长，单位毫秒。
 * @return 验证码读取结果；成功时包含 6 位验证码。
 */
export const pollMail163VerificationCodeInPage = async (
  payload: PollMail163VerificationCodePayload
): Promise<PollMail163VerificationCodeResult> => {
  const targetEmail = String(payload?.targetEmail || "")
    .trim()
    .toLowerCase()
  const timeoutMs = Math.max(30000, Number(payload?.timeoutMs || 90000))
  const intervalMs = 5000
  const requestedAt = Math.max(0, Number(payload?.verificationRequestedAt || 0))
  const filterAfter = requestedAt
    ? requestedAt - 90 * 1000
    : Date.now() - 10 * 60 * 1000
  const excludeCodes = new Set(
    (payload?.excludeCodes || [])
      .map((code) => String(code || "").trim())
      .filter(Boolean)
  )
  const seenCodes = new Set<string>()
  const startedAt = Date.now()
  let lastMessage = ""

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

    console.info(`[flowpilot][163验证码] ${message}`, logExtra)
  }

  /**
   * 等待 163 页面列表刷新或邮件详情加载。
   *
   * @param timeout 等待毫秒数。
   * @return 等待完成后 resolve。
   */
  const wait = (timeout: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, timeout)
    })
  }
  /**
   * 归一化 DOM 文本，减少空白差异对匹配的影响。
   *
   * @param value 原始文本。
   * @return 去除多余空白后的文本。
   */
  const normalizeText = (value: unknown) => {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
  }
  /**
   * 判断 DOM 元素是否处于可见状态。
   *
   * @param element 要检查的 DOM 元素。
   * @return 元素可见且有尺寸时返回 true。
   */
  const isVisible = (element: Element | null) => {
    if (!element) {
      return false
    }
    const htmlElement = element as HTMLElement
    const style = window.getComputedStyle(htmlElement)
    const rect = htmlElement.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    )
  }
  /**
   * 提取元素里的可匹配文本。
   *
   * @param element 要读取的 DOM 元素。
   * @return 合并 innerText、textContent、aria-label 和 title 后的文本。
   */
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
  /**
   * 点击可选 DOM 元素。
   *
   * @param element 要点击的 DOM 元素。
   * @return 成功触发点击时返回 true。
   */
  const clickElement = (element: Element | null) => {
    if (!element) {
      return false
    }
    ;(element as HTMLElement).click()
    return true
  }

  const mailRowSelectors = [
    "div[sign='letter']",
    "[sign='letter'][aria-label]",
    "[role='option'][aria-label]",
    "[role='listitem'][aria-label]",
    "tr[aria-label]",
    "li[aria-label]"
  ]

  /**
   * 收集 163 邮件列表里的真实邮件行。
   *
   * 这里不再使用宽泛的 `div[aria-label]`，只保留邮件行特征，避免
   * 把工具栏等外层控件当作候选邮件。
   *
   * @return 可见邮件行元素列表。
   */
  const collectMailRowElements = () => {
    const rows: HTMLElement[] = []
    const seen = new Set<Element>()

    for (const selector of mailRowSelectors) {
      for (const item of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(item) || !isVisible(item)) {
          continue
        }

        const text = getText(item)
        if (!text) {
          continue
        }

        seen.add(item)
        rows.push(item as HTMLElement)
      }
    }

    return rows
  }
  /**
   * 查找 163 邮箱列表里的任意邮件行。
   *
   * @return 可见邮件行元素列表。
   */
  const findVisibleMailRows = () => {
    return collectMailRowElements()
  }
  /**
   * 查找 163 邮箱列表里的验证码候选邮件。
   *
   * @return 可见的邮件行元素列表。
   */
  const findMailItems = () => {
    return collectMailRowElements().filter((item) => {
      return /openai|chatgpt|验证码|代码|verification|code|duckduckgo|forward/i.test(
        getText(item)
      )
    })
  }
  /**
   * 等待 163 邮件列表出现。
   *
   * 这里只判断刷新动作是否让邮件列表可读，不主动切换 URL。
   *
   * @param timeout 最大等待时间，单位毫秒。
   * @return 列表出现时返回 true。
   */
  const waitForMailListReady = async (timeout = 8000) => {
    const started = Date.now()
    while (Date.now() - started <= timeout) {
      if (findVisibleMailRows().length > 0) {
        return true
      }

      await wait(300)
    }

    return false
  }
  /**
   * 点击 163 左上角“收信”按钮。
   *
   * “收信”按钮兼具进入收件箱和刷新列表的作用，所以首次进入和后续轮询
   * 都复用这一条路径。
   *
   * @return 找到并点击“收信”按钮时返回 true。
   */
  const clickReceiveMail = () => {
    const receiveButton = Array.from(
      document.querySelectorAll(
        "li[role='button'], .ra0, button, a, [role='button']"
      )
    ).find((element) => {
      return isVisible(element) && /收\s*信|receive/i.test(getText(element))
    })
    return clickElement(receiveButton || null)
  }
  /**
   * 刷新 163 收件箱列表。
   *
   * @return 刷新动作和等待列表完成后 resolve。
   */
  const refreshInbox = async () => {
    if (!clickReceiveMail()) {
      lastMessage = "未找到 163 邮箱“收信”按钮"
      debugLog("刷新收件箱失败", {
        reason: lastMessage,
        url: window.location.href
      })
      await wait(1200)
      return
    }

    const ready = await waitForMailListReady(12000)
    debugLog("刷新收件箱", {
      ready,
      visibleRows: findVisibleMailRows().length,
      url: window.location.href
    })
  }
  /**
   * 从邮件列表文本或正文里提取 6 位验证码。
   *
   * @param text 邮件列表行或邮件正文文本。
   * @return 识别到的 6 位验证码；未找到时返回空字符串。
   */
  const extractVerificationCode = (text: string) => {
    const normalized = normalizeText(text)
    const labeledMatch = normalized.match(
      /(?:login\s+code|log-in\s+code|verification\s+code|temporary\s+verification\s+code|your\s+chatgpt\s+code|one[-\s]*time\s+code|passcode|验证码|登录验证码|代码为|認証コード|確認コード)[^\d]{0,30}(\d{6})/i
    )
    if (labeledMatch?.[1]) {
      return labeledMatch[1]
    }
    return normalized.match(/\b(\d{6})\b/)?.[1] || ""
  }
  /**
   * 从 163 邮件行文本里解析邮件时间。
   *
   * @param text 邮件行文本。
   * @return 可解析时返回时间戳；无法解析时返回 0。
   */
  const parseTimestamp = (text: string) => {
    const normalized = normalizeText(text)
    const now = new Date()
    let match = normalized.match(
      /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/
    )
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5])
      ).getTime()
    }
    match = normalized.match(/今天\s*(\d{1,2}):(\d{2})/)
    if (match) {
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number(match[1]),
        Number(match[2])
      ).getTime()
    }
    match = normalized.match(/昨天\s*(\d{1,2}):(\d{2})/)
    if (match) {
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
        Number(match[1]),
        Number(match[2])
      ).getTime()
    }
    match = normalized.match(/\b(\d{1,2}):(\d{2})\b/)
    if (match) {
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number(match[1]),
        Number(match[2])
      ).getTime()
    }
    return 0
  }
  type OpenedMailTextCandidate = {
    source: string
    text: string
  }

  /**
   * 收集当前打开邮件详情页里的正文候选文本。
   *
   * 163 的阅读正文通常在 `*_frameBody` iframe 内，页面主体仍会保留
   * 收件箱列表文本；这里保留来源，后续优先使用阅读 iframe，避免把列表
   * 文本误当作邮件正文。
   *
   * @return 邮件正文候选文本和来源。
   */
  const collectOpenedMailTextCandidates = () => {
    const candidates: OpenedMailTextCandidate[] = []
    const seen = new Set<string>()
    const pushText = (source: string, value: unknown) => {
      const text = normalizeText(value)
      if (!text || seen.has(text)) {
        return
      }
      seen.add(text)
      candidates.push({
        source,
        text
      })
    }

    document.querySelectorAll("iframe").forEach((frame, index) => {
      try {
        const iframe = frame as HTMLIFrameElement
        const frameId = iframe.id || iframe.name || `iframe-${index + 1}`
        pushText(
          `iframe:${frameId}`,
          iframe.contentDocument?.body?.innerText ||
            iframe.contentDocument?.body?.textContent
        )
      } catch {
        // 163 邮件正文通常同源可读；跨域或未加载 iframe 只跳过。
      }
    })

    document
      .querySelectorAll(
        ".readHtml, [class*='readmail'], [class*='mailread'], [class*='mailBody'], [class*='mailbody'], [class*='mail-content'], [class*='mailContent'], [class*='mail-detail'], [class*='mailDetail'], [class*='read'] [class*='content'], [role='main']"
      )
      .forEach((element, index) => {
        pushText(
          `detail:${index + 1}`,
          (element as HTMLElement).innerText || element.textContent
        )
      })

    pushText(
      "document.body",
      document.body?.innerText || document.body?.textContent
    )
    return candidates
  }

  /**
   * 从候选文本中选择最像邮件正文的一段。
   *
   * @param candidates 当前页面可读文本候选。
   * @param excludedTexts 点击邮件前已经存在的文本，用于排除收件箱列表。
   * @return 选中的正文候选；未命中时返回 undefined。
   */
  const selectOpenedMailTextCandidate = (
    candidates: OpenedMailTextCandidate[],
    excludedTexts: Set<string>
  ) => {
    const available = candidates.filter((candidate) => {
      return !excludedTexts.has(candidate.text)
    })
    const source = available.length > 0 ? available : candidates
    return (
      source.find((candidate) => {
        return Boolean(extractVerificationCode(candidate.text))
      }) ||
      source.find((candidate) => {
        return /^iframe:/i.test(candidate.source)
      }) ||
      source.find((candidate) => {
        return /^detail:/i.test(candidate.source)
      }) ||
      source[0]
    )
  }

  /**
   * 收集打开邮件后的外层头部信息。
   *
   * 163 的验证码正文在 iframe 内，但收件人信息在 iframe 外的阅读页头部；
   * 当前账号匹配需要同时看外层头部和 iframe 正文。
   *
   * @return 阅读页外层头部文本。
   */
  const collectOpenedMailHeaderText = () => {
    const texts: string[] = []
    const seen = new Set<string>()
    const pushText = (value: unknown) => {
      const text = normalizeText(value)
      if (!text || seen.has(text)) {
        return
      }
      seen.add(text)
      texts.push(text)
    }

    document
      .querySelectorAll(
        "header, [id*='dvReadHeadInfo'], [id*='dvReadHeader'], [id*='_liReadOutto'], [id*='_dvReadto'], .nui-addr, .nui-addr-email, .nui-addr-name"
      )
      .forEach((element) => {
        pushText((element as HTMLElement).innerText || element.textContent)
        pushText(element.getAttribute("title"))
        pushText(element.getAttribute("aria-label"))
      })

    return texts.join(" ")
  }
  /**
   * 打开候选邮件并读取详情正文。
   *
   * @param item 要打开的邮件列表行。
   * @return 邮件详情文本和从正文中提取到的验证码。
   */
  const openMailAndRead = async (item: HTMLElement) => {
    const listText = getText(item)
    const beforeTexts = new Set(
      collectOpenedMailTextCandidates().map((candidate) => candidate.text)
    )
    debugLog("打开验证码候选邮件", {
      listText: listText.slice(0, 300)
    })
    item.click()
    let openedText = ""
    let openedSource = ""
    for (let index = 0; index < 20; index += 1) {
      await wait(250)
      const candidates = collectOpenedMailTextCandidates()
      const candidate = selectOpenedMailTextCandidate(candidates, beforeTexts)
      if (!candidate) {
        continue
      }
      const headerText = collectOpenedMailHeaderText()
      openedText = normalizeText(`${headerText} ${candidate.text}`)
      openedSource = candidate.source
      const code = extractVerificationCode(candidate.text)
      if (code) {
        debugLog("详情页提取到验证码", {
          code,
          readRound: index + 1,
          source: candidate.source,
          candidateSources: candidates.map((item) => item.source),
          headerHasTarget: includesTargetEmail(headerText),
          headerPreview: headerText.slice(0, 500),
          textLength: candidate.text.length,
          textPreview: candidate.text.slice(0, 500)
        })
        await refreshInbox()
        return {
          text: openedText,
          code
        }
      }
    }
    await refreshInbox()
    debugLog("详情页未提取到验证码", {
      source: openedSource,
      textLength: openedText.length,
      textPreview: openedText.slice(0, 500)
    })
    return {
      text: openedText,
      code: ""
    }
  }
  /**
   * 判断邮件文本是否属于当前 OpenAI 目标邮箱。
   *
   * Duck 转发邮件可能把 `name@duck.com` 编码成 `name=duck.com`，
   * 所以这里同时匹配原始邮箱和转发格式。
   *
   * @param text 邮件列表或正文文本。
   * @return 文本命中目标邮箱线索时返回 true。
   */
  const includesTargetEmail = (text: string) => {
    if (!targetEmail) {
      return true
    }
    const normalized = normalizeText(text).toLowerCase()
    const atIndex = targetEmail.indexOf("@")
    const duckForwardHint =
      atIndex > 0
        ? `${targetEmail.slice(0, atIndex)}=${targetEmail.slice(atIndex + 1)}`
        : ""
    return (
      normalized.includes(targetEmail) ||
      Boolean(duckForwardHint && normalized.includes(duckForwardHint))
    )
  }

  debugLog("开始轮询", {
    requestedAt,
    requestedAtTime: formatDebugTime(requestedAt),
    filterAfter,
    filterAfterTime: formatDebugTime(filterAfter),
    targetEmail,
    excludeCodes: Array.from(excludeCodes),
    timeoutMs,
    intervalMs
  })

  while (Date.now() - startedAt <= timeoutMs) {
    await refreshInbox()
    const items = findMailItems()
    debugLog("扫描邮件列表", {
      candidateCount: items.length,
      visibleRows: findVisibleMailRows().length,
      elapsedMs: Date.now() - startedAt
    })
    for (const item of items) {
      const text = getText(item)
      const timestamp = parseTimestamp(text)
      const listCode = extractVerificationCode(text)
      debugLog("检查列表邮件", {
        timestamp,
        time: formatDebugTime(timestamp),
        filterAfter,
        filterAfterTime: formatDebugTime(filterAfter),
        listCode,
        hasTargetEmailInList: includesTargetEmail(text),
        text: text.slice(0, 500)
      })
      if (timestamp && timestamp < filterAfter) {
        lastMessage = `跳过旧邮件（列表时间 ${formatDebugTime(
          timestamp
        )}，过滤时间 ${formatDebugTime(filterAfter)}）`
        debugLog("跳过列表旧邮件", {
          timestamp,
          time: formatDebugTime(timestamp),
          filterAfter,
          filterAfterTime: formatDebugTime(filterAfter)
        })
        continue
      }
      if (!/openai|chatgpt|验证码|代码|verification|code/i.test(text)) {
        lastMessage = "跳过非验证码邮件"
        debugLog("跳过非验证码候选邮件", {
          text: text.slice(0, 500)
        })
        continue
      }
      let code = listCode
      let openedText = ""
      if (!code || !includesTargetEmail(text)) {
        const openedMail = await openMailAndRead(item)
        openedText = openedMail.text
        code = code || openedMail.code
      }
      if (!includesTargetEmail(`${text} ${openedText}`)) {
        lastMessage = `跳过非当前账号邮件（目标 ${targetEmail}）`
        debugLog("跳过非当前账号邮件", {
          targetEmail,
          listHasTarget: includesTargetEmail(text),
          detailHasTarget: includesTargetEmail(openedText),
          listText: text.slice(0, 500),
          detailText: openedText.slice(0, 500)
        })
        continue
      }
      if (!code) {
        lastMessage = "候选邮件未提取到验证码"
        debugLog("候选邮件未提取到验证码", {
          listText: text.slice(0, 500),
          detailText: openedText.slice(0, 500)
        })
        continue
      }
      if (excludeCodes.has(code) || seenCodes.has(code)) {
        lastMessage = `跳过已处理验证码 ${code}`
        debugLog("跳过已处理验证码", {
          code,
          excluded: excludeCodes.has(code),
          seen: seenCodes.has(code)
        })
        continue
      }
      seenCodes.add(code)
      debugLog("读取到验证码", {
        code,
        targetEmail,
        timestamp,
        time: formatDebugTime(timestamp),
        listText: text.slice(0, 500),
        detailText: openedText.slice(0, 500)
      })
      return {
        ok: true,
        code,
        message: `已在 163 邮箱读取验证码 ${code}`
      }
    }
    debugLog("本轮未命中验证码，等待后继续", {
      lastMessage,
      intervalMs
    })
    await wait(intervalMs)
  }

  return {
    ok: false,
    code: "",
    message: lastMessage
      ? `未在 163 邮箱中找到新的匹配验证码；${lastMessage}`
      : "未在 163 邮箱中找到验证码"
  }
}
