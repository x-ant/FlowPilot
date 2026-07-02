import { createCodexLoginRunner } from "./codex-login"
import { createMail2925Runner } from "./mail-2925"
import { abortableSleep } from "./utils/abort"
import {
  clearOpenTabSiteStorageForUrls,
  clearSessionCookiesForUrls,
  clearSiteStorageInTab
} from "./utils/browser-session-cleanup"
import { runPageActionInTab } from "./utils/page-action-runner"
import type { RunContext } from "./utils/run-context"
import { findOrOpenTab, waitForTabLoaded } from "./utils/tab-utils"

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
const HERO_SMS_API_URL = "https://hero-sms.com/stubs/handler_api.php"
const HERO_SMS_OPENAI_SERVICE_CODE = "dr"
const HERO_SMS_DEFAULT_OPERATOR = "any"
const HERO_SMS_DEFAULT_POLL_INTERVAL_MS = 5000
const HERO_SMS_DEFAULT_POLL_ROUNDS = 36

type CodexRegisterStepResponse = {
  ok: boolean
  message: string
  targetTab?: {
    id?: number
    url?: string
  }
}

export type HeroSmsPhoneVerificationOptions = {
  apiKey: string
  countryId: number
  countryLabel: string
  operator: string
  maxPrice?: string
}

type HeroSmsActivation = {
  activationId: string
  phoneNumber: string
  countryId: number
  countryLabel: string
  statusAction: "getStatus" | "getStatusV2"
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

const submitRegisterProfileInPage = (
  fullName: string,
  age: number
): Promise<{ ok: boolean; message: string }> => {
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
  }

  function normalizeText(value: string) {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

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

const detectRegisterEmailSubmittedInPage = () => {
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

const describeHeroSmsPayload = (payload: unknown) => {
  if (typeof payload === "string") {
    return payload.trim()
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    const text = String(
      record.message || record.msg || record.error || record.status || ""
    ).trim()
    if (text) {
      return text
    }

    try {
      return JSON.stringify(payload)
    } catch {
      return String(payload)
    }
  }

  return String(payload || "").trim()
}

const parseHeroSmsPayload = (text: string) => {
  const trimmed = String(text || "").trim()
  if (!trimmed) {
    return ""
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      return trimmed
    }
  }

  return trimmed
}

const buildHeroSmsUrl = (query: Record<string, string | number>) => {
  const url = new URL(HERO_SMS_API_URL)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  return url.toString()
}

const fetchHeroSmsPayload = async (
  options: HeroSmsPhoneVerificationOptions,
  query: Record<string, string | number>,
  actionLabel: string
) => {
  const apiKey = String(options.apiKey || "").trim()
  if (!apiKey) {
    throw new Error("缺少 HeroSMS 接码 API")
  }

  const response = await fetch(
    buildHeroSmsUrl({
      api_key: apiKey,
      ...query
    })
  )
  const payload = parseHeroSmsPayload(await response.text())
  if (!response.ok) {
    throw new Error(
      `${actionLabel}失败：${describeHeroSmsPayload(payload) || response.status}`
    )
  }

  return payload
}

const normalizeHeroSmsPrice = (value: string | undefined) => {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0
    ? String(Math.round(parsed * 10000) / 10000)
    : ""
}

const extractHeroSmsCode = (value: unknown) => {
  const text = describeHeroSmsPayload(value)
  const statusOkMatch = text.match(/^STATUS_OK:(.+)$/i)
  const codeSource = statusOkMatch?.[1] || text
  return codeSource.match(/\b(\d{4,8})\b/)?.[1] || ""
}

const parseHeroSmsActivation = (
  payload: unknown,
  options: HeroSmsPhoneVerificationOptions
): HeroSmsActivation | null => {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const activationId = String(
      record.activationId || record.id || record.activation || ""
    ).trim()
    const phoneNumber = String(
      record.phoneNumber || record.number || record.phone || ""
    ).trim()
    if (activationId && phoneNumber) {
      return {
        activationId,
        phoneNumber,
        countryId: Number(options.countryId) || 0,
        countryLabel: String(options.countryLabel || "").trim(),
        statusAction: "getStatusV2"
      }
    }
  }

  const text = describeHeroSmsPayload(payload)
  const accessNumberMatch = text.match(/^ACCESS_NUMBER:([^:]+):(.+)$/i)
  if (!accessNumberMatch) {
    return null
  }

  return {
    activationId: String(accessNumberMatch[1] || "").trim(),
    phoneNumber: String(accessNumberMatch[2] || "").trim(),
    countryId: Number(options.countryId) || 0,
    countryLabel: String(options.countryLabel || "").trim(),
    statusAction: "getStatusV2"
  }
}

const requestHeroSmsActivation = async (
  options: HeroSmsPhoneVerificationOptions
) => {
  const maxPrice = normalizeHeroSmsPrice(options.maxPrice)
  const operator = String(options.operator || HERO_SMS_DEFAULT_OPERATOR)
    .trim()
    .toLowerCase()
  const payload = await fetchHeroSmsPayload(
    options,
    {
      action: "getNumberV2",
      service: HERO_SMS_OPENAI_SERVICE_CODE,
      country: Math.floor(Number(options.countryId) || 0),
      ...(operator && operator !== HERO_SMS_DEFAULT_OPERATOR
        ? { operator }
        : {}),
      ...(maxPrice ? { maxPrice, fixedPrice: "true" } : {})
    },
    "HeroSMS getNumberV2"
  )
  const activation = parseHeroSmsActivation(payload, options)
  if (!activation) {
    throw new Error(
      `HeroSMS 获取手机号失败：${describeHeroSmsPayload(payload) || "空响应"}`
    )
  }

  return activation
}

const pollHeroSmsCode = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation,
  signal?: AbortSignal
) => {
  let lastStatus = ""

  for (let round = 1; round <= HERO_SMS_DEFAULT_POLL_ROUNDS; round += 1) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }

    const payload = await fetchHeroSmsPayload(
      options,
      {
        action: activation.statusAction,
        id: activation.activationId
      },
      `HeroSMS ${activation.statusAction}`
    )
    lastStatus = describeHeroSmsPayload(payload)

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const record = payload as Record<string, any>
      const code =
        extractHeroSmsCode(record.sms?.code) ||
        extractHeroSmsCode(record.call?.code) ||
        extractHeroSmsCode(record.code)
      if (code) {
        return code
      }
    }

    const textCode = extractHeroSmsCode(payload)
    if (textCode && /^STATUS_OK:/i.test(lastStatus)) {
      return textCode
    }

    if (
      !/^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(
        lastStatus
      ) &&
      !(payload && typeof payload === "object" && !Array.isArray(payload))
    ) {
      throw new Error(`HeroSMS 查询验证码失败：${lastStatus || "空响应"}`)
    }

    await abortableSleep(HERO_SMS_DEFAULT_POLL_INTERVAL_MS, signal)
  }

  throw new Error(
    `等待手机验证码超时${lastStatus ? `，HeroSMS 最后状态：${lastStatus}` : ""}`
  )
}

