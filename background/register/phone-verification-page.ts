/**
 * 在手机号验证页面填入 HeroSMS 手机号并点击继续。
 *
 * 该函数会被 chrome.scripting.executeScript 注入目标页面执行，所以内部只能使用
 * 页面环境可用的 DOM API，不能依赖扩展上下文里的变量。
 *
 * @param phoneNumber HeroSMS 返回的完整手机号。
 * @param _countryLabel 侧边栏选择的国家展示名；当前保留参数用于兼容调用方。
 * @param _countryPhoneCode HeroSMS 返回的手机号区号；当前由页面根据完整号码自动识别国家。
 * @return 页面操作结果。
 */
export const submitPhoneNumberInPage = (
  phoneNumber: string,
  _countryLabel: string,
  _countryPhoneCode: number
): Promise<{ ok: boolean; message: string }> => {
  const phoneInputSelectors = [
    "input[type='tel']",
    "input[name*='phone' i]:not([type='hidden'])",
    "input[id*='phone' i]:not([type='hidden'])",
    "input[autocomplete='tel']",
    "input[placeholder*='phone' i]",
    "input[placeholder*='手机号']",
    "input[placeholder*='电话号码']",
    "input[aria-label*='phone' i]",
    "input[aria-label*='手机号']",
    "input[aria-label*='电话号码']"
  ]
  const continueButtonTexts = [
    "continue",
    "next",
    "submit",
    "sign up",
    "create account",
    "注册",
    "继续",
    "下一步",
    "提交"
  ]

  /**
   * 在页面脚本里等待一小段时间。
   *
   * @param timeoutMs 等待毫秒数。
   * @return 等待完成的 Promise。
   */
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
  }

  /**
   * 规范化按钮或国家选项文本，便于做宽松匹配。
   *
   * @param value 原始文本。
   * @return 去空白并转小写后的文本。
   */
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

  /**
   * 只保留字符串里的数字。
   *
   * @param value 原始文本。
   * @return 数字字符串。
   */
  const normalizeDigits = (value: string) => {
    return String(value || "").replace(/\D+/g, "")
  }

  /**
   * 判断元素是否在页面上可见。
   *
   * @param element 待检测元素。
   * @return 元素有尺寸且没有被 display/visibility 隐藏时返回 true。
   */
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

  /**
   * 判断按钮类元素是否可点击。
   *
   * @param element 待检测元素。
   * @return 可见且未 disabled 时返回 true。
   */
  const isEnabled = (element: Element | null) => {
    const htmlElement = element as HTMLElement | null
    return Boolean(
      htmlElement &&
        isVisible(htmlElement) &&
        !(htmlElement as HTMLButtonElement).disabled &&
        htmlElement.getAttribute("aria-disabled") !== "true"
    )
  }

  /**
   * 收集元素上可用于匹配按钮文案的文本。
   *
   * @param element 页面元素。
   * @return input value、textContent、aria-label 和 title 的组合文本。
   */
  const getElementText = (element: Element) => {
    const inputValue = element instanceof HTMLInputElement ? element.value : ""

    return [
      inputValue,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
  }

  /**
   * 以 React 可感知的方式设置 input 值。
   *
   * @param input 目标输入框。
   * @param value 要写入的值。
   */
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

  /**
   * 查找页面上的手机号输入框。
   *
   * @return 第一个可见且可编辑的手机号输入框。
   */
  const findPhoneInput = () => {
    for (const selector of phoneInputSelectors) {
      const input = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          const candidate = element as HTMLInputElement
          return (
            candidate instanceof HTMLInputElement &&
            candidate.type !== "hidden" &&
            !candidate.disabled &&
            isVisible(candidate)
          )
        }
      ) as HTMLInputElement | undefined

      if (input) {
        return input
      }
    }

    return undefined
  }

  /**
   * 查找手机号页继续按钮。
   *
   * @return 第一个文案匹配且可点击的按钮。
   */
  const findContinueButton = () => {
    const buttonTexts = continueButtonTexts.map(normalizeText)
    return Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='button'],input[type='submit']"
      )
    ).find((element) => {
      return (
        isEnabled(element) &&
        buttonTexts.some((text) => {
          return normalizeText(getElementText(element)).includes(text)
        })
      )
    }) as HTMLElement | undefined
  }

  /**
   * 点击继续按钮。
   *
   * 这里优先模拟真实点击，保证页面挂在按钮 click 上的校验和通道逻辑会执行。
   *
   * @param button 继续按钮。
   */
  const clickButton = (button: HTMLElement) => {
    button.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    )
  }

  return (async () => {
    const startedAt = Date.now()
    let phoneInput: HTMLInputElement | undefined

    while (Date.now() - startedAt < 15000) {
      phoneInput = findPhoneInput()
      if (phoneInput) {
        break
      }

      await waitForDelay(300)
    }

    if (!phoneInput) {
      return {
        ok: false,
        message: "未找到手机号输入框"
      }
    }

    const digits = normalizeDigits(phoneNumber)
    setInputValue(phoneInput, `+${digits}`)
    phoneInput.focus()

    const hiddenInput = Array.from(
      (phoneInput.form || document).querySelectorAll(
        "input[name*='phone' i][type='hidden'],input[name='phoneNumber']"
      )
    ).find((element) => {
      return element !== phoneInput
    }) as HTMLInputElement | undefined
    if (hiddenInput) {
      setInputValue(hiddenInput, `+${digits}`)
    }

    await waitForDelay(300)
    const button = findContinueButton()
    if (!button) {
      return {
        ok: false,
        message: "未找到手机号页继续按钮"
      }
    }

    clickButton(button)

    return {
      ok: true,
      message: `已填写手机号 +${digits}，已点击继续`
    }
  })()
}
