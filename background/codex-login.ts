import { fetchMail2925VerificationCode } from "./mail-2925"
import {
  extractOpenaiOAuthAuthorizeUrlInPage,
  performPageActionByTextsInPage,
  type PageActionByTextsArgs,
  type PageActionByTextsOptions
} from "./page-script"
import {
  findOrOpenTab,
  waitForTabLoaded,
  waitForTabMatchingUrl
} from "./tab-utils"
import type {
  CodexLoginPageActionResponse,
  ConfirmCodexOAuthCallbackResponse,
  FillOpenaiLoginEmailResponse,
  FillOpenaiLoginVerificationCodeResponse,
  OpenCodexAuthLinkResponse,
  StartCodexLoginStepResponse
} from "./types"

const CODEX_LOGIN_BUTTON_TEXTS = [
  "开始codex登录",
  "开始 Codex 登录",
  "开始CODEX登录",
  "开始 Codex login"
]

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
const OPENAI_VERIFICATION_INPUT_SELECTORS = [
  "input[name='code']",
  "input[name='otp']",
  "input[autocomplete='one-time-code']",
  "input[type='text'][maxlength='6']",
  "input[type='tel'][maxlength='6']",
  "input[aria-label*='code' i]",
  "input[aria-label*='验证码']",
  "input[aria-label*='認証']",
  "input[aria-label*='確認']",
  "input[placeholder*='code' i]",
  "input[placeholder*='验证码']",
  "input[placeholder*='認証']",
  "input[placeholder*='確認']",
  "input[inputmode='numeric']"
]
const OPENAI_VERIFICATION_BUTTON_TEXTS = [
  "continue",
  "next",
  "submit",
  "sign in",
  "log in",
  "verify",
  "confirm",
  "登录",
  "继续",
  "下一步",
  "确认",
  "提交"
]
const OPENAI_OAUTH_CONSENT_CONTINUE_BUTTON_TEXTS = ["continue", "继续"]
const CODEX_CALLBACK_INPUT_SELECTORS = [
  "input[placeholder*='localhost' i]",
  "input[placeholder*='auth/callback' i]",
  "input[aria-label*='回调']",
  "input[aria-label*='callback' i]",
  "input[name*='callback' i]",
  "input[id*='callback' i]"
]
const CODEX_CALLBACK_SUBMIT_BUTTON_TEXTS = [
  "提交回调 URL",
  "提交回调URL",
  "Submit Callback URL"
]
const CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE = "已填写邮箱并点击“继续”按钮"
const CODEX_AUTH_CONTINUE_FAILURE_MESSAGE =
  "未找到邮箱输入框或“继续”按钮，请确认页面已打开到 OpenAI 登录页"
const CODEX_AUTH_VERIFY_SUCCESS_MESSAGE = "已填写邮箱验证码并继续"
const CODEX_AUTH_VERIFY_FAILURE_MESSAGE =
  "未找到验证码输入框或“继续”按钮，请确认页面已打开到 OpenAI 邮箱验证码页"
const CODEX_AUTH_CONFIRM_SUCCESS_MESSAGE = "已点击授权确认页“继续”按钮"
const CODEX_AUTH_CONFIRM_FAILURE_MESSAGE =
  "未找到授权确认页的“继续”按钮，请确认页面已停留在 Codex 授权确认页"
const CODEX_CALLBACK_SUBMIT_SUCCESS_MESSAGE = "已填写并提交回调 URL"
const CODEX_CALLBACK_SUBMIT_FAILURE_MESSAGE =
  "未找到回调 URL 输入框或“提交回调 URL”按钮，请确认管理页已停留在 OAuth 页面"
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

const isCodexSessionStorageUrl = (rawUrl?: string) => {
  try {
    const hostname = new URL(String(rawUrl || "")).hostname.toLowerCase()
    return CODEX_SESSION_STORAGE_HOSTNAMES.includes(hostname)
  } catch {
    return false
  }
}

/**
 * 判断是否是 Codex OAuth 完成后跳转出的本机回调地址。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 如果是带 code/state 的 localhost 回调地址则返回 true。
 */
const isLocalhostOAuthCallbackUrl = (rawUrl?: string) => {
  try {
    const parsed = new URL(String(rawUrl || ""))
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false
    }

    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return false
    }

    if (!["/auth/callback", "/codex/callback"].includes(parsed.pathname)) {
      return false
    }

    const code = parsed.searchParams.get("code")?.trim()
    const state = parsed.searchParams.get("state")?.trim()

    return Boolean(code && state)
  } catch {
    return false
  }
}

/**
 * 激活指定标签页，方便读取 2925 验证码后把浏览器切回 OpenAI 登录页。
 *
 * @param tabId 要激活的 Chrome 标签页 id。
 * @return 激活后的标签页信息。
 */
