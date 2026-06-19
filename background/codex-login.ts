import {
  performPageActionByTextsInPage,
  type PageActionByTextsArgs,
  type PageActionByTextsOptions
} from "./page-script"
import { findOrOpenTab, waitForTabLoaded } from "./tabs"
import type { StartCodexLoginResponse } from "./types"

const CODEX_LOGIN_BUTTON_TEXTS = [
  "开始codex登录",
  "开始 Codex 登录",
  "开始CODEX登录",
  "开始 Codex login"
]

const CODEX_AUTH_LINK_BUTTON_TEXTS = ["打开链接", "打开授权链接"]
const OPENAI_LOGIN_BUTTON_TEXTS = [
  "continue",
  "next",
  "submit",
  "sign in",
  "log in",
  "登录",
  "继续",
  "下一步"
]
const OPENAI_LOGIN_INPUT_SELECTORS = [
  "input[type='email']",
  "input[autocomplete='email']",
  "input[name='email']",
  "input[name='username']",
  "input[autocomplete='username']",
  "input[id*='email' i]",
  "input[id*='username' i]",
  "input[placeholder*='email' i]",
  "input[placeholder*='username' i]",
  "input[placeholder*='Email']",
  "input[placeholder*='电子邮件']",
  "input[placeholder*='邮箱']",
  "input[placeholder*='メール']",
  "input[aria-label*='email' i]",
  "input[aria-label*='username' i]",
  "input[aria-label*='电子邮件']",
  "input[aria-label*='邮箱']",
  "input[aria-label*='メール']"
]
const CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE = "已填写邮箱并点击“继续”按钮"
const CODEX_AUTH_CONTINUE_FAILURE_MESSAGE =
  "未找到邮箱输入框或“继续”按钮，请确认页面已打开到 OpenAI 登录页"
const CODEX_SESSION_COOKIE_DOMAINS = ["openai.com", "chatgpt.com"]
const CODEX_SESSION_STORAGE_HOSTNAMES = [
  "auth.openai.com",
  "auth0.openai.com",
  "accounts.openai.com",
  "openai.com",
  "www.openai.com",
  "chat.openai.com",
  "chatgpt.com",
  "www.chatgpt.com"
]

/**
 * 把延迟封装成 Promise，方便在 async 流程里等待一小段时间。
 *
 * @param timeoutMs 需要等待的时间，单位毫秒。
 * @return 一个在指定时间后 resolve 的 Promise。
 */
