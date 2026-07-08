import { createCodexLoginRunner } from "./codex-login";
import { createMail2925Runner } from "./mail-2925";
import { detectCodexAuthPageStateInPage } from "./page-script";
import { assertHeroSmsActivationCostWithinExpected, pollHeroSmsCode, requestHeroSmsActivation, setHeroSmsActivationStatus, submitPhoneNumberInPage, type HeroSmsActivation, type HeroSmsPhoneVerificationOptions } from "./register-phone-verification";
import { abortableSleep } from "./utils/abort";
import { clearOpenTabSiteStorageForUrls, clearSessionCookiesForUrls, clearSiteStorageInTab } from "./utils/browser-session-cleanup";
import { runPageActionInTab } from "./utils/page-action-runner";
import type { RunContext } from "./utils/run-context";
import { findOrOpenTab, waitForTabLoaded, waitForTabMatchingUrl } from "./utils/tab-utils";


const CHATGPT_SIGNUP_ENTRY_URL = "https://chatgpt.com/"
const OPENAI_SESSION_CLEANUP_URLS = [
  "https://auth.openai.com/",
  "https://auth0.openai.com/",
  "https://accounts.openai.com/",
  "https://openai.com/",
  "https://www.openai.com/",
  "https://chat.openai.com/",
  "https://chatgpt.com/",
  "https://www.chatgpt.com/"
]
const DEFAULT_REGISTER_FULL_NAME = "drizzle"
const DEFAULT_REGISTER_AGE = 20
const REGISTER_OAUTH_VALID_MS = 5 * 60 * 1000
/**
 * 预估一次返回获取新手机号，然后循环获取验证码的时间为140秒
 */
const REGISTER_PHONE_RETRY_MIN_REMAINING_MS = 140 * 1000

type CodexRegisterStepResponse = {
  ok: boolean
  message: string
  needRefreshOAuth?: boolean
  needsManualReview?: boolean
  oauthStartedAt?: number
  cpaOAuthState?: string
  callbackUrl?: string
  targetTab?: {
    id?: number
    url?: string
  }
}

type RegisterPhoneVerificationSubmitState = {
  ok: boolean
  state: string
  message: string
  url: string
  releaseActivation?: boolean
}

/**
 * 汇总 HeroSMS 买号结果里的扣费和号码信息。
 *
 * selectedPrice 是本地请求的固定价格档位，activationCost 是 HeroSMS 返回的实际成本；
 * 两者同时展示，方便核对真实扣费是否符合预期。
 *
 * @param activation HeroSMS getNumberV2 返回并规范化后的激活信息。
 * @return 可追加到注册日志里的简短描述。
 */
const formatHeroSmsActivationSummary = (activation: HeroSmsActivation) => {
  return [
    `订单 ${activation.activationId}`,
    activation.selectedPrice ? `请求档位 ${activation.selectedPrice}` : "",
    `实际成本 ${activation.activationCost}`,
    `币种 ${activation.currency}`,
    `运营商 ${activation.activationOperator}`,
    `国家码 ${activation.countryCode}`,
    `手机号区号 ${activation.countryPhoneCode}`,
    `结束时间 ${activation.activationEndTime}`
  ]
    .filter(Boolean)
    .join("，")
}

const isCodexOAuthCallbackUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return (
      /^https?:$/.test(url.protocol) &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/auth/callback"
    )
  } catch {
    return false
  }
}

const isChatGptPageUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return (
      url.protocol === "https:" &&
      ["chatgpt.com", "www.chatgpt.com"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

const isOpenAiAddPhoneUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return url.origin === "https://auth.openai.com" && url.pathname === "/add-phone"
  } catch {
    return false
  }
}

const isOpenAiPhoneVerificationUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return (
      url.origin === "https://auth.openai.com" &&
      url.pathname === "/phone-verification"
    )
  } catch {
    return false
  }
}

const isHeroSmsCodeTimeoutError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "")
  return /^等待手机验证码超时/.test(message)
}

const formatDurationSeconds = (ms: number) => {
  return `${Math.max(0, Math.floor(ms / 1000))} 秒`
}

const requestHistoryBackInPage = () => {
  if (window.history.length <= 1) {
    return {
      ok: false,
      message: "当前页面没有可回退的历史记录"
    }
  }

  window.history.back()
  return {
    ok: true,
    message: "已触发页面回退"
  }
}

const waitForPhoneInputInPage = async () => {
  const selectors = [
    "input[type='tel']",
    "input[name*='phone' i]:not([type='hidden'])",
    "input[id*='phone' i]:not([type='hidden'])",
    "input[autocomplete='tel']"
  ]
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
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
  const findPhoneInput = () => {
    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => {
        const input = element as HTMLInputElement
        return input instanceof HTMLInputElement && !input.disabled && isVisible(input)
      })
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000) {
    if (findPhoneInput()) {
      return {
        ok: true,
        message: "页面已回到手机号输入页"
      }
    }

    await waitForDelay(300)
  }

  return {
    ok: false,
    message: "回退后未等到手机号输入框"
  }
}

const getPhoneNumberSubmitFailureInPage = () => {
  const selectors = [
    "input[type='tel']",
    "input[name*='phone' i]:not([type='hidden'])",
    "input[id*='phone' i]:not([type='hidden'])",
    "input[autocomplete='tel']"
  ]
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
  const phoneInput = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .find((element) => {
      return element instanceof HTMLInputElement && isVisible(element)
    })
  const addPhoneForm =
    phoneInput?.closest("form") ||
    document.querySelector("form[action*='/add-phone' i]")
  const messages: string[] = []
  const errorSelectors = [
    ".react-aria-FieldError",
    "[slot='errorMessage']",
    "[id$='-error']",
    "[role='alert']",
    "[aria-live='assertive']",
    "[aria-live='polite']",
    "[data-invalid='true'] + *",
    "[aria-invalid='true'] + *",
    "[class*='error' i]",
    "[class*='danger' i]",
    "[class*='alert' i]"
  ]
  const pushText = (value: unknown) => {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
    if (text && !messages.includes(text)) {
      messages.push(text)
    }
  }

  errorSelectors.forEach((selector) => {
    addPhoneForm?.querySelectorAll(selector).forEach((element) => {
      pushText(element.textContent)
    })
  })

  const invalidInput = addPhoneForm?.querySelector(
    "input[aria-invalid='true'], input[data-invalid='true']"
  )
  if (invalidInput) {
    pushText(invalidInput.closest("form, [data-rac], div")?.textContent)
  }

  return {
    hasFailure: Boolean(phoneInput && messages.length > 0),
    message: messages[0] || ""
  }
}

