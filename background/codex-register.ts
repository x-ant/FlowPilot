import { createCodexLoginRunner } from "./codex-login"
import { createMail2925Runner } from "./mail-2925"
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

type CodexRegisterStepResponse = {
  ok: boolean
  message: string
  targetTab?: {
    id?: number
    url?: string
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

export const createCodexRegisterRunner = (context: RunContext = {}) => {
  const { fetchMail2925VerificationCode } = createMail2925Runner(context)
  const { openCodexAuthLink } = createCodexLoginRunner(context)
  const getAbortSignal = () => context.abortSignal

  const throwIfRunAborted = () => {
    if (getAbortSignal()?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
  }

  const openChatGptRegisterEntry =
    async (): Promise<CodexRegisterStepResponse> => {
      throwIfRunAborted()

      const cookieResult = await clearSessionCookiesForUrls(
        OPENAI_SESSION_CLEANUP_URLS
      )
      const storageResult = await clearOpenTabSiteStorageForUrls(
        OPENAI_SESSION_CLEANUP_URLS
      )
      // 打开
      const tabId = await findOrOpenTab(CHATGPT_SIGNUP_ENTRY_URL)
      let currentTabStorageMessage = ""

      try {
        // 页面站点存储必须打开界面后注入清理，所以这里清理当前注册页 origin。
        const currentTabStorageResult = await clearSiteStorageInTab(tabId)
        currentTabStorageMessage = `；当前注册页已清理 ${currentTabStorageResult.localCount}/${currentTabStorageResult.sessionCount}/${currentTabStorageResult.indexedDbCount}/${currentTabStorageResult.cacheCount} 个 local/session/indexedDB/cache 项`
      } catch {
        currentTabStorageMessage =
          "；当前注册页站点存储清理失败，已继续打开页面"
      }

      // 再刷新一下
      await chrome.tabs.update(tabId, {
        active: true,
        url: CHATGPT_SIGNUP_ENTRY_URL
      })
      const tab = await chrome.tabs.get(tabId)

      return {
        ok: true,
        message: `${cookieResult.message}；${storageResult.message}${currentTabStorageMessage}；已打开 GPT 页面`,
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
    managementKey: string
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
      managementKey
    })

    return {
      ok: result.ok,
      message: result.ok
        ? `${result.message}；已刷新 OAuth 并进入登录授权流程`
        : result.message,
      targetTab: result.targetTab
    }
  }

  return {
    openChatGptRegisterEntry,
    clickRegisterAndSubmitEmail,
    fetchAndSubmitRegisterVerificationCode,
    submitRegisterProfile,
    clickRegisterReadyContinue,
    refreshRegisterOAuthAndLogin
  }
}

export const {
  openChatGptRegisterEntry,
  clickRegisterAndSubmitEmail,
  fetchAndSubmitRegisterVerificationCode,
  submitRegisterProfile,
  clickRegisterReadyContinue,
  refreshRegisterOAuthAndLogin
} = createCodexRegisterRunner()
