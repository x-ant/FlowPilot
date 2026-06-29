import { createMail2925Runner } from "./mail-2925"
import { runPageActionInTab } from "./utils/page-action-runner"
import type { RunContext } from "./utils/run-context"
import { findOrOpenTab, waitForTabLoaded } from "./utils/tab-utils"

const CHATGPT_SIGNUP_ENTRY_URL = "https://chatgpt.com/"

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
  const getAbortSignal = () => context.abortSignal

  const throwIfRunAborted = () => {
    if (getAbortSignal()?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
  }

  const openChatGptRegisterEntry =
    async (): Promise<CodexRegisterStepResponse> => {
      throwIfRunAborted()

      const tabId = await findOrOpenTab(CHATGPT_SIGNUP_ENTRY_URL)
      const tab = await chrome.tabs.get(tabId)

      return {
        ok: true,
        message: "已打开 GPT 页面",
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

  return {
    openChatGptRegisterEntry,
    clickRegisterAndSubmitEmail,
    fetchAndSubmitRegisterVerificationCode
  }
}

export const {
  openChatGptRegisterEntry,
  clickRegisterAndSubmitEmail,
  fetchAndSubmitRegisterVerificationCode
} = createCodexRegisterRunner()