const waitForDelay = (timeoutMs: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

const isCodexSessionStorageUrl = (rawUrl?: string) => {
  try {
    const hostname = new URL(String(rawUrl || "")).hostname.toLowerCase()
    return CODEX_SESSION_STORAGE_HOSTNAMES.includes(hostname)
  } catch {
    return false
  }
}

/**
 * 规范化 cookie 域名，统一去掉前导点并转成小写，便于比较。
 *
 * @param domain 原始 cookie 域名。
 * @return 规范化后的域名。
 */
const normalizeCookieDomainForMatch = (domain?: string) => {
  return String(domain || "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase()
}

/**
 * 判断一个 cookie 是否属于需要清理的 Codex/OpenAI 会话域名。
 *
 * @param cookie Chrome cookie 对象。
 * @return 如果属于需要清理的域名则返回 true。
 */
const shouldClearCodexCookie = (cookie: chrome.cookies.Cookie) => {
  const domain = normalizeCookieDomainForMatch(cookie?.domain)

  if (!domain) {
    return false
  }

  return CODEX_SESSION_COOKIE_DOMAINS.some((targetDomain) => {
    return domain === targetDomain || domain.endsWith(`.${targetDomain}`)
  })
}

/**
 * 根据 cookie 生成删除时需要的 URL。
 *
 * Chrome cookies.remove 需要一个可访问该 cookie 的 URL，所以这里把 domain 和 path 拼出来。
 *
 * @param cookie Chrome cookie 对象。
 * @return 删除 cookie 时需要使用的 URL。
 */
const buildCookieRemovalUrl = (cookie: chrome.cookies.Cookie) => {
  const host = normalizeCookieDomainForMatch(cookie?.domain)
  const path = String(cookie?.path || "/").startsWith("/")
    ? String(cookie?.path || "/")
    : `/${String(cookie?.path || "")}`

  return `https://${host}${path}`
}

/**
 * 收集当前浏览器里所有需要清理的 Codex/OpenAI 会话 cookie。
 *
 * @return 所有需要清理的 cookie 列表。
 */
const collectCodexSessionCookies = async () => {
  if (!chrome.cookies?.getAll) {
    return []
  }

  const stores = chrome.cookies.getAllCookieStores
    ? await chrome.cookies.getAllCookieStores()
    : [{ id: undefined }]
  const cookies: chrome.cookies.Cookie[] = []
  const seen = new Set<string>()

  for (const store of stores) {
    const storeId = store?.id
    const batch = await chrome.cookies.getAll(storeId ? { storeId } : {})

    for (const cookie of batch || []) {
      if (!shouldClearCodexCookie(cookie)) {
        continue
      }

      const key = [
        cookie.storeId || storeId || "",
        cookie.domain || "",
        cookie.path || "",
        cookie.name || ""
      ].join("|")

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      cookies.push(cookie)
    }
  }

  return cookies
}

/**
 * 删除单个会话 cookie。
 *
 * @param cookie 需要删除的 cookie。
 * @return 删除成功返回 true，否则返回 false。
 */
const removeCodexSessionCookie = async (cookie: chrome.cookies.Cookie) => {
  if (!chrome.cookies?.remove) {
    return false
  }

  const details: chrome.cookies.Details = {
    url: buildCookieRemovalUrl(cookie),
    name: cookie.name
  }

  if (cookie.storeId) {
    details.storeId = cookie.storeId
  }

  try {
    return Boolean(await chrome.cookies.remove(details))
  } catch {
    return false
  }
}

/**
 * 清理浏览器里和 Codex/OpenAI 登录相关的旧 cookie。
 *
 * @return 清理结果，包含是否支持 cookies API、删除数量和提示信息。
 */
const clearCodexSessionCookies = async () => {
  if (!chrome.cookies?.getAll || !chrome.cookies?.remove) {
    return {
      ok: false,
      removedCount: 0,
      message: "当前浏览器不支持 cookies API，已跳过旧登录信息清理"
    }
  }

  const cookies = await collectCodexSessionCookies()
  let removedCount = 0

  for (const cookie of cookies) {
    if (await removeCodexSessionCookie(cookie)) {
      removedCount += 1
    }
  }

  return {
    ok: true,
    removedCount,
    message:
      removedCount > 0
        ? `已清理 ${removedCount} 个旧登录 cookie`
        : "未发现可清理的旧登录 cookie"
  }
}

const clearCodexSessionStorageInTab = async (tabId: number) => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const localCount = window.localStorage?.length || 0
      const sessionCount = window.sessionStorage?.length || 0

      try {
        window.localStorage?.clear()
      } catch {
        // Best effort only.
      }

      try {
        window.sessionStorage?.clear()
      } catch {
        // Best effort only.
      }

      return {
        localCount,
        sessionCount
      }
    }
  })

  const value = result?.result as
    | {
        localCount?: number
        sessionCount?: number
      }
    | undefined

  return {
    localCount: Number(value?.localCount || 0),
    sessionCount: Number(value?.sessionCount || 0)
  }
}

