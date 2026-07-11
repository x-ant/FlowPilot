import { fetchDuckEmailInPage } from "./duck-email-page"
import { raceWithAbort, throwIfAborted } from "../utils/abort"
import type { RunContext } from "../utils/run-context"
import { findOrOpenMatchedTab, waitForTabLoaded } from "../utils/tab-utils"

const DUCK_EMAIL_AUTOFILL_URL = "https://duckduckgo.com/email/settings/autofill"

export type DuckEmailResult = {
  email: string
  message: string
}

export type FetchDuckEmailOptions = {
  baselineEmail?: string
  generateNew?: boolean
}

/**
 * 判断标签页是否是 DuckDuckGo 邮箱生成页面。
 *
 * @param rawUrl 待检查的标签页 URL。
 * @return URL 属于 DuckDuckGo Email Protection autofill 页面时返回 true。
 */
const isDuckEmailAutofillUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))

    return (
      url.hostname.toLowerCase() === "duckduckgo.com" &&
      url.pathname.startsWith("/email/settings/autofill")
    )
  } catch {
    return false
  }
}

/**
 * 创建 Duck 邮箱生成 runner。
 *
 * runner 只负责复用或打开 DuckDuckGo Email Protection 页面，并从页面读取生成结果。
 * 注册执行流程不会直接调用它，必须先把生成的邮箱保存到账号列表。
 *
 * @param context 可选的运行上下文，用于传入取消信号。
 * @param context.abortSignal 外部流程取消时触发的信号。
 * @return Duck 邮箱生成方法集合。
 */
export const createDuckEmailRunner = (context: RunContext = {}) => {
  /**
   * 获取当前 runner 使用的取消信号。
   *
   * @return 当前运行上下文里的 AbortSignal。
   */
  const getAbortSignal = () => context.abortSignal

  /**
   * 打开 DuckDuckGo 页面并获取一个 Duck 邮箱。
   *
   * @param options 获取选项。
   * @param options.baselineEmail 当前表单已有邮箱，用于避免重复返回旧值。
   * @param options.generateNew 是否生成新邮箱；默认生成新邮箱。
   * @return 成功读取到的 Duck 邮箱和展示消息。
   */
  const fetchDuckEmail = async (
    options: FetchDuckEmailOptions = {}
  ): Promise<DuckEmailResult> => {
    throwIfAborted(getAbortSignal())

    const tabId = await findOrOpenMatchedTab({
      targetUrl: DUCK_EMAIL_AUTOFILL_URL,
      errorMessage: "无法打开 DuckDuckGo 邮箱生成页面",
      matcher: (tab) => isDuckEmailAutofillUrl(tab.url),
      navigateMatchedTab: false
    })
    await waitForTabLoaded(tabId)
    throwIfAborted(getAbortSignal())

    const [injectionResult] = await raceWithAbort(
      chrome.scripting.executeScript({
        target: { tabId },
        func: fetchDuckEmailInPage,
        args: [
          {
            baselineEmail: options.baselineEmail || "",
            generateNew: options.generateNew ?? true
          }
        ]
      }),
      getAbortSignal()
    )
    const result = injectionResult?.result

    if (!result?.ok || !result.email) {
      throw new Error(result?.message || "Duck 邮箱生成失败")
    }

    return {
      email: result.email,
      message: result.message || `已生成 Duck 邮箱 ${result.email}`
    }
  }

  return {
    fetchDuckEmail
  }
}

export const { fetchDuckEmail } = createDuckEmailRunner()
