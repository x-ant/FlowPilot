import { runPageActionInTargetUrl } from "./utils/page-action-runner"
import type { RunContext } from "./utils/run-context"

const CHATGPT_SIGNUP_ENTRY_URL = "https://chatgpt.com/"

type OpenCodexRegisterEntryResponse = {
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

const SIGNUP_ENTRY_BUTTON_SELECTORS = [
  "button",
  "a",
  "[role='button']",
  "[role='link']",
  "input[type='button']",
  "input[type='submit']"
]

const isChatGptEntryUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl)
    return ["chatgpt.com", "www.chatgpt.com"].includes(
      parsed.hostname.toLowerCase()
    )
  } catch {
    return false
  }
}

export const createCodexRegisterRunner = (context: RunContext = {}) => {
  const getAbortSignal = () => context.abortSignal

  const openChatGptAndClickRegister =
    async (): Promise<OpenCodexRegisterEntryResponse> => {
      if (getAbortSignal()?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError")
      }

      const result = await runPageActionInTargetUrl(
        CHATGPT_SIGNUP_ENTRY_URL,
        {
          button: {
            texts: SIGNUP_ENTRY_BUTTON_TEXTS,
            selectors: SIGNUP_ENTRY_BUTTON_SELECTORS,
            triggerMode: "click"
          },
          timeoutMs: 20000,
          successMessage: "已打开 GPT 页面并点击注册入口",
          failureMessage:
            "未找到 GPT 页面上的注册入口，请确认页面处于未登录状态"
        },
        {
          targetUrlMatcher: isChatGptEntryUrl
        }
      )

      return {
        ok: result.ok,
        message: result.message,
        targetTab: result.tab
      }
    }

  return {
    openChatGptAndClickRegister
  }
}

export const { openChatGptAndClickRegister } = createCodexRegisterRunner()
