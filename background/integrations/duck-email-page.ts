export type FetchDuckEmailPayload = {
  previousEmail?: string
  generateNew?: boolean
}

export type FetchDuckEmailResult = {
  ok: boolean
  email: string
  generated: boolean
  message: string
}

/**
 * 在 DuckDuckGo Email Protection 页面里读取或生成私有 Duck 邮箱。
 *
 * 这个函数会被注入到 DuckDuckGo 页面执行，所以内部工具函数都保持自包含，
 * 不依赖扩展侧的模块导入。
 *
 * @param payload 页面执行参数。
 * @param payload.previousEmail 点击生成前表单里的邮箱，用于避免拿到旧地址。
 * @param payload.generateNew 是否点击页面生成按钮获取新地址。
 * @return Duck 邮箱读取结果，成功时包含 `@duck.com` 地址。
 */
export const fetchDuckEmailInPage = async (
  payload: FetchDuckEmailPayload
): Promise<FetchDuckEmailResult> => {
  const generateNew = payload?.generateNew !== false
  const previousEmail = String(payload?.previousEmail || "")
    .trim()
    .toLowerCase()
  const duckEmailPattern = /([a-z0-9._%+-]+@duck\.com)/i

  /**
   * 等待页面局部状态刷新。
   *
   * @param timeout 等待时间，单位毫秒。
   * @return 等待完成后 resolve 的 Promise。
   */
  const wait = (timeout: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, timeout)
    })
  }

  /**
   * 从任意文本里提取 Duck 邮箱。
   *
   * @param value 可能包含邮箱的文本。
   * @return 规范化后的 Duck 邮箱；未匹配时返回空字符串。
   */
  const normalizeDuckEmail = (value: unknown) => {
    const match = String(value || "")
      .trim()
      .match(duckEmailPattern)

    return match?.[1]?.toLowerCase() || ""
  }

  /**
   * 判断页面元素是否可见。
   *
   * @param element 要检测的 DOM 元素。
   * @return 元素存在且有可见尺寸时返回 true。
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
   * 从 DuckDuckGo 页面当前内容读取邮箱。
   *
   * @return 页面上展示的 Duck 邮箱；未找到时返回空字符串。
   */
  const readEmail = () => {
    const selectors = [
      "input.AutofillSettingsPanel__PrivateDuckAddressValue",
      "input[class*='PrivateDuckAddressValue']",
      "input[data-testid*='PrivateDuckAddressValue']",
      "input[value*='@duck.com' i]"
    ]

    for (const selector of selectors) {
      for (const input of Array.from(document.querySelectorAll(selector))) {
        const htmlInput = input as HTMLInputElement
        const email = normalizeDuckEmail(
          htmlInput.value ||
            htmlInput.getAttribute("value") ||
            htmlInput.textContent ||
            htmlInput.getAttribute("aria-label") ||
            htmlInput.getAttribute("title")
        )

        if (email) {
          return email
        }
      }
    }

    return normalizeDuckEmail(document.body?.innerText)
  }

  /**
   * 找到 DuckDuckGo 页面里的生成按钮。
   *
   * @return 可点击的生成按钮；未找到时返回 null。
   */
  const getGeneratorButton = () => {
    const pattern =
      /generate\s+private\s+duck\s+address|new\s+private\s+duck\s+address|generate\s+new|new\s+address|生成.*duck.*地址|生成.*私有.*地址|生成.*地址|新.*地址/i

    return (
      Array.from(
        document.querySelectorAll(
          "button.AutofillSettingsPanel__GeneratorButton, button, [role='button']"
        )
      ).find((element) => {
        const htmlElement = element as HTMLElement
        const text = [
          htmlElement.innerText,
          htmlElement.textContent,
          htmlElement.getAttribute("aria-label"),
          htmlElement.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")

        return isVisible(element) && pattern.test(text)
      }) || null
    )
  }

  /**
   * 等待页面邮箱从旧值变化到可用的新值。
   *
   * 因为 DuckDuckGo 页面生成邮箱时，DOM 可能有一个短暂刷新过程。页面文本可能一瞬间读到旧值、空值、临时值，或者刚更新但还没稳定。
   * 不要第一次看到新邮箱就立刻返回，至少连续两次读到同一个新邮箱，才认为它稳定可用。
   *
   * 第二次读到相同邮箱就会 stableCount = 2，就说明可以返回了
   * if (email === stableEmail) {
   *   stableCount += 1
   * }
   *
   * @param blockedEmails 不允许返回的旧邮箱列表。
   * @return 稳定读取到的新 Duck 邮箱；超时返回空字符串。
   */
  const waitForEmailChange = async (blockedEmails: string[]) => {
    const blocked = new Set(blockedEmails.filter(Boolean))
    let stableEmail = ""
    let stableCount = 0

    for (let index = 0; index < 100; index += 1) {
      const email = readEmail()

      if (email && !blocked.has(email)) {
        if (email === stableEmail) {
          stableCount += 1
        } else {
          stableEmail = email
          stableCount = 1
        }

        if (stableCount >= 2) {
          return email
        }
      }

      await wait(150)
    }

    return ""
  }

  for (let index = 0; index < 50; index += 1) {
    if (readEmail() || getGeneratorButton()) {
      break
    }

    await wait(300)
  }

  const currentEmail = readEmail()
  if (currentEmail && !generateNew) {
    return {
      ok: true,
      email: currentEmail,
      generated: false,
      message: `已读取 Duck 邮箱 ${currentEmail}`
    }
  }

  const button = getGeneratorButton()
  if (!button) {
    return {
      ok: false,
      email: "",
      generated: false,
      message: "未找到 Duck 邮箱生成按钮，请确认已登录 DuckDuckGo Email Protection"
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    ;(button as HTMLElement).click()
    const nextEmail = await waitForEmailChange(
      [currentEmail, previousEmail].filter(Boolean)
    )

    if (nextEmail) {
      return {
        ok: true,
        email: nextEmail,
        generated: true,
        message: `已生成 Duck 邮箱 ${nextEmail}`
      }
    }

    await wait(800)
  }

  return {
    ok: false,
    email: "",
    generated: false,
    message: "Duck 邮箱生成后地址未变化"
  }
}
