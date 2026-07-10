export type EnsureMail2925SessionPayload = {
  email: string
  password: string
}

type Mail2925PageKind = "mailbox" | "login" | "site" | "other"

export type EnsureMail2925SessionResult = {
  ok: boolean
  message: string
}

/**
 * 在 2925 页面里确认登录态；未登录时填写账号密码并登录。
 *
 * 这个函数会被注入到 2925 页面中执行，所以内部依赖的 DOM 工具函数必须保持自包含。
 *
 * @param payload 2925 邮箱账号和密码。
 * @return 登录态确认结果。
 */
export const ensureMail2925SessionInPage = async (
  payload: EnsureMail2925SessionPayload
): Promise<EnsureMail2925SessionResult> => {
  const email = String(payload?.email || "").trim()
  const password = String(payload?.password || "")
  const wait = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs)
    })
  }
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
  }
  const getPageKind = (): Mail2925PageKind => {
    const hostname = location.hostname.toLowerCase()
    if (hostname !== "2925.com" && hostname !== "www.2925.com") {
      return "other"
    }

    if (
      location.hash === "#/mailList" ||
      location.hash.startsWith("#/mailList?")
    ) {
      return "mailbox"
    }

    if (location.pathname.replace(/\/+$/, "") === "/login") {
      return "login"
    }

    return "site"
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
          if (
            !isVisible(htmlElement) ||
            (htmlElement as HTMLButtonElement).disabled
          ) {
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

      return (
        isVisible(htmlElement) &&
        /我已阅读并同意|服务协议|隐私政策/.test(contextText)
      )
    }) as HTMLElement | undefined
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const pageKind = getPageKind()

    if (pageKind === "mailbox") {
      return {
        ok: true,
        message: "2925 邮箱已处于收件箱"
      }
    }

    if (pageKind !== "login") {
      await wait(500)
      continue
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
        if (getPageKind() === "mailbox") {
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
    message: "当前不是 2925 登录页或收件箱"
  }
}