/**
 * 静默取消 HeroSMS 激活订单。
 *
 * 买号请求失败时 activation 仍然为空，不能调用 setStatus；买号成功后的任意
 * 后续失败才需要尝试 status=8 取消并返还资金。取消失败不覆盖原始错误。
 *
 * @param options HeroSMS 接码配置。
 * @param activation 已创建的 HeroSMS 激活信息；为空时跳过。
 */
const releaseHeroSmsActivationQuietly = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation | null
) => {
  if (activation === null) {
    return
  }

  options.onLog?.(
    "info",
    `HeroSMS 正在取消激活订单 ${activation.activationId}，手机号 ${activation.phoneNumber}`
  )
  try {
    await setHeroSmsActivationStatus(options, activation, 8)
    options.onLog?.(
      "info",
      `HeroSMS 已取消激活订单 ${activation.activationId}，手机号 ${activation.phoneNumber}`
    )
  } catch {
    options.onLog?.(
      "warn",
      `HeroSMS 取消激活订单失败 ${activation.activationId}，手机号 ${activation.phoneNumber}；请稍后人工检查`
    )
    // 订单释放失败不覆盖原始错误。
  }
}

const SIGNUP_ENTRY_BUTTON_TEXTS = [
  "免费注册",
  "立即注册",
  "注册",
  "sign up",
  "register",
  "create account",
  "create an account",
  "アカウントを作成",
  "サインアップ",
  "新規登録"
]

const LOGIN_ENTRY_BUTTON_TEXTS = [
  "登录",
  "登入",
  "log in",
  "login",
  "sign in",
  "サインイン",
  "ログイン"
]

const OPENAI_EMAIL_INPUT_SELECTORS = [
  "input[type='email']",
  "input[autocomplete='email']",
  "input[name='email']",
  "input[name='username']",
  "input[autocomplete='username']",
  "input[id*='email' i]",
  "input[id*='username' i]",
  "input[placeholder*='email' i]",
  "input[placeholder*='username' i]",
  "input[placeholder*='电子邮件']",
  "input[placeholder*='邮箱']",
  "input[aria-label*='email' i]",
  "input[aria-label*='username' i]",
  "input[aria-label*='电子邮件']",
  "input[aria-label*='邮箱']"
]