const activateBrowserTab = async (tabId: number) => {
  const tab = await chrome.tabs.update(tabId, { active: true })

  if (typeof tab.windowId === "number" && chrome.windows?.update) {
    try {
      await chrome.windows.update(tab.windowId, { focused: true })
    } catch {
      // 切换窗口只是改善体验，失败不影响后续验证码回填。
    }
  }

  return tab
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

const runPageActionInTab = async (
  targetUrl: string,
  actionOptions: PageActionByTextsOptions,
  actionArgs?: PageActionByTextsArgs,
  options: {
    reloadBeforeAction?: boolean
  } = {}
): Promise<CodexLoginPageActionResponse> => {
  const tabId = await findOrOpenTab(targetUrl)

  if (options.reloadBeforeAction) {
    await chrome.tabs.reload(tabId)
    await waitForTabLoaded(tabId)
  }

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
      targetTab: {
        id: tabId,
        url: tab.url
      }
    }
  }

  return {
    ok: true,
    message: value.message,
    targetTab: {
      id: tabId,
      url: tab.url
    }
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
): Promise<CodexLoginPageActionResponse> => {
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
        targetTab: {
          id: tabId,
          url: currentTab.url || tab.url
        }
      }
    }

    return {
      ok: true,
      message: value.message,
      targetTab: {
        id: tabId,
        url: currentTab.url || tab.url
      }
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
): Promise<StartCodexLoginStepResponse> => {
  // 第一步先刷新管理页，让页面从初始状态开始，避免复用到上次已点击后的中间状态。
  return runPageActionInTab(
    targetUrl,
    {
      targetTexts: CODEX_LOGIN_BUTTON_TEXTS,
      timeoutMs: 15000,
      successMessage: "已刷新管理页并点击“开始codex登录”按钮",
      failureMessage:
        "刷新管理页后仍未找到“开始codex登录”按钮，请确认管理页已登录并停留在 OAuth 页面"
    },
    undefined,
    {
      reloadBeforeAction: true
    }
  )
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
): Promise<OpenCodexAuthLinkResponse> => {
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
      targetTab: {
        id: tabId,
        url: tab.url
      }
    }
  }

  const managementTabId = await findOrOpenTab(targetUrl)
  const [extractResult] = await chrome.scripting.executeScript({
    target: { tabId: managementTabId },
    func: extractOpenaiOAuthAuthorizeUrlInPage
  })
  const extractValue = extractResult?.result
  const managementTab = await chrome.tabs.get(managementTabId)

  if (!extractValue?.ok || !extractValue.authUrl) {
    return {
      ok: false,
      message: `${cleanupMessage}${extractValue?.message || "未找到授权链接"}`,
      targetTab: {
        id: managementTabId,
        url: managementTab.url
      }
    }
  }

  // 不点击页面里的“打开链接”按钮，避免脚本点击触发 window.open 被浏览器拦截。
  const authTab = await chrome.tabs.create({
    active: true,
    url: extractValue.authUrl
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
    ok: true,
    message: `${cleanupMessage}已读取授权链接并打开 OpenAI 授权页`,
    targetTab: {
      id: authTab.id,
      url: authTab.url || extractValue.authUrl
    }
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
): Promise<FillOpenaiLoginEmailResponse> => {
  const result = await runPageActionInExistingTab(
    tabId,
    {
      targetTexts: OPENAI_LOGIN_BUTTON_TEXTS,
      timeoutMs: 15000,
      successMessage: CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE,
      failureMessage: CODEX_AUTH_CONTINUE_FAILURE_MESSAGE,
      submitStrategy: "requestSubmit"
    },
    {
      inputSelectors: OPENAI_LOGIN_INPUT_SELECTORS,
      inputValue: email
    }
  )

  if (!result.ok) {
    const currentUrl = String(result.targetTab?.url || "").trim()
    return {
      ...result,
      message: currentUrl
        ? `${result.message}；当前页：${currentUrl}`
        : result.message
    }
  }

  return result
}

/**
 * 在 OpenAI 邮箱验证码页读取 2925 验证码，并回填到当前 tab。
 *
 * @param tabId 要操作的验证码页标签页 id。
 * @param email 2925 邮箱地址。
 * @param password 2925 邮箱密码。
 * @return 返回给侧边栏展示的执行结果。
 */
export const fillOpenaiLoginVerificationCode = async (
  tabId: number,
  email: string,
  password: string
): Promise<FillOpenaiLoginVerificationCodeResponse> => {
  const mailResult = await fetchMail2925VerificationCode(email, password)

  if (!mailResult.code) {
    return {
      ok: false,
      message: mailResult.message,
      targetTab: {
        id: mailResult.mailTab?.id || tabId,
        url: mailResult.mailTab?.url
      },
      mailTab: mailResult.mailTab
    }
  }

  await activateBrowserTab(tabId)
  await waitForTabLoaded(tabId)
  const tab = await chrome.tabs.get(tabId)
  const currentUrl = String(tab.url || "").trim()
  if (!/\/email-verification(?:[/?#]|$)/i.test(currentUrl)) {
    return {
      ok: false,
      message: `当前标签页不是 OpenAI 邮箱验证码页（${currentUrl || "unknown"}）`,
      targetTab: {
        id: tabId,
        url: currentUrl || tab.url
      }
    }
  }

  const result = await runPageActionInExistingTab(
    tabId,
    {
      targetTexts: OPENAI_VERIFICATION_BUTTON_TEXTS,
      timeoutMs: 15000,
      successMessage: CODEX_AUTH_VERIFY_SUCCESS_MESSAGE,
      failureMessage: CODEX_AUTH_VERIFY_FAILURE_MESSAGE,
      submitStrategy: "requestSubmit"
    },
    {
      inputSelectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
      inputValue: mailResult.code
    }
  )

  if (!result.ok) {
    return {
      ...result,
      message: `${mailResult.message}；${result.message}`
    }
  }

  return {
    ...result,
    message: `${mailResult.message}；${result.message}`
  }
}

/**
 * 点击 OpenAI/Codex OAuth 授权确认页的“继续”，捕获 localhost 回调地址。
 *
 * @param tabId 当前 OpenAI 授权页标签页 id。
 * @return 捕获到的 localhost 回调地址；超时则返回空。
 */
const confirmOAuthConsentAndCaptureCallback = async (tabId: number) => {
  await activateBrowserTab(tabId)
  await waitForTabLoaded(tabId)

  const currentTab = await chrome.tabs.get(tabId)
  if (isLocalhostOAuthCallbackUrl(currentTab.url)) {
    return {
      ok: true,
      callbackUrl: String(currentTab.url || ""),
      targetTab: {
        id: tabId,
        url: currentTab.url
      },
      message: "当前页面已跳转到 localhost 回调地址"
    }
  }

  const abortController = new AbortController()
  const callbackUrlPromise = waitForTabMatchingUrl(
    tabId,
    isLocalhostOAuthCallbackUrl,
    {
      timeoutMs: 120000,
      intervalMs: 500,
      signal: abortController.signal
    }
  )

  const confirmResult = await runPageActionInExistingTab(tabId, {
    targetTexts: OPENAI_OAUTH_CONSENT_CONTINUE_BUTTON_TEXTS,
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_CONFIRM_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_CONFIRM_FAILURE_MESSAGE,
    submitStrategy: "requestSubmit"
  })

  if (!confirmResult.ok) {
    abortController.abort()
    return {
      ...confirmResult,
      callbackUrl: ""
    }
  }

  const callbackUrl = await callbackUrlPromise
  const latestTab = await chrome.tabs.get(tabId).catch(() => currentTab)

  if (!callbackUrl) {
    return {
      ok: false,
      message: "已点击授权确认页“继续”，但 120 秒内未捕获到 localhost 回调地址",
      targetTab: {
        id: tabId,
        url: latestTab.url
      },
      callbackUrl: ""
    }
  }

  return {
    ok: true,
    message: "已捕获 localhost 回调地址",
    targetTab: {
      id: tabId,
      url: callbackUrl
    },
    callbackUrl
  }
}

/**
 * 执行第五步：确认 OAuth 授权，捕获回调 URL，并提交回管理页。
 *
 * @param tabId 当前 OpenAI 授权页标签页 id。
 * @param targetUrl Codex 管理页 OAuth 地址。
 * @return 返回给侧边栏展示的执行结果。
 */
export const confirmCodexOAuthAndSubmitCallback = async (
  tabId: number,
  targetUrl: string
): Promise<ConfirmCodexOAuthCallbackResponse> => {
  const callbackResult = await confirmOAuthConsentAndCaptureCallback(tabId)

  if (!callbackResult.ok || !callbackResult.callbackUrl) {
    return callbackResult
  }

  const submitResult = await runPageActionInTab(
    targetUrl,
    {
      targetTexts: CODEX_CALLBACK_SUBMIT_BUTTON_TEXTS,
      timeoutMs: 15000,
      successMessage: CODEX_CALLBACK_SUBMIT_SUCCESS_MESSAGE,
      failureMessage: CODEX_CALLBACK_SUBMIT_FAILURE_MESSAGE,
      submitStrategy: "requestSubmit"
    },
    {
      inputSelectors: CODEX_CALLBACK_INPUT_SELECTORS,
      inputValue: callbackResult.callbackUrl
    }
  )

  if (!submitResult.ok) {
    return {
      ok: false,
      message: `已捕获回调地址，但提交到管理页失败：${submitResult.message}`,
      targetTab: callbackResult.targetTab,
      managementTab: submitResult.targetTab,
      callbackUrl: callbackResult.callbackUrl
    }
  }

  return {
    ok: true,
    message: `${callbackResult.message}；${submitResult.message}`,
    targetTab: callbackResult.targetTab,
    managementTab: submitResult.targetTab,
    callbackUrl: callbackResult.callbackUrl
  }
}