const clearCodexSessionStorage = async () => {
  const tabs = await chrome.tabs.query({})
  const targetTabs = tabs.filter((tab) => {
    return Boolean(tab.id) && isCodexSessionStorageUrl(tab.url)
  })

  let clearedTabCount = 0
  let localCount = 0
  let sessionCount = 0

  for (const tab of targetTabs) {
    if (!tab.id) {
      continue
    }

    try {
      const result = await clearCodexSessionStorageInTab(tab.id)
      localCount += result.localCount
      sessionCount += result.sessionCount
      clearedTabCount += 1
    } catch {
      // Best effort only.
    }
  }

  return {
    clearedTabCount,
    localCount,
    sessionCount,
    message:
      clearedTabCount > 0
        ? `已清理 ${clearedTabCount} 个页面的 localStorage/sessionStorage`
        : "未发现可清理的 localStorage/sessionStorage"
  }
}

/**
 * 在指定时间内轮询，等待新的授权标签页出现。
 *
 * @param beforeTabIds 调用前已经存在的标签页 id 集合。
 * @param timeoutMs 最长等待时间，单位毫秒。
 * @param intervalMs 轮询间隔，单位毫秒。
 * @return 如果检测到新授权标签页则返回 true，否则返回 false。
 */
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

/**
 * 检查当前是否已经打开了新的 OpenAI 授权标签页。
 *
 * @param beforeTabIds 调用前已经存在的标签页 id 集合。
 * @return 如果发现新的授权标签页则返回 true，否则返回 false。
 */
const hasNewAuthTab = async (beforeTabIds: Set<number>) => {
  const tabs = await chrome.tabs.query({})

  return tabs.some((tab) => {
    if (!tab.id || beforeTabIds.has(tab.id) || !tab.url) {
      return false
    }

    return tab.url.startsWith("https://auth.openai.com/oauth/authorize")
  })
}

const runPageActionInTab = async (
  targetUrl: string,
  actionOptions: PageActionByTextsOptions,
  actionArgs?: PageActionByTextsArgs
): Promise<StartCodexLoginResponse> => {
  const tabId = await findOrOpenTab(targetUrl)
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: performPageActionByTextsInPage,
    args: [actionOptions, actionArgs || {}]
  })

  const value = result?.result
  const tab = await chrome.tabs.get(tabId)

  if (!value?.ok) {
    return {
      ok: false,
      message: value?.message || actionOptions.failureMessage,
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
 * 在已有标签页里直接执行页面动作。
 *
 * @param tabId 要操作的标签页 id。
 * @param actionOptions 页面动作配置。
 * @param actionArgs 页面动作参数。
 * @return 返回给侧边栏展示的执行结果。
 */
const runPageActionInExistingTab = async (
  tabId: number,
  actionOptions: PageActionByTextsOptions,
  actionArgs?: PageActionByTextsArgs
): Promise<StartCodexLoginResponse> => {
  try {
    const tab = await chrome.tabs.get(tabId)
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: performPageActionByTextsInPage,
      args: [actionOptions, actionArgs || {}]
    })

    const value = result?.result
    const currentTab = await chrome.tabs.get(tabId)

    if (!value?.ok) {
      return {
        ok: false,
        message: value?.message || actionOptions.failureMessage,
        tabId,
        url: currentTab.url || tab.url
      }
    }

    return {
      ok: true,
      message: value.message,
      tabId,
      url: currentTab.url || tab.url,
      authUrl: value.authUrl
    }
  } catch {
    return {
      ok: false,
      message: "未找到可操作的登录页标签，请先执行步骤 2"
    }
  }
}

/**
 * 执行完整的 Codex 登录入口点击流程。
 *
 * 流程：打开/复用管理页 -> 等页面加载 -> 注入页面脚本点击按钮。
 *
 * @param targetUrl 侧边栏里填写的 Codex 登录地址
 * @return 返回给侧边栏展示的执行结果。
 */
export const startCodexLogin = async (
  targetUrl: string
): Promise<StartCodexLoginResponse> => {
  // 第一步只负责触发管理页里的“开始登录”按钮。
  return runPageActionInTab(targetUrl, {
    targetTexts: CODEX_LOGIN_BUTTON_TEXTS,
    timeoutMs: 15000,
    successMessage: "已点击“开始codex登录”按钮",
    failureMessage: "未找到“开始codex登录”按钮，请确认管理页已登录并停留在 OAuth 页面"
  })
}