const OPENAI_CONTINUE_BUTTON_TEXTS = [
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

const OPENAI_VERIFICATION_INPUT_SELECTORS = [
  "input[name='code']",
  "input[name='otp']",
  "input[autocomplete='one-time-code']",
  "input[type='text'][maxlength='6']",
  "input[type='tel'][maxlength='6']",
  "input[aria-label*='code' i]",
  "input[aria-label*='验证码']",
  "input[placeholder*='code' i]",
  "input[placeholder*='验证码']",
  "input[inputmode='numeric']"
]

const OPENAI_READY_CONTINUE_BUTTON_TEXTS = ["继续", "continue"]

const OPENAI_LOGIN_EMAIL_CONTINUE_BUTTON_TEXTS = [
  "continue",
  "next",
  "submit",
  "sign in",
  "log in",
  "登录",
  "继续",
  "下一步"
]

/**
 * 在 ChatGPT 注册资料页填写姓名和年龄/生日，并提交创建账户表单。
 *
 * 这个函数会被注入到目标页面执行，所以只使用页面上下文里的 DOM API。
 *
 * @param fullName 要填写到名称输入框的默认姓名。
 * @param age 用来推算生日年份的年龄。
 * @return 页面填写和提交结果。
 */
const submitRegisterProfileInPage = (
  fullName: string,
  age: number
): Promise<{ ok: boolean; message: string }> => {
  /**
   * 在页面上下文里等待一小段时间。
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
   * 统一页面文案，方便和中文/英文按钮文本做宽松匹配。
   *
   * @param value 原始页面文本。
   * @return 去空白并小写后的文本。
   */
  function normalizeText(value: string) {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

  /**
   * 读取元素上的可见文本和辅助属性文本。
   *
   * @param element 要识别的页面元素。
   * @return 规范化后的元素文本。
   */
  const getElementText = (element: Element) => {
    const inputValue = element instanceof HTMLInputElement ? element.value : ""

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
   * 判断元素是否不可见、禁用或不可点击。
   *
   * @param element 要检查的页面元素。
   * @return 不可操作时返回 true。
   */
  const isUnavailable = (element: Element) => {
    const htmlElement = element as HTMLElement
    const rect = htmlElement.getBoundingClientRect()
    const style = window.getComputedStyle(htmlElement)

    return (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Boolean((element as HTMLButtonElement).disabled) ||
      htmlElement.getAttribute("aria-disabled") === "true"
    )
  }

  /**
   * 轮询等待页面上出现目标元素或状态。
   *
   * @param getter 每次轮询执行的查找函数。
   * @param timeoutMs 最长等待时间。
   * @return 找到的值；超时返回 undefined。
   */
  const waitFor = async <T>(
    getter: () => T | undefined | Promise<T | undefined>,
    timeoutMs: number
  ) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const value = await getter()
      if (value) {
        return value
      }

      await waitForDelay(200)
    }

    return undefined
  }

  /**
   * 按选择器列表查找第一个可操作输入控件。
   *
   * @param selectors 候选 CSS 选择器。
   * @return 找到的输入控件；找不到返回 undefined。
   */
  const findInput = (selectors: string[]) => {
    for (const selector of selectors) {
      const matched = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          return !isUnavailable(element)
        }
      ) as HTMLElement | undefined

      if (matched) {
        return matched
      }
    }

    return undefined
  }

  /**
   * 用原生 setter 写入 input/select 的值，并派发 React 能感知的事件。
   *
   * @param input 要写入的输入框或下拉框。
   * @param value 要写入的值。
   */
  const setInputValue = (
    input: HTMLInputElement | HTMLSelectElement,
    value: string
  ) => {
    if (input instanceof HTMLSelectElement) {
      const optionValues = [
        value,
        String(Number(value)),
        value.padStart(2, "0")
      ]
      const option = Array.from(input.options).find((item) => {
        return (
          optionValues.includes(item.value) ||
          optionValues.includes(normalizeText(item.textContent || ""))
        )
      })

      input.value = option?.value || value
      if (option) {
        option.selected = true
      }
    } else {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set

      if (valueSetter) {
        valueSetter.call(input, value)
      } else {
        input.value = value
      }
    }

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  /**
   * 填写普通输入框、下拉框或 contenteditable 风格字段。
   *
   * @param element 要填写的页面元素。
   * @param value 要写入的值。
   */
  const fillField = async (element: HTMLElement, value: string) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      setInputValue(element, value)
      element.focus()
      return
    }

    element.focus()
    document.execCommand("selectAll", false)

    for (const character of value) {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new InputEvent("input", {
          inputType: "insertText",
          data: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: character,
          bubbles: true
        })
      )
      await waitForDelay(30)
    }

    element.textContent = value
    element.blur()
  }

  /**
   * 查找 React Aria Select 结构里的隐藏原生 select。
   *
   * @param labels 年/月/日等候选标签。
   * @return 匹配到的隐藏 select。
   */
  const findBirthdaySelect = (labels: string[]) => {
    const normalizedLabels = labels.map(normalizeText)

    return Array.from(document.querySelectorAll(".react-aria-Select"))
      .map((root) => {
        const hasLabel = Array.from(root.querySelectorAll("span")).some(
          (span) => {
            return normalizedLabels.includes(
              normalizeText(span.textContent || "")
            )
          }
        )
        const item = root.closest("[class*='selectItem']") || root.parentElement

        return hasLabel
          ? (item?.querySelector(
              '[data-testid="hidden-select-container"] select'
            ) as HTMLSelectElement | null)
          : null
      })
      .find(Boolean) as HTMLSelectElement | undefined
  }

  /**
   * 根据默认年龄推算可填写的生日值。
   *
   * @return 年、月、日和完整日期字符串。
   */
  const getBirthdayFromAge = () => {
    const year = String(
      new Date().getFullYear() - Math.floor(Number(age) || 20)
    )

    return {
      year,
      month: "01",
      day: "01",
      value: `${year}-01-01`
    }
  }

  /**
   * 兼容多种生日字段结构，优先填写显式年月日，其次写隐藏 birthday 字段。
   *
   * @return 成功填写的字段类型描述；找不到返回 undefined。
   */
  const fillBirthdayField = async () => {
    const birthday = getBirthdayFromAge()
    const hidden = document.querySelector(
      "input[name='birthday']"
    ) as HTMLInputElement | null
    const yearSelect = findBirthdaySelect(["年", "Year"])
    const monthSelect = findBirthdaySelect(["月", "Month"])
    const daySelect = findBirthdaySelect(["日", "天", "Day"])

    if (yearSelect && monthSelect && daySelect) {
      setInputValue(yearSelect, birthday.year)
      setInputValue(monthSelect, "1")
      setInputValue(daySelect, "1")
      return "生日下拉字段"
    }

    const year = findInput([
      "[role='spinbutton'][data-type='year']",
      "[role='spinbutton'][aria-label*='year' i]",
      "[role='spinbutton'][aria-label*='年']",
      "input[name='year']",
      "input[placeholder*='year' i]",
      "input[placeholder*='年']",
      "input[aria-label*='year' i]",
      "input[aria-label*='年']"
    ])
    const month = findInput([
      "[role='spinbutton'][data-type='month']",
      "[role='spinbutton'][aria-label*='month' i]",
      "[role='spinbutton'][aria-label*='月']",
      "input[name='month']",
      "input[placeholder*='month' i]",
      "input[placeholder*='月']",
      "input[aria-label*='month' i]",
      "input[aria-label*='月']"
    ])
    const day = findInput([
      "[role='spinbutton'][data-type='day']",
      "[role='spinbutton'][aria-label*='day' i]",
      "[role='spinbutton'][aria-label*='日']",
      "[role='spinbutton'][aria-label*='天']",
      "input[name='day']",
      "input[placeholder*='day' i]",
      "input[placeholder*='日']",
      "input[placeholder*='天']",
      "input[aria-label*='day' i]",
      "input[aria-label*='日']",
      "input[aria-label*='天']"
    ])

    if (year && month && day) {
      await fillField(year, birthday.year)
      await fillField(month, birthday.month)
      await fillField(day, birthday.day)
      if (hidden) {
        setInputValue(hidden, birthday.value)
      }
      return "生日输入字段"
    }

    if (hidden) {
      setInputValue(hidden, birthday.value)
      return "隐藏生日字段"
    }

    return undefined
  }

  /**
   * 查找资料页的创建账户/继续按钮。
   *
   * @return 可点击按钮元素。
   */
  const findButton = () =>
    Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='button'],input[type='submit']"
      )
    ).find((element) => {
      const currentElementText = getElementText(element)
      return (
        !isUnavailable(element) &&
        /完成账户创建|完成帐户创建|创建账户|createaccount|createanaccount|finish|done|continue|继续/.test(
          currentElementText
        )
      )
    }) as HTMLElement | undefined

  /**
   * 获取按钮所在表单，供 requestSubmit 使用。
   *
   * @return 按钮和表单上下文。
   */
  const getButtonActionContext = () => {
    const button = findButton()
    const buttonForm =
      button instanceof HTMLButtonElement || button instanceof HTMLInputElement
        ? button.form
        : null
    const form: HTMLFormElement | null =
      buttonForm || (button?.closest("form") as HTMLFormElement | null) || null

    return {
      button,
      buttonForm,
      form
    }
  }

  /**
   * 触发表单提交，优先直接点击按钮，失败时退回 requestSubmit。
   *
   * @param button 要点击的按钮。
   * @param buttonForm 按钮原生 form 引用。
   * @param form 最近的表单元素。
   * @return 是否成功触发提交动作。
   */
  const performButtonAction = (
    button: HTMLElement | undefined,
    buttonForm: HTMLFormElement | null,
    form: HTMLFormElement | null
  ) => {
    const clickButton = () => {
      if (!button || typeof button.click !== "function") {
        return false
      }

      button.click()
      return true
    }

    const requestSubmit = () => {
      if (!form || typeof form.requestSubmit !== "function") {
        return false
      }

      if (buttonForm === form && button) {
        form.requestSubmit(button)
      } else {
        form.requestSubmit()
      }

      return true
    }

    return clickButton() || requestSubmit()
  }

  return (async () => {
    const nameInput = await waitFor(() => {
      return findInput([
        "input[name='name']",
        "input[autocomplete='name']",
        "input[placeholder*='全名']",
        "input[placeholder*='姓名']",
        "input[placeholder*='name' i]",
        "input[aria-label*='全名']",
        "input[aria-label*='姓名']",
        "input[aria-label*='name' i]"
      ])
    }, 10000)

    if (!nameInput) {
      return {
        ok: false,
        message: "未找到名称输入框"
      }
    }

    await fillField(nameInput, fullName)

    const profileMode = await waitFor(async () => {
      const ageInput = findInput([
        "input[name='age']",
        "input[type='number']",
        "input[placeholder*='年龄']",
        "input[placeholder*='age' i]",
        "input[aria-label*='年龄']",
        "input[aria-label*='age' i]"
      ])
      if (ageInput) {
        await fillField(ageInput, String(age))
        return "年龄字段"
      }

      return fillBirthdayField()
    }, 10000)

    if (!profileMode) {
      return {
        ok: false,
        message: "未找到年龄或生日输入项"
      }
    }

    const buttonActionContext = await waitFor(() => {
      const context = getButtonActionContext()
      return context.button ? context : undefined
    }, 5000)
    if (!buttonActionContext) {
      return {
        ok: false,
        message: "未找到完成账户创建按钮"
      }
    }

    if (
      !performButtonAction(
        buttonActionContext.button,
        buttonActionContext.buttonForm,
        buttonActionContext.form
      )
    ) {
      return {
        ok: false,
        message: "未能触发完成账户创建按钮"
      }
    }

    return {
      ok: true,
      message: `已填写 ${fullName} 和${profileMode}并点击完成账户创建`
    }
  })()
}

