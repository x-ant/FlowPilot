import type { PageActionResult } from "./types"

export type ExtractCodexOAuthUrlResult = {
  ok: boolean
  message: string
  authUrl?: string
}

export type DetectCpaOAuthStartState = "ready" | "started" | "unknown"

export type DetectCpaOAuthStartStateResult = {
  ok: boolean
  state: DetectCpaOAuthStartState
  message: string
  buttonText?: string
  authUrl?: string
  url: string
}

export type DetectCodexAuthPageState =
  | "oauth_consent_ready"
  | "verification_invalid_code"
  | "verification_pending"
  | "password"
  | "extra_verification"
  | "other"

export type DetectCodexAuthPageStateResult = {
  ok: boolean
  state: DetectCodexAuthPageState
  message: string
  url: string
  buttonText?: string
}

export type PageActionField = {
  selectors: string[]
  value: string
  allowSplitInput?: boolean
  optional?: boolean
}

export type PageActionButton = {
  texts?: string[]
  selectors?: string[]
  /**
   * 触发按钮的方式；不传时默认使用普通 click。
   *
   * @default "click"
   */
  triggerMode?: "auto" | "click" | "requestSubmit"
}

export type PageActionConfig = {
  fields?: PageActionField[]
  button?: PageActionButton
  timeoutMs: number
  successMessage: string
  failureMessage: string
}

/**
 * 从管理页读取已经生成的 OpenAI OAuth 授权链接。
 *
 * 这里不点击“打开链接”按钮，是因为脚本触发的页面按钮点击可能没有真实用户手势，
 * 页面内部 window.open 容易被浏览器弹窗拦截；由扩展拿到 URL 后用 chrome.tabs.create
 * 主动打开标签页更稳定。
 *
 * @return 读取到的授权链接和执行状态。
 */
export const extractCodexOAuthUrlInPage = (): ExtractCodexOAuthUrlResult => {
  const authUrlPrefix = "https://auth.openai.com/oauth/authorize"

  /**
   * 校验并规范化授权 URL。
   *
   * @param value 待校验的 URL 字符串。
   * @return 合法授权 URL；非法时返回 undefined。
   */
  const normalizeAuthUrl = (value?: string) => {
    try {
      const parsed = new URL(String(value || "").trim())
      if (parsed.origin !== "https://auth.openai.com") {
        return undefined
      }

      if (parsed.pathname !== "/oauth/authorize") {
        return undefined
      }

      return parsed.href
    } catch {
      return undefined
    }
  }

  // 先看有没有符合的外链标签
  const link = document.querySelector(
    `a[href^="${authUrlPrefix}"]`
  ) as HTMLAnchorElement | null
  const hrefAuthUrl = normalizeAuthUrl(link?.href)
  if (hrefAuthUrl) {
    return {
      ok: true,
      message: "已读取授权链接",
      authUrl: hrefAuthUrl
    }
  }

  // 没有符合的外链标签就遍历全部的文本标签
  const walker = document.createTreeWalker(
    // 从 body 开始扫；没有 body 就从 html 开始扫
    document.body || document.documentElement,
    // 只遍历文本节点，不会返回<div>、<p>、<a>、button
    NodeFilter.SHOW_TEXT
  )
  let current = walker.nextNode()

  while (current) {
    const text = String(current.textContent || "").trim()
    const match = text.match(
      /https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/
    )
    const textAuthUrl = normalizeAuthUrl(match?.[0])
    if (textAuthUrl) {
      return {
        ok: true,
        message: "已读取授权链接",
        authUrl: textAuthUrl
      }
    }

    current = walker.nextNode()
  }

  return {
    ok: false,
    message: "未找到授权链接，请确认页面已经生成 OpenAI 授权链接"
  }
}