const setHeroSmsActivationStatus = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation,
  status: number
) => {
  await fetchHeroSmsPayload(
    options,
    {
      action: "setStatus",
      id: activation.activationId,
      status
    },
    "HeroSMS setStatus"
  )
}

const submitPhoneNumberInPage = (
  phoneNumber: string,
  countryLabel: string
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
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
  }

  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

  const normalizeDigits = (value: string) => {
    return String(value || "").replace(/\D+/g, "")
  }

  const inferDialCode = () => {
    const digits = normalizeDigits(phoneNumber)
    const label = String(countryLabel || "")
    if (/indonesia|印度尼西亚/i.test(label)) return "62"
    if (/thailand|泰国/i.test(label)) return "66"
    if (/vietnam|越南/i.test(label)) return "84"
    if (/united\s*kingdom|uk|英国/i.test(label)) return "44"
    if (/japan|日本/i.test(label)) return "81"
    if (/usa|united\s*states|美国/i.test(label)) return "1"
    return ["84", "66", "62", "44", "81", "1"].find((code) => {
      return digits.startsWith(code) && digits.length > code.length
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

  const isEnabled = (element: Element | null) => {
    const htmlElement = element as HTMLElement | null
    return Boolean(
      htmlElement &&
        isVisible(htmlElement) &&
        !(htmlElement as HTMLButtonElement).disabled &&
        htmlElement.getAttribute("aria-disabled") !== "true"
    )
  }

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

  const selectNativeCountry = (phoneInput: HTMLInputElement, dialCode = "") => {
    const selectors = [
      "select",
      "[data-testid='hidden-select-container'] select"
    ]
    const roots = [
      phoneInput.closest("form"),
      phoneInput.closest("fieldset"),
      phoneInput.parentElement?.parentElement,
      document
    ].filter(Boolean) as ParentNode[]

    for (const root of roots) {
      for (const selector of selectors) {
        const select = Array.from(root.querySelectorAll(selector)).find(
          (element) => {
            return element instanceof HTMLSelectElement && isVisible(element)
          }
        ) as HTMLSelectElement | undefined

        if (!select) {
          continue
        }

        const option = Array.from(select.options).find((item) => {
          const text = `${item.textContent || ""} ${item.value || ""}`
          return (
            (countryLabel &&
              normalizeText(text).includes(normalizeText(countryLabel))) ||
            (dialCode && normalizeDigits(text).includes(dialCode))
          )
        })

        if (option) {
          select.value = option.value
          option.selected = true
          select.dispatchEvent(new Event("input", { bubbles: true }))
          select.dispatchEvent(new Event("change", { bubbles: true }))
          return true
        }
      }
    }

    return false
  }

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

  const clickButton = (button: HTMLElement, input: HTMLInputElement) => {
    const form =
      (button instanceof HTMLButtonElement || button instanceof HTMLInputElement
        ? button.form
        : null) ||
      input.form ||
      (button.closest("form") as HTMLFormElement | null)

    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit(
        button instanceof HTMLButtonElement ||
          button instanceof HTMLInputElement
          ? button
          : undefined
      )
      return
    }

    button.click()
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

    const dialCode = inferDialCode()
    const countrySynced = selectNativeCountry(phoneInput, dialCode)
    const digits = normalizeDigits(phoneNumber)
    const localNumber =
      dialCode && digits.startsWith(dialCode)
        ? digits.slice(dialCode.length)
        : digits
    setInputValue(phoneInput, countrySynced ? localNumber : `+${digits}`)
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

    const button = findContinueButton()
    if (!button) {
      return {
        ok: false,
        message: "未找到手机号页继续按钮"
      }
    }

    clickButton(button, phoneInput)

    return {
      ok: true,
      message: `已填写手机号 +${digits}${countrySynced ? " 并同步国家选项" : ""}，已点击继续`
    }
  })()
}