/**
 * 打开 OpenAI 登录页并清理旧会话。
 *
 * 这个步骤只负责把页面打开到目标地址，不再自动填写邮箱。
 *
 * @param targetUrl 侧边栏里填写的 OpenAI 登录地址。
 * @return 返回给侧边栏展示的执行结果。
 */
export const openCodexAuthLink = async (
  targetUrl: string
): Promise<StartCodexLoginResponse> => {
  // 打开授权链接前先清理旧 cookie，减少复用到失效登录态的概率。
  const cleanupResult = await clearCodexSessionCookies()
  const storageResult = await clearCodexSessionStorage()
  const cleanupMessage = `${cleanupResult.message}；${storageResult.message}，`
  if (targetUrl.startsWith("https://auth.openai.com/log-in")) {
    const tabId = await findOrOpenTab(targetUrl)
    const tab = await chrome.tabs.get(tabId)

    return {
      ok: true,
      message: `${cleanupMessage}已打开 OpenAI 登录页，等待填写邮箱`,
      tabId,
      url: tab.url
    }
  }

  const beforeTabs = await chrome.tabs.query({})
  const beforeTabIds = new Set(
    beforeTabs
      .map((tab) => {
        return tab.id
      })
      .filter((tabId): tabId is number => {
        // 实际一定是number，这么些是为了后面的类型判断能推断出来当前是nubmber
        return typeof tabId === "number"
      })
  )

  const result = await runPageActionInTab(targetUrl, {
    targetTexts: CODEX_AUTH_LINK_BUTTON_TEXTS,
    timeoutMs: 15000,
    successMessage: "已点击“打开链接”按钮",
    failureMessage: "未找到“打开链接”按钮，请先执行步骤 1 并确认授权链接已生成"
  })

  if (!result.ok) {
    return {
      ...result,
      message: `${cleanupMessage}${result.message}`
    }
  }

  if (await waitForNewAuthTab(beforeTabIds)) {
    const authTabs = (await chrome.tabs.query({})).filter((tab) => {
      return Boolean(tab.id) && isCodexSessionStorageUrl(tab.url)
    })

    for (const tab of authTabs) {
      if (!tab.id) {
        continue
      }

      try {
        await clearCodexSessionStorageInTab(tab.id)
        await chrome.tabs.reload(tab.id)
      } catch {
        // Best effort only.
      }
    }

    return {
      ...result,
      message: `${cleanupMessage}已在新标签页打开授权链接`
    }
  }

  if (result.authUrl) {
    const authTab = await chrome.tabs.create({
      active: true,
      url: result.authUrl
    })

    if (authTab.id) {
      try {
        await waitForTabLoaded(authTab.id)
        await clearCodexSessionStorageInTab(authTab.id)
        await chrome.tabs.reload(authTab.id)
      } catch {
        // Best effort only.
      }
    }

    return {
      ...result,
      message: `${cleanupMessage}已打开授权链接`,
      tabId: authTab.id,
      url: authTab.url || result.authUrl
    }
  }

  return {
    ...result,
    message: `${cleanupMessage}${result.message}`
  }
}

/**
 * 在 OpenAI 登录页填写邮箱并提交。
 *
 * @param tabId 要操作的登录页标签页 id。
 * @param email 2925 邮箱地址。
 * @return 返回给侧边栏展示的执行结果。
 */
export const fillOpenaiLoginEmail = async (
  tabId: number,
  email: string
): Promise<StartCodexLoginResponse> => {
  const result = await runPageActionInExistingTab(tabId, {
    targetTexts: OPENAI_LOGIN_BUTTON_TEXTS,
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_CONTINUE_FAILURE_MESSAGE,
    submitStrategy: "requestSubmit"
  }, {
    inputSelectors: OPENAI_LOGIN_INPUT_SELECTORS,
    inputValue: email
  })

  return result
}