/**
 * 判断 CPA OAuth 页面在 Step 1 开始前是否处于可点击或已点击后的状态。
 *
 * ready：页面上能看到“登录另一个账号”或“开始 Codex 登录”；
 * started：已经生成 OpenAI 授权链接，说明“开始 Codex 登录”已经被点过。
 *
 * @return CPA OAuth 页面当前状态。
 */
export const detectCpaOAuthStartStateInPage =
  (): DetectCpaOAuthStartStateResult => {
    const authUrlPrefix = "https://auth.openai.com/oauth/authorize"
    const normalizeText = (value: string) => {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
    }

    const normalizeAuthUrl = (value?: string) => {
      try {
        const parsed = new URL(String(value || "").trim())
        if (
          parsed.origin !== "https://auth.openai.com" ||
          parsed.pathname !== "/oauth/authorize"
        ) {
          return undefined
        }

        return parsed.href
      } catch {
        return undefined
      }
    }

    const findAuthUrl = () => {
      const link = document.querySelector(
        `a[href^="${authUrlPrefix}"]`
      ) as HTMLAnchorElement | null
      const hrefAuthUrl = normalizeAuthUrl(link?.href)
      if (hrefAuthUrl) {
        return hrefAuthUrl
      }

      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT
      )
      let current = walker.nextNode()
      while (current) {
        const text = String(current.textContent || "").trim()
        const match = text.match(
          /https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/
        )
        const textAuthUrl = normalizeAuthUrl(match?.[0])
        if (textAuthUrl) {
          return textAuthUrl
        }

        current = walker.nextNode()
      }

      return undefined
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

    const isEnabled = (element: Element | null) => {
      const htmlElement = element as HTMLElement | null
      return Boolean(
        htmlElement &&
          isVisible(htmlElement) &&
          !(htmlElement as HTMLButtonElement).disabled &&
          htmlElement.getAttribute("aria-disabled") !== "true"
      )
    }

    const getActionText = (element: Element | null) => {
      const htmlElement = element as HTMLElement | null
      return normalizeText(
        [
          htmlElement?.textContent,
          (htmlElement as HTMLInputElement | null)?.value,
          htmlElement?.getAttribute?.("aria-label"),
          htmlElement?.getAttribute?.("title")
        ]
          .filter(Boolean)
          .join(" ")
      )
    }

    const readyButton = Array.from(
      document.querySelectorAll(
        "button, a, [role='button'], input[type='button'], input[type='submit']"
      )
    ).find((element) => {
      return (
        isEnabled(element) &&
        /登录另一个账号|开始\s*codex\s*登录/i.test(getActionText(element))
      )
    })

    if (readyButton) {
      return {
        ok: true,
        state: "ready",
        message: "CPA OAuth 页面可开始新的 Codex 登录",
        buttonText: getActionText(readyButton),
        url: location.href
      }
    }

    const authUrl = findAuthUrl()
    if (authUrl) {
      return {
        ok: true,
        state: "started",
        message: "CPA OAuth 页面已经生成授权链接，需要刷新后重新开始",
        authUrl,
        url: location.href
      }
    }

    return {
      ok: false,
      state: "unknown",
      message: "未确认 CPA OAuth 页面是否可开始新的 Codex 登录",
      url: location.href
    }
  }

/**
 * 判断当前 OpenAI 授权页所处的认证状态。
 *
 * 这个函数用于 Step 2/Step 3 的页面状态确认：验证码提交后可能会跳转到
 * OAuth 授权确认页，也可能仍停留在验证码页并显示错误。
 *
 * @return 当前认证页状态检测结果。
 */
