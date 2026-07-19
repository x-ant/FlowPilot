import {
  performPageActionInPage,
  type PageActionConfig
} from "../page-scripts/page-script"
import type { BrowserTabInfo } from "../types"
import {
  findOrOpenTab,
  waitForTabLoaded,
  waitForTabMatchingUrl
} from "./tab-utils"

type RunPageActionInTabOptions = {
  targetUrlMatcher?: (url: string) => boolean
}

export type PageActionRunResult = {
  ok: boolean
  message: string
  tab?: BrowserTabInfo
}

export type PageButtonDetectResult = {
  hasButton: boolean
  message: string
}

/**
 * 按按钮文案检测当前页面是否存在可点击按钮。
 *
 * 这个函数会被注入页面执行，只做只读检测，不点击页面。适合在流程步骤里
 * 先判断是否需要点击入口按钮，再复用统一的表单填写逻辑。
 *
 * @param buttonTexts 候选按钮文案。
 * @return 是否存在匹配按钮和检测说明。
 */
export const detectPageButtonByTextInPage = (
  buttonTexts: string[]
): PageButtonDetectResult => {
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
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
      .trim()
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
      htmlElement.getAttribute("aria-disabled") === "true" ||
      style.pointerEvents === "none"
    )
  }

  const targetTexts = buttonTexts.map(normalizeText)
  const selector = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']"
  ].join(",")
  const button = Array.from(document.querySelectorAll(selector)).find(
    (element) => {
      if (isUnavailable(element)) {
        return false
      }

      const currentText = normalizeText(getElementText(element))
      return targetTexts.some((targetText) => currentText.includes(targetText))
    }
  )

  return {
    hasButton: Boolean(button),
    message: button
      ? `当前页面存在按钮：${getElementText(button) || "未识别文案"}`
      : "当前页面没有匹配按钮"
  }
}

const isSameTargetUrl = (currentUrl: string, targetUrl: string) => {
  try {
    return new URL(currentUrl).href === new URL(targetUrl).href
  } catch {
    return currentUrl === targetUrl
  }
}

const getTabInfoQuietly = async (tabId: number): Promise<BrowserTabInfo> => {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  return {
    id: tabId,
    url: tab?.url
  }
}

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error || "未知错误")
}

const buildPageUnavailableMessage = (
  failureMessage: string,
  error: unknown,
  tab: BrowserTabInfo
) => {
  const detail = getErrorMessage(error)
  const urlMessage = tab.url ? `；当前地址：${tab.url}` : ""
  return `${failureMessage}；页面当前不可操作，可能还没加载完成、处于空白页/错误页，或浏览器刚从休眠恢复：${detail}${urlMessage}`
}

/**
 * 等页面加载完成后
 * 在已经确定的标签页里注入并执行一次页面动作。
 *
 * @param tabId 要操作的标签页 id。
 * @param action 注入到页面里执行的动作配置。
 * @return 页面动作执行结果。
 */
export const runPageActionInTab = async (
  tabId: number,
  action: PageActionConfig
): Promise<PageActionRunResult> => {
  try {
    // 等待页面加载完成
    await waitForTabLoaded(tabId)

    const [actionInjectionResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: performPageActionInPage,
      args: [action]
    })
    const pageActionResult = actionInjectionResult?.result
    // 可能出现地址变了的情况，所以总是返回新的地址
    const currentTab = await chrome.tabs.get(tabId)

    if (!pageActionResult?.ok) {
      return {
        ok: false,
        message: pageActionResult?.message || action.failureMessage,
        tab: {
          id: tabId,
          url: currentTab.url
        }
      }
    } else {
      return {
        ok: true,
        message: pageActionResult.message,
        tab: {
          id: tabId,
          url: currentTab.url
        }
      }
    }
  } catch (error) {
    const tab = await getTabInfoQuietly(tabId)
    return {
      ok: false,
      message: buildPageUnavailableMessage(action.failureMessage, error, tab),
      tab
    }
  }
}

/**
 * 页面加载完成后
 * 打开或复用指定地址的标签页，并在该标签页里执行一次页面动作。
 *
 * @param targetUrl 要打开或复用的页面地址。
 * @param action 注入到页面里执行的动作配置。
 * @param tabOptions 执行动作前的标签页级选项。
 * @return 页面动作执行结果。
 */
export const runPageActionInTargetUrl = async (
  targetUrl: string,
  action: PageActionConfig,
  tabOptions: RunPageActionInTabOptions = {}
): Promise<PageActionRunResult> => {
  const tabId = await findOrOpenTab(targetUrl)
  const targetUrlMatcher =
    tabOptions.targetUrlMatcher ||
    ((url: string) => isSameTargetUrl(url, targetUrl))
  // 等页面完成跳转
  const targetUrlReady = await waitForTabMatchingUrl(tabId, targetUrlMatcher, {
    timeoutMs: 5000,
    intervalMs: 100
  })

  if (!targetUrlReady) {
    const currentTab = await chrome.tabs.get(tabId)
    return {
      ok: false,
      message: `目标页面未切换到指定地址：${targetUrl}`,
      tab: {
        id: tabId,
        url: currentTab.url
      }
    }
  }

  return runPageActionInTab(tabId, action)
}

/**
 * 页面加载完成后
 * 在已保存的 OpenAI auth 标签页里执行页面动作。
 *
 * @param tabId 要操作的 auth 标签页 id。
 * @param action 页面动作配置。
 * @return 页面动作执行结果。
 */
export const runAuthPageAction = async (
  tabId: number,
  action: PageActionConfig
): Promise<PageActionRunResult> => {
  try {
    return await runPageActionInTab(tabId, action)
  } catch {
    return {
      ok: false,
      message: "未找到可操作的登录页标签，请先执行步骤 1"
    }
  }
}