export const createCodexRegisterRunner = (context: RunContext = {}) => {
  const { fetchMail2925VerificationCode } = createMail2925Runner(context)
  const { openCodexAuthLink } = createCodexLoginRunner(context)
  const getAbortSignal = () => context.abortSignal

  const throwIfRunAborted = () => {
    if (getAbortSignal()?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
  }

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

    const submitResult = await runPageActionInTab(tabId, {
      button: {
        texts: OPENAI_READY_CONTINUE_BUTTON_TEXTS
      },
      timeoutMs: 15000,
      successMessage: "已点击准备就绪页继续按钮",
      failureMessage: "未找到准备就绪页继续按钮"
    })

    return {
      ok: submitResult.ok,
      message: submitResult.message,
      targetTab: submitResult.tab
    }
  }

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
      targetTab: result.targetTab
    }
  }

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
        message: "未找到 OpenAI 授权页 tab，请先执行 Step 6 或使用当前标签页"
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

  const completeRegisterPhoneVerification = async (
    tabId: number,
    options: HeroSmsPhoneVerificationOptions
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到手机号验证页面 tab，请先执行 Step 6 或使用当前标签页"
      }
    }

    let activation: HeroSmsActivation | null = null
    try {
      activation = await requestHeroSmsActivation(options)
      throwIfRunAborted()

      await waitForTabLoaded(tabId)
      const [phoneResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: submitPhoneNumberInPage,
        args: [activation.phoneNumber, activation.countryLabel]
      })
      const phonePageResult = phoneResult?.result
      if (!phonePageResult?.ok) {
        try {
          await setHeroSmsActivationStatus(options, activation, 8)
        } catch {
          // 释放订单失败不覆盖页面提交失败。
        }
        const currentTab = await chrome.tabs.get(tabId)
        return {
          ok: false,
          message: `已从 HeroSMS 获取手机号 ${activation.phoneNumber}，但页面提交失败：${
            phonePageResult?.message || "未知错误"
          }`,
          targetTab: {
            id: tabId,
            url: currentTab.url
          }
        }
      }

      const code = await pollHeroSmsCode(options, activation, getAbortSignal())
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
        return {
          ok: false,
          message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}`,
          targetTab: submitResult.tab
        }
      }

      try {
        await setHeroSmsActivationStatus(options, activation, 6)
      } catch {
        // 页面已经提交成功，平台完成状态失败只留给后续人工检查。
      }

      return {
        ok: true,
        message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}`,
        targetTab: submitResult.tab
      }
    } catch (error) {
      if (activation) {
        try {
          await setHeroSmsActivationStatus(options, activation, 8)
        } catch {
          // 订单释放失败不覆盖原始错误。
        }
      }

      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "手机号验证流程执行失败",
        targetTab: {
          id: tabId,
          url: currentTab?.url
        }
      }
    }
  }

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
        message: `${firstChoice.message}；缺少 CPA 地址，无法重新执行 Step 6`,
        targetTab: firstChoice.targetTab
      }
    }

    if (!normalizedManagementKey) {
      return {
        ok: false,
        message: `${firstChoice.message}；缺少 CPA 管理密钥，无法重新执行 Step 6`,
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
      targetTab: secondChoice.targetTab
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
    completeRegisterOAuthLogin
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
  completeRegisterOAuthLogin
} = createCodexRegisterRunner()
