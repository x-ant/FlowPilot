import { performPageActionInPage, type PageActionConfig } from "../page-script"
import type { BrowserTabInfo } from "../types"
import {
  findOrOpenTab,
  waitForTabLoaded,
  waitForTabMatchingUrl
} from "./tab-utils"

type RunPageActionInTabOptions = {
  reloadBeforeAction?: boolean
}

export type PageActionRunResult = {
  ok: boolean
  message: string
  tab?: BrowserTabInfo
}

const isSameTargetUrl = (currentUrl: string, targetUrl: string) => {
  try {
    return new URL(currentUrl).href === new URL(targetUrl).href
  } catch {
    return currentUrl === targetUrl
  }
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
}

/**
 * 页面加载完成后
 * 打开或复用指定地址的标签页，并在该标签页里执行一次页面动作。
 *
 * @param targetUrl 要打开或复用的页面地址。
 * @param action 注入到页面里执行的动作配置。
 * @param tabOptions 执行动作前的标签页级选项，例如是否先刷新页面。
 * @return 页面动作执行结果。
 */
export const runPageActionInTargetUrl = async (
  targetUrl: string,
  action: PageActionConfig,
  tabOptions: RunPageActionInTabOptions = {}
): Promise<PageActionRunResult> => {
  const tabId = await findOrOpenTab(targetUrl)
  // 等页面完成跳转
  const targetUrlReady = await waitForTabMatchingUrl(
    tabId,
    (url) => isSameTargetUrl(url, targetUrl),
    {
      timeoutMs: 5000,
      intervalMs: 100
    }
  )

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

  if (tabOptions.reloadBeforeAction) {
    await chrome.tabs.reload(tabId)
    await waitForTabLoaded(tabId, (url) => isSameTargetUrl(url, targetUrl))
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