/**
 * 检测注册邮箱是否已经提交到下一页。
 *
 * Step 2 重复执行时，页面可能已经进入密码页或验证码页；这种情况下不应把
 * “找不到邮箱输入框”当作失败。
 *
 * @return 已进入下一页时返回说明文案，否则返回空字符串。
 */
const detectRegisterEmailSubmittedInPage = () => {
  /**
   * 清理页面文本里的多余空白。
   *
   * @param value 原始页面文本。
   * @return 规范化后的页面文本。
   */
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
  }
  const pageText = normalizeText(
    document.body?.innerText || document.body?.textContent || ""
  )
  const passwordInput = document.querySelector(
    "input[type='password'], input[autocomplete='new-password'], input[autocomplete='current-password']"
  )
  const verificationInput = document.querySelector(
    "input[name='code'], input[name='otp'], input[autocomplete='one-time-code'], input[inputmode='numeric']"
  )

  if (passwordInput) {
    return "当前已进入密码页，第二步无需重复提交"
  }

  if (
    verificationInput ||
    /验证码|验证邮箱|检查您的收件箱|verification|check your inbox|enter the code/i.test(
      pageText
    )
  ) {
    return "当前已进入邮箱验证码页，第二步无需重复提交"
  }

  return ""
}

/**
 * 创建 codex-register 调试流程 runner。
 *
 * runner 中每个方法对应一个注册/登录原子步骤，侧边栏调试按钮直接调用这些方法。
 *
 * @param context 当前运行上下文，主要用于中断信号。
 * @return codex-register 各步骤的执行函数集合。
 */
