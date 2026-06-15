import { clickCodexLoginButtonInPage } from "./page-script"
import { findOrOpenTab } from "./tabs"
import type { StartCodexLoginResponse } from "./types"

const CODEX_LOGIN_BUTTON_TEXTS = [
  "开始codex登录",
  "开始 Codex 登录",
  "开始CODEX登录",
  "开始 Codex login"
]

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
  const tabId = await findOrOpenTab(loginUrl)
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickCodexLoginButtonInPage,
    args: [CODEX_LOGIN_BUTTON_TEXTS, 15000]
  })

  const value = result?.result
  const tab = await chrome.tabs.get(tabId)

  if (!value?.ok) {
    return {
      ok: false,
      message: value?.message || "点击“开始codex登录”按钮失败",
      tabId,
      url: tab.url
    }
  }

  return {
    ok: true,
    message: value.message,
    tabId,
    url: tab.url
  }
}

