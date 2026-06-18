import { clickPageButtonByTextsInPage } from "./page-script"
import { findOrOpenTab } from "./tabs"
import type { StartCodexLoginResponse } from "./types"

const CODEX_LOGIN_BUTTON_TEXTS = [
  "开始codex登录",
  "开始 Codex 登录",
  "开始CODEX登录",
  "开始 Codex login"
]

const CODEX_AUTH_LINK_BUTTON_TEXTS = ["打开链接", "打开授权链接"]

const waitForDelay = (timeoutMs: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

const waitForNewAuthTab = async (
  beforeTabIds: Set<number>,
  timeoutMs = 3000,
  intervalMs = 250
) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await hasNewAuthTab(beforeTabIds)) {
      return true
    }

    await waitForDelay(intervalMs)
  }

  return false
}

const hasNewAuthTab = async (beforeTabIds: Set<number>) => {
  const tabs = await chrome.tabs.query({})

  return tabs.some((tab) => {
    if (!tab.id || beforeTabIds.has(tab.id) || !tab.url) {
      return false
    }

    return tab.url.startsWith("https://auth.openai.com/oauth/authorize")
  })
}

const clickButtonInCodexManagementPage = async (
  loginUrl: string,
  buttonTexts: string[],
  successMessage: string,
  failureMessage: string
): Promise<StartCodexLoginResponse> => {
  const tabId = await findOrOpenTab(loginUrl)
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickPageButtonByTextsInPage,
    args: [buttonTexts, 15000, successMessage, failureMessage]
  })

  const value = result?.result
  const tab = await chrome.tabs.get(tabId)

  if (!value?.ok) {
    return {
      ok: false,
      message: value?.message || failureMessage,
      tabId,
      url: tab.url
    }
  }

  return {
    ok: true,
    message: value.message,
    tabId,
    url: tab.url,
    authUrl: value.authUrl
  }
}

/**
 * 执行完整的 Codex 登录入口点击流程。
 *
 * 流程：打开/复用管理页 -> 等页面加载 -> 注入页面脚本点击按钮。
 *
 * @param loginUrl 侧边栏里填写的 Codex 登录地址
 * @returns 返回给侧边栏展示的执行结果
 */
export const startCodexLogin = async (
  loginUrl: string
): Promise<StartCodexLoginResponse> => {
  return clickButtonInCodexManagementPage(
    loginUrl,
    CODEX_LOGIN_BUTTON_TEXTS,
    "已点击“开始codex登录”按钮",
    "未找到“开始codex登录”按钮，请确认管理页已登录并停留在 OAuth 页面"
  )
}

/**
 * 点击 OAuth 页面里的“打开链接”按钮。
 *
 * 该按钮出现于“开始 Codex 登录”之后，点击后会打开授权链接。
 *
 * @param loginUrl 侧边栏里填写的 Codex 登录地址
 * @returns 返回给侧边栏展示的执行结果
 */
export const openCodexAuthLink = async (
  loginUrl: string
): Promise<StartCodexLoginResponse> => {
  const beforeTabs = await chrome.tabs.query({})
  const beforeTabIds = new Set(
    beforeTabs
      .map((tab) => {
        return tab.id
      })
      .filter((tabId): tabId is number => {
        // 一定是number，主要为了后面的类型判断
        return typeof tabId === "number"
      })
  )

  const result = await clickButtonInCodexManagementPage(
    loginUrl,
    CODEX_AUTH_LINK_BUTTON_TEXTS,
    "已点击“打开链接”按钮",
    "未找到“打开链接”按钮，请先执行步骤 1 并确认授权链接已生成"
  )

  if (!result.ok) {
    return result
  }

  if (await waitForNewAuthTab(beforeTabIds)) {
    return result
  }

  if (result.authUrl) {
    const authTab = await chrome.tabs.create({
      active: true,
      url: result.authUrl
    })

    return {
      ...result,
      message: "已打开授权链接",
      tabId: authTab.id,
      url: authTab.url || result.authUrl
    }
  }

  return result
}