export const detectCodexAuthPageStateInPage =
  (): DetectCodexAuthPageStateResult => {
    const normalizeText = (value: string) => {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
    }
    const pageText = normalizeText(
      document.body?.innerText || document.body?.textContent || ""
    )
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
    const isEnabled = (element: Element | null) => {
      const htmlElement = element as HTMLElement | null
      return Boolean(
        htmlElement &&
          isVisible(htmlElement) &&
          !(htmlElement as HTMLButtonElement).disabled &&
          htmlElement.getAttribute("aria-disabled") !== "true"
      )
    }
    const getActionText = (element: Element | null) => {
      const htmlElement = element as HTMLElement | null
      return normalizeText(
        [
          htmlElement?.textContent,
          (htmlElement as HTMLInputElement | null)?.value,
          htmlElement?.getAttribute?.("aria-label"),
          htmlElement?.getAttribute?.("title")
        ]
          .filter(Boolean)
          .join(" ")
      )
    }
    const consentForm = document.querySelector(
      'form[action*="/sign-in-with-chatgpt/" i][action*="/consent" i]'
    )
    const buttonSelectors = consentForm
      ? "button[type='submit'], input[type='submit'], [role='button']"
      : "button, input[type='submit'], [role='button']"
    const buttonScope = consentForm || document
    const continueButton = Array.from(
      buttonScope.querySelectorAll(buttonSelectors)
    ).find((element) => {
      return (
        isEnabled(element) &&
        /继续|continue|続行|続ける|次へ/i.test(getActionText(element))
      )
    }) as HTMLElement | undefined

    const verificationCodeInput = Array.from(
      document.querySelectorAll(
        "input[name='code'], input[name='otp'], input[autocomplete='one-time-code'], input[inputmode='numeric'], input[type='text'][maxlength='6'], input[type='tel'][maxlength='6']"
      )
    ).find((element) => {
      return isVisible(element)
    })
    const verificationForm = document.querySelector(
      'form[action*="email-verification" i]'
    )
    const resendAction = Array.from(
      document.querySelectorAll("button, a, [role='button']")
    ).find((element) => {
      return (
        isVisible(element) &&
        /重新发送电子邮件|重新发送验证码|resend|send again|再送信/i.test(
          getActionText(element)
        )
      )
    })
    const invalidVerificationCodePattern =
      /代码不正确|验证码不正确|验证码错误|验证码无效|无效的验证码|code\s+(?:is\s+)?incorrect|incorrect\s+code|invalid\s+code|wrong\s+code|try\s+again|コードが正しくありません|無効なコード|認証コードが正しくありません/i
    const verificationPage =
      Boolean(verificationForm) ||
      Boolean(resendAction) ||
      Boolean(verificationCodeInput) ||
      /\/email-verification(?:[/?#]|$)/i.test(location.href)
    const passwordInput = document.querySelector(
      "input[type='password'], input[autocomplete='current-password'], input[name='password']"
    )
    const passwordPage =
      /\/password(?:[/?#]|$)/i.test(location.href) ||
      (Boolean(passwordInput) &&
        /password|密码|sign\s+in|log\s+in|继续|下一步/i.test(pageText))
    const addPhonePage =
      /add[\s-]*(?:a\s+)?phone|添加(?:手机|手机号|电话号码)|验证(?:你的|您)?(?:手机|手机号|电话号码)|phone\s+number|verify\s+(?:your\s+)?phone/i.test(
        pageText
      )
    const addEmailPage =
      /add[\s-]*email|添加(?:电子邮件|邮箱)|provide\s+(?:an?\s+)?email\s+address|email\s+address\s+required/i.test(
        pageText
      )
    const oauthConsentPage =
      Boolean(consentForm) ||
      /\/sign-in-with-chatgpt\/[^/?#]+\/consent(?:[/?#]|$)/i.test(
        location.pathname
      )

    if (verificationPage && invalidVerificationCodePattern.test(pageText)) {
      return {
        ok: false,
        state: "verification_invalid_code",
        message: "验证码提交后页面提示验证码不正确",
        url: location.href
      }
    }

    if (verificationPage) {
      return {
        ok: false,
        state: "verification_pending",
        message: "当前仍在邮箱验证码页",
        url: location.href
      }
    }

    if (passwordPage) {
      return {
        ok: false,
        state: "password",
        message: "当前仍在密码页",
        url: location.href
      }
    }

    if (addPhonePage || addEmailPage) {
      return {
        ok: false,
        state: "extra_verification",
        message: "当前进入了额外验证/补充信息页面，不是 OAuth 授权确认页",
        url: location.href
      }
    }

    if (!oauthConsentPage) {
      return {
        ok: false,
        state: "other",
        message: "当前页面还不像 Codex OAuth 授权确认页",
        url: location.href
      }
    }

    if (!continueButton) {
      return {
        ok: false,
        state: "other",
        message: "OAuth 授权确认页还没有可点击的继续按钮",
        url: location.href
      }
    }

    return {
      ok: true,
      state: "oauth_consent_ready",
      message: "OAuth 授权确认页已就绪",
      url: location.href,
      buttonText: getActionText(continueButton)
    }
  }

/**
 * 在目标网页中执行一次页面动作。只负责动作，不负责等待
 *
 * 这个函数会被注入到目标网页里执行，因此只能使用页面环境里可用的 DOM API。
 * 它同时支持三类动作：
 * - 只点击按钮
 * - 先填写一个或多个输入框，再点击按钮
 * - 只填写输入框
 *
 * @param action 页面动作配置。
 * @return 执行结果和提示信息。
 */
export const performPageActionInPage = (
  action: PageActionConfig
): Promise<PageActionResult> => {
  return new Promise((resolve) => {
    const startedAt: number = Date.now()

    /**
     * 统一文本格式，去掉空白并转小写，提升匹配命中率。
     *
     * @param value 原始文本。
     * @return 规范化后的文本。
     */
    function normalizeText(value: string) {
      return value.replace(/\s+/g, "").toLowerCase()
    }

    /**
     * 读取候选元素的可见文本和辅助属性，兼容普通按钮、图标按钮和 input 按钮。
     *
     * @param element 页面上的候选元素。
     * @return 用于匹配的元素文本。
     */
    const getElementText = (element: Element) => {
      const inputValue =
        element instanceof HTMLInputElement ? element.value : ""

      return normalizeText(
        [
          inputValue,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
      )
    }

    /**
     * 跳过明显不可点击的元素，避免误点禁用态按钮。
     *
     * @param element 页面上的候选元素。
     * @return 如果元素明显不可点击则返回 true。
     */
    const isUnavailable = (element: Element) => {
      const htmlElement = element as HTMLElement
      const rect = htmlElement.getBoundingClientRect()

      return (
        rect.width <= 0 ||
        rect.height <= 0 ||
        Boolean((element as HTMLButtonElement).disabled) ||
        htmlElement.getAttribute("aria-disabled") === "true" ||
        htmlElement.style.pointerEvents === "none"
      )
    }

    /**
     * 在候选元素里查找文案匹配的按钮。
     *
     * @return 匹配到的按钮元素；如果没有找到则返回 undefined。
     */
    const findButton = () => {
      if (!action.button) {
        return undefined
      }

      const targetButtonTextArray = (action.button.texts || []).map(
        (buttonText) => {
          return normalizeText(buttonText)
        }
      )

      const buttonSelector = (
        action.button.selectors && action.button.selectors.length > 0
          ? action.button.selectors
          : [
              "button",
              "a",
              "[role='button']",
              "input[type='button']",
              "input[type='submit']"
            ]
      ).join(",")

      // 取第一个符合条件的按钮
      return Array.from(document.querySelectorAll(buttonSelector)).find(
        (element) => {
          if (isUnavailable(element)) {
            return false
          }

          if (targetButtonTextArray.length === 0) {
            return true
          }

          const currentElementText = getElementText(element)
          return targetButtonTextArray.some((targetButtonText) => {
            return currentElementText.includes(targetButtonText)
          })
        }
      ) as HTMLElement | undefined
    }

    /**
     * 在页面里尝试定位输入框。
     *
     * @param field 表单字段配置。
     * @return 找到时返回输入框，否则返回 undefined。
     */
    const findInput = (field: PageActionField) => {
      for (const selector of field.selectors) {
        const matched = Array.from(document.querySelectorAll(selector)).find(
          (element) => {
            const input = element as HTMLInputElement
            const rect = input.getBoundingClientRect()

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              !input.disabled &&
              input.type !== "hidden"
            )
          }
        ) as HTMLInputElement | undefined

        if (matched) {
          return matched
        }
      }

      return undefined
    }

    /**
     * 查找分格验证码输入框。
     *
     * 至少 6 个 maxlength=1 的可见输入框，才能当作分格验证码，
     * maxlength=1 代表 最多只能输入 1 个字符
     *
     * 这样可以避免普通表单里多个输入框被误判。
     *
     * @return 按页面顺序排列的可见输入框列表。
     */
    const findSplitInputs = () => {
      const inputs = Array.from(
        document.querySelectorAll("input[maxlength='1']")
      ).filter((element) => {
        const input = element as HTMLInputElement
        const rect = input.getBoundingClientRect()

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !input.disabled &&
          input.type !== "hidden"
        )
      }) as HTMLInputElement[]

      return inputs.length >= 6 ? inputs : []
    }

    /**
     * 安全地把值写入输入框，并触发 React / 原生表单监听器。
     *
     * @param input 目标输入框。
     * @param value 要写入的文本。
     * @return 无。
     */
    const setInputValue = (input: HTMLInputElement, value: string) => {
      const prototype = HTMLInputElement.prototype
      const valueSetter = Object.getOwnPropertyDescriptor(
        prototype,
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

    /**
     * 填写一个字段，兼容普通输入框和分格验证码输入框。
     *
     * @param field 字段填写配置。
     * @return 填写结果和可用于关联表单的输入框。
     */
    const fillField = (field: PageActionField) => {
      if (field.allowSplitInput) {
        const splitInputs = findSplitInputs()
        if (splitInputs.length > 1 && field.value.length > 1) {
          const characters = Array.from(field.value)
          const fillLength = Math.min(splitInputs.length, characters.length)

          for (let index = 0; index < fillLength; index += 1) {
            const splitInput = splitInputs[index]
            setInputValue(splitInput, characters[index])

            try {
              splitInput.dispatchEvent(
                new KeyboardEvent("keyup", {
                  key: characters[index],
                  bubbles: true
                })
              )
            } catch {
              // Best effort only.
            }
          }

          splitInputs[0].focus()
          return {
            ok: true,
            input: splitInputs[0],
            hasFilledSplitInput: true
          }
        }
      }

      const input = findInput(field)
      if (!input) {
        return {
          ok: false,
          input: undefined,
          hasFilledSplitInput: false
        }
      }

      setInputValue(input, field.value)
      input.focus()

      return {
        ok: true,
        input,
        hasFilledSplitInput: false
      }
    }

    /**
     * 批量填写字段，并记录可用于关联表单的输入框。
     *
     * @return 字段填写结果。
     */
    const fillFields = () => {
      const fields = action.fields || []
      const filledInputs: HTMLInputElement[] = []
      let hasFilledSplitInput = false

      for (const field of fields) {
        const fillResult = fillField(field)
        if (!fillResult.ok) {
          if (field.optional) {
            continue
          }

          return {
            ok: false,
            filledInputs,
            hasFilledSplitInput
          }
        }

        if (fillResult.input) {
          filledInputs.push(fillResult.input)
        }

        hasFilledSplitInput =
          hasFilledSplitInput || fillResult.hasFilledSplitInput
      }

      return {
        ok: true,
        filledInputs,
        hasFilledSplitInput
      }
    }

    /**
     * 根据按钮和已填写的输入框，寻找最适合触发提交的表单。
     *
     * @param formAnchorInput 已填写的第一个输入框，用于反查所在表单。
     * @return 按钮、按钮直属表单和最终可用表单。
     */
    const getButtonActionContext = (formAnchorInput?: HTMLInputElement) => {
      const button = findButton() as
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLAnchorElement
        | undefined
      const buttonForm =
        button instanceof HTMLButtonElement ||
        button instanceof HTMLInputElement
          ? button.form
          : null
      const form: HTMLFormElement | null =
        buttonForm ||
        formAnchorInput?.form ||
        (button?.closest?.("form") as HTMLFormElement | null) ||
        (formAnchorInput?.closest?.("form") as HTMLFormElement | null) ||
        null

      return {
        button,
        buttonForm,
        form
      }
    }

    /**
     * 读取实际触发按钮的文字，方便日志里展示。
     *
     * @param button 被点击或用于提交的按钮。
     * @return 按钮文字。
     */
    const getButtonText = (button?: HTMLElement) => {
      if (!button) {
        return ""
      }

      return [
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("title")
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
    }

    /**
     * 按指定策略执行按钮动作。
     *
     * requestSubmit 和 auto 都优先走表单提交；如果页面没有可提交表单，
     * 再退回普通点击。click 则反过来，优先点击按钮，再用表单提交兜底。
     *
     * @param button 被点击或用于提交的按钮。
     * @param buttonForm 按钮元素直属的表单。
     * @param form 当前动作最终关联到的表单。
     * @return 成功触发点击或提交时返回 true，否则返回 false。
     */
    const performButtonAction = (
      button: HTMLElement | undefined,
      buttonForm: HTMLFormElement | null,
      form: HTMLFormElement | null
    ) => {
      const triggerMode = action.button?.triggerMode || "click"

      /**
       * 表单提交，必须有表单，表单必须有提交方法requestSubmit
       */
      const requestSubmit = () => {
        if (!form || typeof form.requestSubmit !== "function") {
          return false
        }

        // 表单和按钮是一套
        if (buttonForm === form && button) {
          form.requestSubmit(button)
        } else {
          form.requestSubmit()
        }

        return true
      }

      const clickButton = () => {
        if (!button || typeof button.click !== "function") {
          return false
        }

        button.click()
        return true
      }

      // requestSubmit 和 auto 都优先走表单提交，click 先尝试点击后提交。
      if (triggerMode === "click") {
        return clickButton() || requestSubmit()
      } else {
        return requestSubmit() || clickButton()
      }
    }

    /**
     * 先执行输入框填写，再按需查找并点击按钮。
     *
     * @return 如果已经完成填写和点击，则返回 true；否则返回 false。
     */
    const tryExecute = () => {
      const fillResult = fillFields()
      if (!fillResult.ok) {
        return false
      }

      // 没有按钮得动作就结束了
      if (!action.button) {
        resolve({
          ok: true,
          message: action.successMessage,
          buttonText: ""
        })
        return true
      }

      const { button, buttonForm, form } = getButtonActionContext(
        fillResult.filledInputs[0]
      )

      // 分格验证码填完以后，页面可能会自动提交或自动跳转，可以没有按钮和表单。
      if (!button && !form) {
        if (fillResult.hasFilledSplitInput) {
          resolve({
            ok: true,
            message: action.successMessage,
            buttonText: ""
          })
          return true
        }

        return false
      }

      if (!performButtonAction(button, buttonForm, form)) {
        return false
      }

      resolve({
        ok: true,
        message: action.successMessage,
        buttonText: getButtonText(button)
      })
      return true
    }

    if (tryExecute()) {
      return
    }

    /**
     * 页面可能是异步渲染的，所以用短轮询等待输入框和按钮出现。
     *
     * @return 无。
     */
    const intervalId = window.setInterval(() => {
      if (tryExecute()) {
        clearInterval(intervalId)
        return
      }

      if (Date.now() - startedAt >= action.timeoutMs) {
        clearInterval(intervalId)
        resolve({
          ok: false,
          message: action.failureMessage
        })
      }
    }, 300)
  })
}
