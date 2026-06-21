import { fetchMail2925VerificationCode } from "./mail-2925"
import {
  extractCodexOAuthUrlInPage,
  performPageActionInPage,
  type PageActionConfig
} from "./page-script"
import {
  findOrOpenTab,
  waitForTabLoaded,
  waitForTabMatchingUrl
} from "./tab-utils"
import type {
  CodexLoginPageActionResponse,
  CompleteCodexLoginEmailAuthFlowResponse,
  ConfirmCodexOAuthCallbackResponse,
  FetchAndSubmitCodexVerificationCodeResponse,
  OpenCodexAuthLinkResponse,
  SubmitCodexLoginEmailResponse
} from "./types"

const CODEX_LOGIN_BUTTON_TEXTS = ["开始 Codex 登录"]

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
const OPENAI_PASSWORD_INPUT_SELECTORS = [
  "input[type='password']",
  "input[autocomplete='current-password']",
  "input[name='password']",
  "input[id*='password' i]",
  "input[placeholder*='password' i]",
  "input[placeholder*='密码']",
  "input[aria-label*='password' i]",
  "input[aria-label*='密码']"
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
const CODEX_AUTH_PASSWORD_SUCCESS_MESSAGE = "已填写密码并点击“继续”按钮"
const CODEX_AUTH_PASSWORD_FAILURE_MESSAGE =
  "未找到密码输入框或“继续”按钮，请确认页面已打开到 OpenAI 密码页"
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
 * 判断当前页面是否已经进入 OpenAI 邮箱验证码页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 如果是邮箱验证码页则返回 true。
 */
const isCodexVerificationCodeUrl = (rawUrl?: string) => {
  return /\/email-verification(?:[/?#]|$)/i.test(String(rawUrl || "").trim())
}

/**
 * 判断当前页面是否已经进入 OpenAI 密码页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 如果是密码页则返回 true。
 */
const isCodexPasswordUrl = (rawUrl?: string) => {
  try {
    const parsed = new URL(String(rawUrl || ""))
    return (
      parsed.hostname.toLowerCase() === "auth.openai.com" &&
      /\/password(?:[/?#]|$)/i.test(parsed.pathname)
    )
  } catch {
    return false
  }
}

/**
 * 激活指定标签页，并切把当前浏览器也放前面。
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
 * 等待一小段时间，用于页面生成授权链接等异步场景。
 *
 * @param milliseconds 等待毫秒数。
 * @return 等待完成后 resolve。
 */
const sleep = (milliseconds: number) => {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })
}

/**
 * 关闭指定标签页，常用于 OAuth 回调地址已经提交后的资源释放。
 *
 * @param tabId 要关闭的 Chrome 标签页 id。
 * @return 关闭成功返回 true；标签页已不存在或关闭失败时返回 false。
 */
const closeBrowserTab = async (tabId: number) => {
  try {
    await chrome.tabs.remove(tabId)
    return true
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
  const [storageInjectionResult] = await chrome.scripting.executeScript({
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

  const value = storageInjectionResult?.result as
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

type RunPageActionInTabOptions = {
  reloadBeforeAction?: boolean
}

/**
 * 在已经确定的标签页里注入并执行一次页面动作。
 *
 * @param tabId 要操作的标签页 id。
 * @param action 注入到页面里执行的动作配置。
 * @return 返回给侧边栏展示的页面动作结果。
 */
const runPageActionInTab = async (
  tabId: number,
  action: PageActionConfig
): Promise<CodexLoginPageActionResponse> => {
  const originalTab = await chrome.tabs.get(tabId)

  // executeScript的返回值一定是Promise，需要await，
  // 但是func参数的返回值如果是Promise会自动执行await，如果不是就直接返回
  const [actionInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: performPageActionInPage,
    args: [action]
  })

  // 这个value 就是performPageActionInPage的返回值
  // 如果performPageActionInPage返回值是Promise会自动执行await，如果不是就直接返回
  // 总之这里的actionInjectionResult?.result一定是处理好的最终结果
  const value = actionInjectionResult?.result
  const currentTab = await chrome.tabs.get(tabId)

  if (!value?.ok) {
    return {
      ok: false,
      message: value?.message || action.failureMessage,
      targetTab: {
        id: tabId,
        url: currentTab.url || originalTab.url
      }
    }
  }

  return {
    ok: true,
    message: value.message,
    targetTab: {
      id: tabId,
      url: currentTab.url || originalTab.url
    }
  }
}

/**
 * 打开或复用指定地址的标签页，并在该标签页里执行一次页面动作。
 *
 * @param targetUrl 要打开或复用的页面地址。
 * @param action 注入到页面里执行的动作配置。
 * @param tabOptions 执行动作前的标签页级选项，例如是否先刷新页面。
 * @return 返回给侧边栏展示的页面动作结果。
 */
const runPageActionInTargetUrl = async (
  targetUrl: string,
  action: PageActionConfig,
  tabOptions: RunPageActionInTabOptions = {}
): Promise<CodexLoginPageActionResponse> => {
  const tabId = await findOrOpenTab(targetUrl)

  if (tabOptions.reloadBeforeAction) {
    await chrome.tabs.reload(tabId)
    await waitForTabLoaded(tabId)
  }

  return runPageActionInTab(tabId, action)
}

/**
 * 在已保存的授权页标签里执行页面动作。
 *
 * @param tabId 要操作的标签页 id。
 * @param action 页面动作配置。
 * @return 返回给侧边栏展示的执行结果。
 */
const runPageActionInAuthTab = async (
  tabId: number,
  action: PageActionConfig
): Promise<CodexLoginPageActionResponse> => {
  try {
    return await runPageActionInTab(tabId, action)
  } catch {
    return {
      ok: false,
      message: "未找到可操作的登录页标签，请先执行步骤 1"
    }
  }
}

/**
 * 等待管理页生成 OpenAI OAuth 授权链接。
 *
 * @param tabId Codex 管理页标签页 id。
 * @return 读取到的授权链接和管理页信息。
 */
const waitForCodexAuthorizeUrlInTab = async (tabId: number) => {
  const timeoutMs = 15000
  const intervalMs = 500
  const startedAt = Date.now()
  let lastMessage = "未找到授权链接"

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const [extractInjectionResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractCodexOAuthUrlInPage
      })
      const extractValue = extractInjectionResult?.result
      const managementTab = await chrome.tabs.get(tabId)

      if (extractValue?.ok && extractValue.authUrl) {
        return {
          ok: true,
          message: extractValue.message,
          authUrl: extractValue.authUrl,
          targetTab: {
            id: tabId,
            url: managementTab.url
          }
        }
      }

      lastMessage = extractValue?.message || lastMessage
    } catch (error) {
      lastMessage =
        error instanceof Error ? error.message : "读取授权链接时页面暂不可用"
    }

    await sleep(intervalMs)
  }

  const managementTab = await chrome.tabs.get(tabId).catch(() => undefined)
  return {
    ok: false,
    message: lastMessage,
    authUrl: "",
    targetTab: {
      id: tabId,
      url: managementTab?.url
    }
  }
}

/**
 * 点击管理页入口，读取授权链接，打开 OpenAI 登录页，并清理旧会话。
 *
 * 这个步骤只负责把页面打开到 OpenAI 登录页，不再自动填写邮箱。
 *
 * @param targetUrl 侧边栏里填写的 Codex 登录地址。
 * @return 返回给侧边栏展示的执行结果。
 */
export const openCodexAuthLink = async (
  targetUrl: string
): Promise<OpenCodexAuthLinkResponse> => {
  // region ========== 打开授权链接前先清理旧cookie，减少复用到失效登录态的概率 ==========
  const cleanupResult = await clearCodexSessionCookies()
  const storageResult = await clearCodexSessionStorage()
  const cleanupMessage = `${cleanupResult.message}；${storageResult.message}，`
  // endregion。

  // region ========== 到cpa点击开始Codex登录 ==========
  const runPageActionResult = await runPageActionInTargetUrl(
    targetUrl,
    {
      button: {
        texts: CODEX_LOGIN_BUTTON_TEXTS
      },
      timeoutMs: 15000,
      successMessage: "已刷新管理页并点击“开始codex登录”按钮",
      failureMessage:
        "刷新管理页后仍未找到“开始codex登录”按钮，请确认管理页已登录并停留在 OAuth 页面"
    },
    {
      reloadBeforeAction: true
    }
  )
  // 处理失败
  if (!runPageActionResult.ok) {
    return {
      ok: false,
      message: `${cleanupMessage}${runPageActionResult.message}`,
      targetTab: runPageActionResult.targetTab
    }
  }
  // 拿到cpa页面得tabId
  const managementTabId = runPageActionResult.targetTab?.id
  if (typeof managementTabId !== "number") {
    return {
      ok: false,
      message: `${cleanupMessage}已点击“开始codex登录”，但未拿到管理页标签页`,
      targetTab: runPageActionResult.targetTab
    }
  }
  // endregion

  // region ========== 从cpa页面中获取codex的登录地址 ==========
  const extractResult = await waitForCodexAuthorizeUrlInTab(managementTabId)
  if (!extractResult.ok || !extractResult.authUrl) {
    return {
      ok: false,
      message: `${cleanupMessage}${extractResult.message}`,
      targetTab: extractResult.targetTab
    }
  }
  // 不使用页面里的“打开链接”按钮，避免脚本点击触发 window.open 被浏览器拦截。
  const authTab = await chrome.tabs.create({
    active: true,
    url: extractResult.authUrl
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
  // endregion

  // 整理结果
  return {
    ok: true,
    message: `${cleanupMessage}${runPageActionResult.message}；已读取授权链接并打开 OpenAI 授权页`,
    targetTab: {
      id: authTab.id,
      url: extractResult.authUrl
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
export const submitCodexLoginEmail = async (
  tabId: number,
  email: string
): Promise<SubmitCodexLoginEmailResponse> => {
  const result = await runPageActionInAuthTab(tabId, {
    fields: [
      {
        selectors: OPENAI_LOGIN_INPUT_SELECTORS,
        value: email
      }
    ],
    button: {
      texts: OPENAI_LOGIN_BUTTON_TEXTS,
      submitStrategy: "requestSubmit"
    },
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_CONTINUE_FAILURE_MESSAGE
  })

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
 * 在 OpenAI 密码页填写密码并提交。
 *
 * @param tabId 要操作的登录页标签页 id。
 * @param password Codex/OpenAI 登录密码。
 * @return 返回给侧边栏展示的执行结果。
 */
const submitCodexLoginPassword = async (
  tabId: number,
  password: string
): Promise<CodexLoginPageActionResponse> => {
  const result = await runPageActionInAuthTab(tabId, {
    fields: [
      {
        selectors: OPENAI_PASSWORD_INPUT_SELECTORS,
        value: password
      }
    ],
    button: {
      texts: OPENAI_LOGIN_BUTTON_TEXTS,
      submitStrategy: "requestSubmit"
    },
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_PASSWORD_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_PASSWORD_FAILURE_MESSAGE
  })

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
export const fetchAndSubmitCodexVerificationCode = async (
  tabId: number,
  email: string,
  password: string
): Promise<FetchAndSubmitCodexVerificationCodeResponse> => {

  // region ========== 获取验证码 ==========
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
  // endregion

  await activateBrowserTab(tabId)
  await waitForTabLoaded(tabId)
  const tab = await chrome.tabs.get(tabId)
  const currentUrl = String(tab.url || "").trim()
  if (!isCodexVerificationCodeUrl(currentUrl)) {
    return {
      ok: false,
      message: `当前标签页不是 OpenAI 邮箱验证码页（${currentUrl || "unknown"}）`,
      targetTab: {
        id: tabId,
        url: currentUrl || tab.url
      }
    }
  }

  const result = await runPageActionInAuthTab(tabId, {
    fields: [
      {
        selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
        value: mailResult.code,
        allowSplitInput: true
      }
    ],
    button: {
      texts: OPENAI_VERIFICATION_BUTTON_TEXTS,
      submitStrategy: "requestSubmit"
    },
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_VERIFY_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_VERIFY_FAILURE_MESSAGE
  })

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
 * 完成 OpenAI 邮箱登录认证流程。
 *
 * 流程可能是“邮箱 -> 验证码”，也可能是“邮箱 -> 密码 -> 验证码”。
 *
 * @param tabId 要操作的登录页标签页 id。
 * @param email 2925 邮箱地址。
 * @param password 2925 邮箱密码。
 * @return 返回给侧边栏展示的执行结果。
 */
export const completeCodexLoginEmailAuthFlow = async (
  tabId: number,
  email: string,
  password: string
): Promise<CompleteCodexLoginEmailAuthFlowResponse> => {

  // region ========== 邮箱登录，并正确进入下一个地址 ==========
  const emailResult = await submitCodexLoginEmail(tabId, email)
  if (!emailResult.ok) {
    return emailResult
  }
  const authStepUrl = await waitForTabMatchingUrl(
    tabId,
    (url) => {
      return isCodexVerificationCodeUrl(url) || isCodexPasswordUrl(url)
    },
    {
      timeoutMs: 60000,
      intervalMs: 500
    }
  )
  if (!authStepUrl) {
    const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
    return {
      ok: false,
      message: `${emailResult.message}；60 秒内未进入密码页或邮箱验证码页（${
        currentTab?.url || "unknown"
      }）`,
      targetTab: {
        id: tabId,
        url: currentTab?.url
      }
    }
  }
  // endregion

  // region ========== 有可能还需要输入登录密码 ==========
  let passwordResult: CodexLoginPageActionResponse | undefined
  if (isCodexPasswordUrl(authStepUrl)) {
    passwordResult = await submitCodexLoginPassword(tabId, password)
    if (!passwordResult.ok) {
      return {
        ...passwordResult,
        message: `${emailResult.message}；${passwordResult.message}`
      }
    }
    const verificationUrl = await waitForTabMatchingUrl(
      tabId,
      isCodexVerificationCodeUrl,
      {
        timeoutMs: 60000,
        intervalMs: 500
      }
    )
    if (!verificationUrl) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
      return {
        ok: false,
        message: `${emailResult.message}；${passwordResult.message}；60 秒内未进入邮箱验证码页（${
          currentTab?.url || "unknown"
        }）`,
        targetTab: {
          id: tabId,
          url: currentTab?.url
        }
      }
    }
  }
  // endregion

  // region ========== 已经进入验证码页面，则获取验证码并输入提交 ==========
  const codeResult = await fetchAndSubmitCodexVerificationCode(
    tabId,
    email,
    password
  )
  // endregion


  return {
    ...codeResult,
    message: [emailResult.message, passwordResult?.message, codeResult.message]
      .filter(Boolean)
      .join("；")
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

  const confirmResult = await runPageActionInAuthTab(tabId, {
    button: {
      texts: OPENAI_OAUTH_CONSENT_CONTINUE_BUTTON_TEXTS,
      submitStrategy: "requestSubmit"
    },
    timeoutMs: 15000,
    successMessage: CODEX_AUTH_CONFIRM_SUCCESS_MESSAGE,
    failureMessage: CODEX_AUTH_CONFIRM_FAILURE_MESSAGE
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
 * 执行第三步：确认 OAuth 授权，捕获回调 URL，并提交回管理页。
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

  const submitResult = await runPageActionInTargetUrl(targetUrl, {
    fields: [
      {
        selectors: CODEX_CALLBACK_INPUT_SELECTORS,
        value: callbackResult.callbackUrl
      }
    ],
    button: {
      texts: CODEX_CALLBACK_SUBMIT_BUTTON_TEXTS,
      submitStrategy: "requestSubmit"
    },
    timeoutMs: 15000,
    successMessage: CODEX_CALLBACK_SUBMIT_SUCCESS_MESSAGE,
    failureMessage: CODEX_CALLBACK_SUBMIT_FAILURE_MESSAGE
  })

  if (!submitResult.ok) {
    return {
      ok: false,
      message: `已捕获回调地址，但提交到管理页失败：${submitResult.message}`,
      targetTab: callbackResult.targetTab,
      managementTab: submitResult.targetTab,
      callbackUrl: callbackResult.callbackUrl
    }
  }

  const closedCallbackTab = await closeBrowserTab(tabId)

  return {
    ok: true,
    message: `${callbackResult.message}；${submitResult.message}；${
      closedCallbackTab
        ? "已关闭回调地址标签页"
        : "回调地址标签页已不存在或关闭失败"
    }`,
    managementTab: submitResult.targetTab,
    callbackUrl: callbackResult.callbackUrl
  }
}
