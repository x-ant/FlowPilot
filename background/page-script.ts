import type { ClickPageButtonResult } from "./types";

export type ExtractOpenaiOAuthAuthorizeUrlResult = {
  ok: boolean
  message: string
  authUrl?: string
}

export type PageActionByTextsOptions = {
  targetTexts: string[]
  timeoutMs: number
  successMessage: string
  failureMessage: string
  submitStrategy?: "auto" | "click" | "requestSubmit"
}

export type PageActionByTextsArgs = {
  inputSelectors?: string[]
  inputValue?: string
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
export const extractOpenaiOAuthAuthorizeUrlInPage =
  (): ExtractOpenaiOAuthAuthorizeUrlResult => {
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
      message: "未找到授权链接，请先执行步骤 1 并确认授权链接已生成"
    }
  }

/**
 * 在目标网页中按文案查找元素，并按需先填写输入框、再点击按钮。
 *
 * 这个函数会被注入到目标网页里执行，因此只能使用页面环境里可用的 DOM API。
 * 它同时支持两类动作：
 * - 只点击按钮
 * - 先填写输入框，再点击按钮
 *
 * @param options 页面动作配置。
 * @return 执行结果和提示信息。
 */
export const performPageActionByTextsInPage = (
  options: PageActionByTextsOptions,
  args: PageActionByTextsArgs = {}
): Promise<ClickPageButtonResult> => {
  return new Promise((resolve) => {
    const startedAt: number = Date.now()
    const targetTextArray: string[] = options.targetTexts.map((value) => {
      return normalizeText(value)
    })
    const candidateSelector =
      "button,a,[role='button'],input[type='button'],input[type='submit']"
    let usedSplitInputFill = false

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
      return (
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
      return Array.from(document.querySelectorAll(candidateSelector)).find(
        (element) => {
          if (isUnavailable(element)) {
            return false
          }

          const text = getElementText(element)
          return targetTextArray.some((targetText) => {
            return text.includes(targetText)
          })
        }
      ) as HTMLElement | undefined
    }

    /**
     * 在页面里尝试定位输入框。
     *
     * @return 找到时返回输入框，否则返回 undefined。
     */
    const findInput = () => {
      const selectorList = args.inputSelectors || []

      for (const selector of selectorList) {
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
     * 先执行输入框填写，再查找并点击按钮。
     *
     * @return 如果已经完成填写和点击，则返回 true；否则返回 false。
     */
    const tryExecute = () => {
      let input: HTMLInputElement | undefined

      if (typeof args.inputValue === "string") {
        const splitInputs = findSplitInputs()
        if (splitInputs.length > 1 && args.inputValue.length > 1) {
          const characters = Array.from(args.inputValue)
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

          input = splitInputs[0]
          input.focus()
          usedSplitInputFill = true
        } else {
          input = findInput()
          if (!input) {
            return false
          }

          setInputValue(input, args.inputValue)
          input.focus()
        }
      }

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
        input?.form ||
        (button?.closest?.("form") as HTMLFormElement | null) ||
        (input?.closest?.("form") as HTMLFormElement | null) ||
        null

      if (!button && !form) {
        if (usedSplitInputFill) {
          resolve({
            ok: true,
            message: options.successMessage,
            buttonText: ""
          })
          return true
        }

        return false
      }

      const performSubmit = () => {
        const submitStrategy = options.submitStrategy || "click"
        if (
          submitStrategy === "requestSubmit" ||
          (submitStrategy === "auto" && form && "requestSubmit" in form)
        ) {
          if (form && typeof form.requestSubmit === "function") {
            if (buttonForm === form && button) {
              form.requestSubmit(button)
            } else {
              form.requestSubmit()
            }
            return true
          }
        }

        if (button && typeof button.click === "function") {
          button.click()
          return true
        }

        if (form && typeof form.requestSubmit === "function") {
          form.requestSubmit()
          return true
        }

        return false
      }

      if (!performSubmit()) {
        return false
      }

      const buttonText = button
        ? [
            button.textContent,
            button.getAttribute("aria-label"),
            button.getAttribute("title")
          ]
            .filter(Boolean)
            .join(" ")
            .trim()
        : ""

      resolve({
        ok: true,
        message: options.successMessage,
        buttonText
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

      if (Date.now() - startedAt >= options.timeoutMs) {
        clearInterval(intervalId)
        resolve({
          ok: false,
          message: options.failureMessage
        })
      }
    }, 300)
  })
}