export const createCodexRegisterRunner = (context: RunContext = {}) => {
  const { fetchMail2925VerificationCode } = createMail2925Runner(context)
  const {
    openCodexAuthLink,
    confirmCodexOAuthConsent,
    submitCodexOAuthCallbackToCpa
  } =
    createCodexLoginRunner(context)
  /**
   * 获取当前流程的中断信号。
   *
   * @return AbortSignal；没有传入时为 undefined。
   */
  const getAbortSignal = () => context.abortSignal

  /**
   * 如果流程已经被取消，立即抛出标准 AbortError。
   *
   * @throws DOMException 当运行上下文已被取消时抛出。
   */
  const throwIfRunAborted = () => {
    if (getAbortSignal()?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
  }

  /**
   * 等待手机验证码提交后的页面结果。
   *
   * 只把进入 localhost 回调当成成功；如果进入 OAuth 授权确认页，
   * 复用登录流程点击继续并等待回调；如果已经离开验证码页但不是回调页，
   * 停止自动重试，交给人工判断手机号是否已经验证完成。
   *
   * @param tabId 当前 OpenAI 授权页标签页 ID。
   * @return 页面状态检测结果。
   */
  const waitForPhoneVerificationSubmitState = async (
    tabId: number
  ): Promise<RegisterPhoneVerificationSubmitState> => {
    const startedAt = Date.now()
    let lastState = {
      ok: false,
      state: "other",
      message: "手机验证码提交后未确认页面状态",
      url: ""
    }

    while (Date.now() - startedAt < 45000) {
      throwIfRunAborted()

      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
      const currentUrl = String(currentTab?.url || "")
      if (isCodexOAuthCallbackUrl(currentUrl)) {
        return {
          ok: true,
          state: "callback",
          message: "手机验证码已通过，页面已跳转到 localhost 回调地址",
          url: currentUrl
        }
      }

      try {
        await waitForTabLoaded(tabId)
        const [detectResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectCodexAuthPageStateInPage
        })
        const detected = detectResult?.result
        lastState = {
          ok: Boolean(detected?.ok),
          state: detected?.state || "other",
          message: detected?.message || "未识别手机验证码提交后的页面状态",
          url: detected?.url || currentUrl
        }
      } catch (error) {
        lastState = {
          ok: false,
          state: "other",
          message:
            error instanceof Error
              ? error.message
              : "手机验证码提交后页面暂不可检测",
          url: currentUrl
        }
      }

      if (lastState.state === "oauth_consent_ready") {
        const consentResult = await confirmCodexOAuthConsent(tabId)
        if (consentResult.ok) {
          return {
            ok: true,
            state: "callback",
            message: `手机验证码已通过；${consentResult.message}`,
            url: consentResult.callbackUrl
          }
        }

        return {
          ...lastState,
          ok: false,
          releaseActivation: false,
          message: `手机验证码已通过并进入授权确认页，但未能完成授权继续：${consentResult.message}`
        }
      }

      if (lastState.state === "verification_invalid_code") {
        return {
          ...lastState,
          releaseActivation: true
        }
      }

      if (lastState.state !== "verification_pending") {
        return {
          ...lastState,
          ok: false,
          releaseActivation: false,
          message: `${lastState.message}；手机验证码提交后已离开验证码页，但还没有到 localhost 回调地址，请人工判断是否已验证成功`
        }
      }

      await abortableSleep(500, getAbortSignal())
    }

    return {
      ...lastState,
      ok: false,
      releaseActivation: lastState.state === "verification_pending",
      message: `${lastState.message}；45 秒内未确认手机验证码提交后的页面状态`
    }
  }

  /**
   * 手机验证码超时后回退到手机号输入页。
   *
   * 这里按用户要求使用浏览器历史回退，不直接跳转 /add-phone；如果历史栈无法
   * 回到手机号页，就交给外层重新执行 Step 5 刷新 OAuth。
   *
   * @param tabId 当前手机号验证码页标签页 ID。
   * @param canGoBack 回退保护回调；浏览器不允许读取 history 上一项，调用方可用闭包检查自己记录的 URL。
   * @return 是否重新看到手机号输入框。
   */
  const tryHistoryBackToPhoneInput = async (
    tabId: number,
    canGoBack: () => boolean = () => true
  ) => {
    if (!canGoBack()) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      return {
        ok: false,
        message: `当前页面状态不允许 history.back，已停止回退；当前 URL：${
          currentTab?.url || "unknown"
        }`
      }
    }

    const [backResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: requestHistoryBackInPage
    })
    const backValue = backResult?.result
    if (!backValue?.ok) {
      return {
        ok: false,
        message: backValue?.message || "触发页面回退失败"
      }
    }

    // 等待回退动作开始；requestHistoryBackInPage 返回时页面不一定已经切换。这时注入脚本可能失败
    await abortableSleep(1000, getAbortSignal())
    const [readyResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: waitForPhoneInputInPage
    })
    const readyValue = readyResult?.result
    return {
      ok: Boolean(readyValue?.ok),
      message: readyValue?.message || "未确认页面是否回到手机号输入页"
    }
  }

  /**
   * Step 1：清理 OpenAI/ChatGPT 旧会话并打开 GPT 注册入口页。
   *
   * @param reuseTabId 可选复用的标签页 ID；传入时会在该标签页打开入口页。
   * @return 打开入口页后的标签页信息。
   */
  const openChatGptRegisterEntry = async (
    reuseTabId?: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const cookieResult = await clearSessionCookiesForUrls(
      OPENAI_SESSION_CLEANUP_URLS
    )
    const storageResult = await clearOpenTabSiteStorageForUrls(
      OPENAI_SESSION_CLEANUP_URLS
    )
    // 打开；第 7 步 fallback 会传入当前 OAuth tab 复用 reuse 复用，其它入口保持原来的查找/打开行为。
    const tabId =
      typeof reuseTabId === "number"
        ? reuseTabId
        : await findOrOpenTab(CHATGPT_SIGNUP_ENTRY_URL)
    let currentTabStorageMessage = ""

    try {
      // 页面站点存储必须打开界面后注入清理，所以这里清理当前注册页 origin。
      const currentTabStorageResult = await clearSiteStorageInTab(tabId)
      currentTabStorageMessage = `；当前注册页已清理 ${currentTabStorageResult.localCount}/${currentTabStorageResult.sessionCount}/${currentTabStorageResult.indexedDbCount}/${currentTabStorageResult.cacheCount} 个 local/session/indexedDB/cache 项`
    } catch {
      currentTabStorageMessage = "；当前注册页站点存储清理失败，已继续打开页面"
    }

    // 再刷新一下，防止页面还是有缓存展示的状态
    await chrome.tabs.update(tabId, {
      active: true,
      url: CHATGPT_SIGNUP_ENTRY_URL
    })
    const tab = await chrome.tabs.get(tabId)

    return {
      ok: true,
      message: `${cookieResult.message}；${storageResult.message}${currentTabStorageMessage}；${
        typeof reuseTabId === "number"
          ? "已在当前 tab 打开 GPT 页面"
          : "已打开 GPT 页面"
      }`,
      targetTab: {
        id: tab.id,
        url: tab.url
      }
    }
  }

  /**
   * Step 2：点击 GPT 注册入口，并提交注册邮箱。
   *
   * 该步骤只处理“注册”入口；如果页面已经进入密码页或验证码页，会视为已完成。
   *
   * @param email 要注册的邮箱。
   * @param tabId Step 1 打开的 GPT 页面标签页 ID。
   * @return 邮箱提交结果。
   */
  const clickRegisterAndSubmitEmail = async (
    email: string,
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedEmail = String(email || "").trim()
    if (!normalizedEmail) {
      return {
        ok: false,
        message: "缺少注册邮箱"
      }
    }

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到 Step 1 打开的 GPT 页面，请重新执行 Step 1"
      }
    }

    const entryResult = await runPageActionInTab(tabId, {
      button: {
        texts: SIGNUP_ENTRY_BUTTON_TEXTS
      },
      timeoutMs: 10000,
      successMessage: "已点击 GPT 注册入口",
      failureMessage: "未找到 GPT 页面上的注册入口"
    })

    throwIfRunAborted()
    // 如果上一步停留再 按注册的地方，这里可以继续执行邮箱提交
    const submitResult = await runPageActionInTab(tabId, {
      fields: [
        {
          selectors: OPENAI_EMAIL_INPUT_SELECTORS,
          value: normalizedEmail
        }
      ],
      button: {
        texts: OPENAI_CONTINUE_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 20000,
      successMessage: "已填写注册邮箱并点击继续",
      failureMessage: "未找到注册邮箱输入框或继续按钮"
    })

    if (!submitResult.ok) {
      // 即便失败，也要检测一下是不是已经到下一步了，如果时说明就不是失败
      const [detectResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectRegisterEmailSubmittedInPage
      })
      const submittedMessage = String(detectResult?.result || "")
      if (submittedMessage) {
        return {
          ok: true,
          message: submittedMessage,
          targetTab: submitResult.tab
        }
      }

      return {
        ok: false,
        message: entryResult.ok
          ? submitResult.message
          : `${entryResult.message}；${submitResult.message}`,
        targetTab: submitResult.tab
      }
    }

    return {
      ok: true,
      message: entryResult.ok
        ? `${entryResult.message}；${submitResult.message}`
        : submitResult.message,
      targetTab: submitResult.tab
    }
  }

  /**
   * 登录版 Step 2：点击 GPT 登录入口，并提交登录邮箱。
   *
   * 该方法给 Step 5 缺账号卡片时复用，区别于注册版 Step 2 的注册入口点击。
   *
   * @param email 要登录的邮箱。
   * @param tabId GPT 页面标签页 ID。
   * @return 登录邮箱提交结果。
   */
  const clickLoginAndSubmitEmail = async (
    email: string,
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedEmail = String(email || "").trim()
    if (!normalizedEmail) {
      return {
        ok: false,
        message: "缺少登录邮箱"
      }
    }

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到 GPT 页面，请重新执行打开 GPT 页面"
      }
    }

    const entryResult = await runPageActionInTab(tabId, {
      button: {
        texts: LOGIN_ENTRY_BUTTON_TEXTS
      },
      timeoutMs: 10000,
      successMessage: "已点击 GPT 登录入口",
      failureMessage: "未找到 GPT 页面上的登录入口"
    })

    const submitResult = await runPageActionInTab(tabId, {
      fields: [
        {
          selectors: OPENAI_EMAIL_INPUT_SELECTORS,
          value: normalizedEmail
        }
      ],
      button: {
        texts: OPENAI_LOGIN_EMAIL_CONTINUE_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 20000,
      successMessage: "已填写登录邮箱并点击继续",
      failureMessage: "未找到登录邮箱输入框或继续按钮"
    })

    if (!submitResult.ok) {
      return {
        ok: false,
        message: entryResult.ok
          ? submitResult.message
          : `${entryResult.message}；${submitResult.message}`,
        targetTab: submitResult.tab
      }
    }

    return {
      ok: true,
      message: entryResult.ok
        ? `${entryResult.message}；${submitResult.message}`
        : submitResult.message,
      targetTab: submitResult.tab
    }
  }

  /**
   * Step 3：从 2925 邮箱读取验证码，并填写到当前 OpenAI 页面。
   *
   * @param tabId 等待填写验证码的 OpenAI/ChatGPT 标签页 ID。
   * @param email 2925 邮箱账号，也是目标 OpenAI 账号。
   * @param password 2925 邮箱密码。
   * @param verificationRequestedAt 发起验证码请求的时间，用于过滤旧邮件。
   * @return 验证码读取和提交结果。
   */
  const fetchAndSubmitRegisterVerificationCode = async (
    tabId: number,
    email: string,
    password: string,
    verificationRequestedAt = 0
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    const mailResult = await fetchMail2925VerificationCode(email, password, {
      verificationRequestedAt
    })
    throwIfRunAborted()
    if (!mailResult.code) {
      return {
        ok: false,
        message: mailResult.message,
        targetTab: mailResult.mailTab
      }
    }

    await chrome.tabs.update(tabId, { active: true })
    const submitResult = await runPageActionInTab(tabId, {
      fields: [
        {
          selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
          value: mailResult.code,
          allowSplitInput: true
        }
      ],
      button: {
        texts: OPENAI_CONTINUE_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 15000,
      successMessage: "已填写注册验证码并点击继续",
      failureMessage: "未找到验证码输入框或继续按钮"
    })

    if (!submitResult.ok) {
      return {
        ok: false,
        message: `${mailResult.message}；${submitResult.message}`,
        targetTab: submitResult.tab
      }
    }

    return {
      ok: true,
      message: `${mailResult.message}；${submitResult.message}`,
      targetTab: submitResult.tab
    }
  }

  /**
   * Step 4：填写注册资料页的名称和年龄/生日。
   *
   * @param tabId 注册资料页所在标签页 ID。
   * @return 资料填写和提交结果。
   */
  const submitRegisterProfile = async (
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    await waitForTabLoaded(tabId)
    const [profileResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: submitRegisterProfileInPage,
      args: [DEFAULT_REGISTER_FULL_NAME, DEFAULT_REGISTER_AGE]
    })
    const currentTab = await chrome.tabs.get(tabId)
    const result = profileResult?.result

    return {
      ok: Boolean(result?.ok),
      message: result?.message || "填写名称、年龄或生日失败",
      targetTab: {
        id: tabId,
        url: currentTab.url
      }
    }
  }

  /**
   * 注册资料完成页：点击“继续/Continue”按钮。
   *
   * @param tabId 注册流程标签页 ID。
   * @return 点击继续按钮的结果。
   */
  const clickRegisterReadyContinue = async (
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    const readyUrl = await waitForTabMatchingUrl(tabId, isChatGptPageUrl, {
      timeoutMs: 15000,
      intervalMs: 300,
      signal: getAbortSignal()
    })
    if (!readyUrl) {
      const currentTab = await chrome.tabs.get(tabId)
      return {
        ok: false,
        message: "未等到准备就绪页跳转到 ChatGPT 页面",
        targetTab: {
          id: tabId,
          url: currentTab.url
        }
      }
    }

    const submitResult = await runPageActionInTab(tabId, {
      button: {
        texts: OPENAI_READY_CONTINUE_BUTTON_TEXTS
      },
      timeoutMs: 30000,
      successMessage: "已点击准备就绪页继续按钮",
      failureMessage: "未找到准备就绪页继续按钮"
    })

    return {
      ok: true,
      message: submitResult.ok
        ? submitResult.message
        : "超时认为 准备就绪页未出现继续按钮，已跳过",
      targetTab: submitResult.tab
    }
  }

  /**
   * Step 5 前半段：从 CPA 页面刷新 OAuth 授权链接并进入 OpenAI 登录授权页。
   *
   * @param targetUrl 侧边栏填写的 CPA OAuth 页面地址。
   * @param managementKey CPA 管理密钥。
   * @param targetTabId 可选复用的标签页 ID。
   * @return 打开 OAuth 登录授权页的结果。
   */
  const refreshRegisterOAuthAndLogin = async (
    targetUrl: string,
    managementKey: string,
    targetTabId?: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedTargetUrl = String(targetUrl || "").trim()
    if (!normalizedTargetUrl) {
      return {
        ok: false,
        message: "缺少 CPA OAuth 页面地址"
      }
    }

    const result = await openCodexAuthLink(normalizedTargetUrl, {
      cleanupSession: false,
      managementKey,
      targetTabId
    })

    return {
      ok: result.ok,
      message: result.ok
        ? `${result.message}；已刷新 OAuth 并进入登录授权流程`
        : result.message,
      oauthStartedAt: result.ok ? Date.now() : undefined,
      cpaOAuthState: result.cpaOAuthState,
      targetTab: result.targetTab
    }
  }

  /**
   * Step 5 后半段：在 OAuth 登录授权页选择目标账号卡片。
   *
   * @param tabId OAuth 登录授权页标签页 ID。
   * @param email 要点击的目标账号邮箱。
   * @return 账号卡片点击结果。
   */
  const chooseRegisterLoginAccount = async (
    tabId: number,
    email: string
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedEmail = String(email || "").trim()
    if (!normalizedEmail) {
      return {
        ok: false,
        message: "缺少登录邮箱"
      }
    }

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到 OpenAI 授权页 tab，请先执行 Step 5 或使用当前标签页"
      }
    }

    const targetAccountResult = await runPageActionInTab(tabId, {
      button: {
        texts: [normalizedEmail]
      },
      timeoutMs: 5000,
      successMessage: `已点击目标账号卡片 ${normalizedEmail}`,
      failureMessage: `未找到目标账号卡片 ${normalizedEmail}`
    })
    if (targetAccountResult.ok) {
      return {
        ok: true,
        message: targetAccountResult.message,
        targetTab: targetAccountResult.tab
      }
    }

    return {
      ok: false,
      message: `${targetAccountResult.message}；需要先执行注册流程 1、登录版 2、3 完成目标账号登录`,
      targetTab: targetAccountResult.tab
    }
  }

  /**
   * Step 6：通过 HeroSMS 完成 OpenAI 手机号验证。
   *
   * @param tabId 手机号验证页面标签页 ID。
   * @param options HeroSMS 接码配置。
   * @param oauthStartedAt 验证开始时间戳，用于后面判断是重新拿OAuhtUrl，还是从重新拿手机号
   * @return 手机号提交、短信验证码读取和提交结果。
   */
  const completeRegisterPhoneVerification = async (
    tabId: number,
    options: HeroSmsPhoneVerificationOptions,
    oauthStartedAt = Date.now()
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到手机号验证页面 tab，请先执行 Step 5 或使用当前标签页"
      }
    }

    let activation: HeroSmsActivation | null = null
    let hasReceivedHeroSmsCode = false
    try {
      while (true) {
        activation = await requestHeroSmsActivation(options)
        assertHeroSmsActivationCostWithinExpected(activation)
        const activationSummary = formatHeroSmsActivationSummary(activation)
        throwIfRunAborted()

        await waitForTabLoaded(tabId)
        // 当前界面的URL
        const phoneInputUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url || ""
        // 提交手机号，页面到获取验证码的页面
        const [phoneResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: submitPhoneNumberInPage,
          args: [
            activation.phoneNumber,
            activation.countryLabel,
            activation.countryPhoneCode
          ]
        })
        const phonePageResult = phoneResult?.result
        if (!phonePageResult?.ok) {
          options.onLog?.(
            "warn",
            `手机号 ${activation.phoneNumber} 页面提交失败，HeroSMS 订单 ${activation.activationId} 未取消；新订单未满 2 分钟通常无法取消，等待平台自动回收`
          )
          const currentTab = await chrome.tabs.get(tabId)
          return {
            ok: false,
            message: `已从 HeroSMS 获取手机号 ${activation.phoneNumber}，但页面提交失败：${
              phonePageResult?.message || "未知错误"
            }；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: currentTab.url
            }
          }
        }

        // region ========== 等待跳转到验证码页面 ==========
        const phoneVerificationUrl = await waitForTabMatchingUrl(
          tabId,
          isOpenAiPhoneVerificationUrl,
          {
            timeoutMs: 20000,
            intervalMs: 300,
            signal: getAbortSignal()
          }
        )
        // 如果能在页面拿到信息说明手机号有问题，直接拿下一个手机号
        if (!phoneVerificationUrl) {
          let failureMessage = ""
          try {
            const [phoneFailureResult] = await chrome.scripting.executeScript({
              target: { tabId },
              func: getPhoneNumberSubmitFailureInPage
            })
            failureMessage = phoneFailureResult?.result?.message || ""
          } catch {
            // 页面可能正在切换，检测失败时只按未进入验证码页处理。
          }
          // 如果没拿到提示信息，并且也没有跳转到验证码页面，说明意外情况了，停止吧
          if (failureMessage) {
            options.onLog?.(
              "warn",
              `手机号提交失败：${failureMessage}；手机号 ${activation.phoneNumber} 未进入验证码页，不进入验证码轮询，准备更换手机号；${activationSummary}`
            )
            await releaseHeroSmsActivationQuietly(options, activation)
            activation = null
            continue
          }
          // 打印当前异常的页面，现在还不知道这个是啥情况，实际应该没有这种情况
          const currentTab = await chrome.tabs.get(tabId).catch(() => null)
          options.onLog?.(
            "error",
            `手机号 ${activation.phoneNumber} 提交后未进入验证码页，不进入 HeroSMS 轮询；当前 URL：${
              currentTab?.url || "unknown"
            }；${activationSummary}`
          )
          await releaseHeroSmsActivationQuietly(options, activation)
          activation = null
          return {
            ok: false,
            message: `${phonePageResult.message}；手机号提交后未进入验证码页，已停止自动换号；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: currentTab?.url
            }
          }
        }
        // endregion

        options.onPhoneVerificationPhase?.("phone_submitted")
        let code = ""
        try {
          code = await pollHeroSmsCode(options, activation, getAbortSignal())
          hasReceivedHeroSmsCode = true
        } catch (error) {
          options.onPhoneVerificationPhase?.("phone_wait_finished")
          if (!isHeroSmsCodeTimeoutError(error)) {
            throw error
          }

          const timeoutMessage =
            error instanceof Error ? error.message : "等待手机验证码超时"
          await releaseHeroSmsActivationQuietly(options, activation)
          activation = null

          const remainingMs =
            oauthStartedAt + REGISTER_OAUTH_VALID_MS - Date.now()
          options.onLog?.(
            "warn",
            `${timeoutMessage}；OAuth 预计剩余 ${formatDurationSeconds(
              remainingMs
            )}`
          )

          if (remainingMs > REGISTER_PHONE_RETRY_MIN_REMAINING_MS) {
            const backResult = await tryHistoryBackToPhoneInput(
              tabId,
              () => isOpenAiAddPhoneUrl(phoneInputUrl)
            )
            if (backResult.ok) {
              options.onLog?.(
                "warn",
                `${backResult.message}，OAuth 剩余时间充足，继续更换手机号`
              )
              continue
            }

            return {
              ok: false,
              needRefreshOAuth: true,
              message: `${timeoutMessage}；${backResult.message}，需要重新执行 Step 5 刷新 OAuth；${activationSummary}`,
              targetTab: {
                id: tabId,
                url: (await chrome.tabs.get(tabId).catch(() => null))?.url
              }
            }
          }

          return {
            ok: false,
            needRefreshOAuth: true,
            message: `${timeoutMessage}；OAuth 剩余时间不足 ${formatDurationSeconds(
              REGISTER_PHONE_RETRY_MIN_REMAINING_MS
            )}，需要重新执行 Step 5 刷新 OAuth；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: (await chrome.tabs.get(tabId).catch(() => null))?.url
            }
          }
        }
        options.onPhoneVerificationPhase?.("phone_wait_finished")
        throwIfRunAborted()

        await chrome.tabs.update(tabId, { active: true })
        const submitResult = await runPageActionInTab(tabId, {
          fields: [
            {
              selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
              value: code,
              allowSplitInput: true
            }
          ],
          button: {
            texts: OPENAI_CONTINUE_BUTTON_TEXTS,
            triggerMode: "requestSubmit"
          },
          timeoutMs: 20000,
          successMessage: "已填写手机验证码并点击继续",
          failureMessage: "未找到手机验证码输入框或继续按钮"
        })

        if (!submitResult.ok) {
          await releaseHeroSmsActivationQuietly(options, activation)
          return {
            ok: false,
            message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${activationSummary}`,
            targetTab: submitResult.tab
          }
        }

        const submitState = await waitForPhoneVerificationSubmitState(tabId)
        if (!submitState.ok) {
          if (submitState.releaseActivation) {
            await releaseHeroSmsActivationQuietly(options, activation)
          } else {
            options.onLog?.(
              "warn",
              `HeroSMS 订单 ${activation.activationId} 已收到并提交验证码，页面结果需要人工判断，未取消该订单`
            )
          }
          return {
            ok: false,
            needsManualReview: !submitState.releaseActivation,
            message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${submitState.message}；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: submitState.url || submitResult.tab?.url
            }
          }
        }

        try {
          await setHeroSmsActivationStatus(options, activation, 6)
        } catch {
          // 页面已经提交成功，平台完成状态失败只留给后续人工检查。
        }

        return {
          ok: true,
          message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${submitState.message}；${activationSummary}`,
          callbackUrl: submitState.url,
          targetTab: {
            id: tabId,
            url: submitState.url || submitResult.tab?.url
          }
        }
      }
    } catch (error) {
      if (hasReceivedHeroSmsCode) {
        await releaseHeroSmsActivationQuietly(options, activation)
      } else if (activation) {
        options.onLog?.(
          "warn",
          `HeroSMS 订单 ${activation.activationId} 尚未收到验证码，未主动取消；新订单未满 2 分钟通常无法取消，等待平台自动回收`
        )
      }

      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      const errorMessage =
        error instanceof Error ? error.message : "手机号验证流程执行失败"
      const activationSummary = activation
        ? formatHeroSmsActivationSummary(activation)
        : ""
      return {
        ok: false,
        message: activationSummary
          ? `${errorMessage}；${activationSummary}`
          : errorMessage,
        targetTab: {
          id: tabId,
          url: currentTab?.url
        }
      }
    }
  }

  /**
   * 完成 Step 5 的账号选择兜底流程。
   *
   * 先尝试点击已有账号卡片；如果没有对应卡片，则复用 Step 1、登录版 Step 2、
   * Step 3 完成目标账号登录，再刷新 OAuth 并重新点击账号卡片。
   *
   * @param tabId OAuth 登录授权页标签页 ID。
   * @param email 目标 OpenAI/2925 邮箱。
   * @param password 2925 邮箱密码，用于读取登录验证码。
   * @param targetUrl CPA OAuth 页面地址，用于登录后重新刷新授权页。
   * @param managementKey CPA 管理密钥。
   * @return OAuth 账号选择或兜底登录后的结果。
   */
  const completeRegisterOAuthLogin = async (
    tabId: number,
    email: string,
    password: string,
    targetUrl: string,
    managementKey: string
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const firstChoice = await chooseRegisterLoginAccount(tabId, email)
    if (firstChoice.ok) {
      return firstChoice
    }

    const normalizedTargetUrl = String(targetUrl || "").trim()
    const normalizedManagementKey = String(managementKey || "").trim()
    if (!normalizedTargetUrl) {
      return {
        ok: false,
        message: `${firstChoice.message}；缺少 CPA 地址，无法重新执行 Step 5`,
        targetTab: firstChoice.targetTab
      }
    }

    if (!normalizedManagementKey) {
      return {
        ok: false,
        message: `${firstChoice.message}；缺少 CPA 管理密钥，无法重新执行 Step 5`,
        targetTab: firstChoice.targetTab
      }
    }

    const openResult = await openChatGptRegisterEntry(tabId)
    if (!openResult.ok || typeof openResult.targetTab?.id !== "number") {
      return {
        ok: false,
        message: `${firstChoice.message}；${openResult.message}`,
        targetTab: openResult.targetTab
      }
    }

    const verificationRequestedAt = Date.now()
    const loginResult = await clickLoginAndSubmitEmail(
      email,
      openResult.targetTab.id
    )
    if (!loginResult.ok) {
      return {
        ok: false,
        message: `${firstChoice.message}；${loginResult.message}`,
        targetTab: loginResult.targetTab
      }
    }

    const codeResult = await fetchAndSubmitRegisterVerificationCode(
      openResult.targetTab.id,
      email,
      password,
      verificationRequestedAt
    )
    if (!codeResult.ok) {
      return {
        ok: false,
        message: `${firstChoice.message}；${loginResult.message}；${codeResult.message}`,
        targetTab: codeResult.targetTab
      }
    }

    const codeTabId = codeResult.targetTab?.id || openResult.targetTab.id
    await waitForTabLoaded(codeTabId, undefined, 30000)

    // 验证码提交后给页面一点时间写入登录缓存，再重新打开 OAuth。
    await abortableSleep(15000, getAbortSignal())

    const refreshResult = await refreshRegisterOAuthAndLogin(
      normalizedTargetUrl,
      normalizedManagementKey,
      codeTabId
    )
    if (!refreshResult.ok || typeof refreshResult.targetTab?.id !== "number") {
      return {
        ok: false,
        message: `${firstChoice.message}；${openResult.message}；${loginResult.message}；${codeResult.message}；${refreshResult.message}`,
        targetTab: refreshResult.targetTab
      }
    }

    const secondChoice = await chooseRegisterLoginAccount(
      refreshResult.targetTab.id,
      email
    )
    return {
      ok: secondChoice.ok,
      message: [
        firstChoice.message,
        openResult.message,
        loginResult.message,
        codeResult.message,
        refreshResult.message,
        secondChoice.message
      ]
        .filter(Boolean)
        .join("；"),
      oauthStartedAt: refreshResult.oauthStartedAt,
      cpaOAuthState: refreshResult.cpaOAuthState,
      targetTab: secondChoice.targetTab
    }
  }

  /**
   * Step 7：把注册 OAuth 回调地址提交回 CPA。
   *
   * 复用 codex-login 的最后一步，只负责把 Step 6 成功后的 localhost 回调地址
   * 回填给 CPA 管理接口。
   *
   * @param targetUrl CPA OAuth 页面地址。
   * @param managementKey CPA 管理密钥。
   * @param callbackUrl Step 6 成功后捕获到的 localhost 回调地址。
   * @param callbackTabId 可选，回填成功后关闭这个授权标签页。
   * @param cpaOAuthState Step 5 获取 OAuth URL 时返回的 state。
   * @return CPA 回填结果。
   */
  const submitRegisterOAuthCallbackToCpa = async (
    targetUrl: string,
    managementKey: string,
    callbackUrl: string,
    callbackTabId?: number,
    cpaOAuthState = ""
  ): Promise<CodexRegisterStepResponse> => {
    const result = await submitCodexOAuthCallbackToCpa(
      targetUrl,
      managementKey,
      callbackUrl,
      callbackTabId,
      cpaOAuthState
    )
    return {
      ok: result.ok,
      message: result.message,
      callbackUrl: result.callbackUrl || callbackUrl,
      cpaOAuthState,
      targetTab: {
        id: callbackTabId,
        url: result.callbackUrl || callbackUrl
      }
    }
  }

  return {
    openChatGptRegisterEntry,
    clickRegisterAndSubmitEmail,
    fetchAndSubmitRegisterVerificationCode,
    submitRegisterProfile,
    clickRegisterReadyContinue,
    refreshRegisterOAuthAndLogin,
    completeRegisterPhoneVerification,
    completeRegisterOAuthLogin,
    submitRegisterOAuthCallbackToCpa
  }
}

export const {
  openChatGptRegisterEntry,
  clickRegisterAndSubmitEmail,
  fetchAndSubmitRegisterVerificationCode,
  submitRegisterProfile,
  clickRegisterReadyContinue,
  refreshRegisterOAuthAndLogin,
  completeRegisterPhoneVerification,
  completeRegisterOAuthLogin,
  submitRegisterOAuthCallbackToCpa
} = createCodexRegisterRunner()
