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
  const filterAfter = requestedAt ? requestedAt - 90 * 1000 : Date.now() - 10 * 60 * 1000
  const excludeCodes = new Set(
    (payload?.excludeCodes || [])
      .map((code) => String(code || "").trim())
      .filter(Boolean)
  )
  const seenCodes = new Set<string>()
  const startedAt = Date.now()
  let lastMessage = ""

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
  /**
   * 点击 163 邮箱左侧收件箱入口。
   *
   * @return 找到并点击收件箱时返回 true。
   */
  const clickInbox = () => {
    const inbox = Array.from(
      document.querySelectorAll(
        ".nui-tree-item-text[title='收件箱'], [title='收件箱'], a, button, [role='button']"
      )
    ).find((element) => {
      return isVisible(element) && /收件箱|inbox/i.test(getText(element))
    })
    return clickElement(inbox || null)
  }
  /**
   * 刷新 163 收件箱列表。
   *
   * 优先点击页面刷新按钮；找不到按钮时使用页面刷新兜底。
   *
   * @return 刷新动作和短暂等待完成后 resolve。
   */
  const refreshInbox = async () => {
    const refreshButton = Array.from(
      document.querySelectorAll("button, a, [role='button'], .nui-btn")
    ).find((element) => {
      return isVisible(element) && /^刷新$|refresh/i.test(getText(element).replace(/\s/g, ""))
    })
    if (clickElement(refreshButton || null)) {
      await wait(1200)
      return
    }
    window.location.reload()
    await wait(2500)
  }
  /**
   * 查找 163 邮箱列表里的验证码候选邮件。
   *
   * @return 可见的邮件行元素列表。
   */
  const findMailItems = () => {
    const selectors = [
      "div[sign='letter']",
      "[role='option'][aria-label]",
      "[role='listitem'][aria-label]",
      "tr[aria-label]",
      "li[aria-label]",
      "div[aria-label]"
    ]
    const items: HTMLElement[] = []
    const seen = new Set<Element>()
    for (const selector of selectors) {
      for (const item of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(item) || !isVisible(item)) {
          continue
        }
        const text = getText(item)
        if (/openai|chatgpt|验证码|代码|verification|code|duckduckgo|forward/i.test(text)) {
          seen.add(item)
          items.push(item as HTMLElement)
        }
      }
    }
    return items
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
      /(?:verification\s+code|temporary\s+verification\s+code|your\s+chatgpt\s+code|login\s+code|one[-\s]*time\s+code|验证码|登录验证码|代码为)[^\d]{0,30}(\d{6})/i
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
    let match = normalized.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/)
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
  /**
   * 收集当前打开邮件详情页里的正文候选文本。
   *
   * @return 按长度倒序排列的正文候选文本。
   */
  const collectOpenedMailText = () => {
    const texts: string[] = []
    const pushText = (value: unknown) => {
      const text = normalizeText(value)
      if (text) {
        texts.push(text)
      }
    }
    document
      .querySelectorAll(
        ".readHtml, [class*='readmail'], [class*='mailBody'], [class*='mailbody'], [role='main']"
      )
      .forEach((element) => pushText((element as HTMLElement).innerText || element.textContent))
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        pushText((frame as HTMLIFrameElement).contentDocument?.body?.innerText)
      } catch {
        // Ignore cross-frame mail body access.
      }
    })
    pushText(document.body?.innerText)
    return texts.sort((left, right) => right.length - left.length)
  }
  /**
   * 打开候选邮件并从详情正文读取验证码。
   *
   * @param item 要打开的邮件列表行。
   * @return 读取到的验证码；未找到时返回空字符串。
   */
  const openMailAndReadCode = async (item: HTMLElement) => {
    item.click()
    for (let index = 0; index < 20; index += 1) {
      await wait(250)
      for (const text of collectOpenedMailText()) {
        const code = extractVerificationCode(text)
        if (code) {
          clickInbox()
          await wait(500)
          return code
        }
      }
    }
    clickInbox()
    await wait(500)
    return ""
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
    return normalized.includes(targetEmail) || Boolean(duckForwardHint && normalized.includes(duckForwardHint))
  }

  clickInbox()
  await wait(1000)

  while (Date.now() - startedAt <= timeoutMs) {
    await refreshInbox()
    const items = findMailItems()
    for (const item of items) {
      const text = getText(item)
      const timestamp = parseTimestamp(text)
      if (timestamp && timestamp < filterAfter) {
        lastMessage = "跳过旧邮件"
        continue
      }
      if (!/openai|chatgpt|验证码|代码|verification|code/i.test(text)) {
        lastMessage = "跳过非验证码邮件"
        continue
      }
      if (!includesTargetEmail(text)) {
        lastMessage = `跳过非当前账号邮件（目标 ${targetEmail}）`
        continue
      }
      let code = extractVerificationCode(text)
      if (!code) {
        code = await openMailAndReadCode(item)
      }
      if (!code) {
        lastMessage = "候选邮件未提取到验证码"
        continue
      }
      if (excludeCodes.has(code) || seenCodes.has(code)) {
        lastMessage = `跳过已处理验证码 ${code}`
        continue
      }
      seenCodes.add(code)
      return {
        ok: true,
        code,
        message: `已在 163 邮箱读取验证码 ${code}`
      }
    }
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
