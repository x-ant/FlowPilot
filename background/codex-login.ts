import {
  requestCpaOAuthUrl,
  submitCpaOAuthCallback
} from "./cpa-management-api"
import { createMail2925Runner } from "./mail-2925"
import {
  detectCodexAuthPageStateInPage,
  type DetectCodexAuthPageState
} from "./page-script"
import type {
  CodexAuthProgressStepResponse,
  ConfirmCodexOAuthConsentResponse,
  FetchAndSubmitCodexVerificationCodeResponse,
  OpenCodexAuthLinkApiResponse,
  SubmitCodexOAuthCallbackResponse
} from "./types"
import { abortableSleep, raceWithAbort, throwIfAborted } from "./utils/abort"
import {
  clearOpenTabSiteStorageForUrls,
  clearSessionCookiesForUrls,
  clearSiteStorageInTab
} from "./utils/browser-session-cleanup"
import { runAuthPageAction } from "./utils/page-action-runner"
import type { RunContext } from "./utils/run-context"
import { waitForTabLoaded, waitForTabMatchingUrl } from "./utils/tab-utils"

type OpenCodexAuthLinkOptions = {
  cleanupSession?: boolean
  managementKey?: string
  targetTabId?: number
}

export const createCodexLoginRunner = (context: RunContext = {}) => {
  const { fetchMail2925VerificationCode } = createMail2925Runner(context)
  const getAbortSignal = () => context.abortSignal

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
  const OPENAI_SESSION_CLEANUP_URLS = [
    "https://auth.openai.com/",
    "https://auth0.openai.com/",
    "https://accounts.openai.com/",
    "https://openai.com/",
    "https://www.openai.com/",
    "https://chat.openai.com/",
    "https://chatgpt.com/",
    "https://www.chatgpt.com/"
  ]
  /**
   * 判断是否是 Codex OAuth 完成后跳转出的本机回调地址。
   *
   * @param rawUrl 浏览器标签页当前 URL。
   * @return 如果是带 code/state 的 localhost 回调地址则返回 true。
   */
  const isCodexOAuthCallbackUrl = (rawUrl?: string) => {
    try {
      const parsed = new URL(String(rawUrl || ""))
      if (!["http:", "https:"].includes(parsed.protocol)) {
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

  type CodexAuthTabStateResult = {
    ok: boolean
    state: DetectCodexAuthPageState | "callback"
    message: string
    url: string
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
   * 读取当前 OpenAI 授权标签页的认证状态。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @return 认证页状态检测结果。
   */
  const detectCodexAuthTabState = async (
    tabId: number
  ): Promise<CodexAuthTabStateResult> => {
    const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
    const currentUrl = String(currentTab?.url || "")

    if (isCodexOAuthCallbackUrl(currentUrl)) {
      return {
        ok: true,
        state: "callback",
        message: "当前页面已跳转到 localhost 回调地址",
        url: currentUrl
      }
    }

    try {
      await waitForTabLoaded(tabId)
      const [detectInjectionResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectCodexAuthPageStateInPage
      })
      const detectValue = detectInjectionResult?.result

      return {
        ok: Boolean(detectValue?.ok),
        state: detectValue?.state || "other",
        message: detectValue?.message || "未识别当前 OpenAI 授权页状态",
        url: detectValue?.url || currentUrl
      }
    } catch (error) {
      return {
        ok: false,
        state: "other",
        message:
          error instanceof Error ? error.message : "授权页检测时页面暂不可用",
        url: currentUrl
      }
    }
  }

  /**
   * 等待 OpenAI 授权页进入指定状态。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @param acceptedStates 允许结束等待的状态。
   * @param options 等待参数。
   * @return 命中的状态；超时则返回最后一次检测状态。
   */
  const waitForCodexAuthTabState = async (
    tabId: number,
    acceptedStates: Array<CodexAuthTabStateResult["state"]>,
    options: {
      timeoutMs: number
      intervalMs?: number
      timeoutMessage: string
      stopStates?: Array<CodexAuthTabStateResult["state"]>
    }
  ): Promise<CodexAuthTabStateResult> => {
    const intervalMs = options.intervalMs || 500
    const abortSignal = getAbortSignal()
    const startedAt = Date.now()
    let lastState: CodexAuthTabStateResult = {
      ok: false,
      state: "other",
      message: options.timeoutMessage,
      url: ""
    }

    while (Date.now() - startedAt <= options.timeoutMs) {
      throwIfAborted(abortSignal)
      lastState = await detectCodexAuthTabState(tabId)

      if (acceptedStates.includes(lastState.state)) {
        return {
          ...lastState,
          ok: true
        }
      }

      if (options.stopStates?.includes(lastState.state)) {
        return lastState
      }

      await abortableSleep(intervalMs, abortSignal)
    }

    return {
      ...lastState,
      ok: false,
      message: `${lastState.message}；${options.timeoutMessage}`
    }
  }

  /**
   * 等待验证码提交后的页面结果。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @return 验证码提交后的状态。
   */
  const waitForCodexVerificationSubmitStateInTab = async (tabId: number) => {
    return waitForCodexAuthTabState(
      tabId,
      ["oauth_consent_ready", "callback", "verification_invalid_code"],
      {
        timeoutMs: 45000,
        intervalMs: 500,
        timeoutMessage: "45 秒内未确认验证码提交后的页面状态",
        stopStates: ["extra_verification"]
      }
    )
  }

  /**
   * 等待 OpenAI 页面真正进入 Codex OAuth 授权确认页。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @return 授权确认页是否已就绪。
   */
  const waitForCodexOAuthConsentReadyInTab = async (tabId: number) => {
    return waitForCodexAuthTabState(
      tabId,
      ["oauth_consent_ready", "callback"],
      {
        timeoutMs: 90000,
        intervalMs: 500,
        timeoutMessage: "90 秒内未进入可点击的 OAuth 授权确认页",
        stopStates: ["verification_invalid_code", "extra_verification"]
      }
    )
  }

  /**
   * 点击管理页入口，读取授权链接，打开 OpenAI 登录页，并清理旧会话。
   *
   * 这个步骤只负责把页面打开到 OpenAI 登录页，不再自动填写邮箱。
   *
   * @param targetUrl 侧边栏里填写的 Codex 登录地址。
   * @param options 打开授权链接前的会话处理选项。
   * @return 返回给侧边栏展示的执行结果。
   */
  const openCodexAuthLink = async (
    targetUrl: string,
    options: OpenCodexAuthLinkOptions = {}
  ): Promise<OpenCodexAuthLinkApiResponse> => {
    throwIfAborted(getAbortSignal())
    const shouldCleanupSession = options.cleanupSession ?? true
    const managementKey = String(options.managementKey || "").trim()
    if (!managementKey) {
      return {
        ok: false,
        message: "缺少 CPA 管理密钥，请先在侧边栏填写"
      }
    }

    // region ========== 打开授权链接前先清理旧cookie，减少复用到失效登录态的概率 ==========
    const cleanupMessage = shouldCleanupSession
      ? `${
          (await clearSessionCookiesForUrls(OPENAI_SESSION_CLEANUP_URLS))
            .message
        }；${
          (await clearOpenTabSiteStorageForUrls(OPENAI_SESSION_CLEANUP_URLS))
            .message
        }，`
      : "已保留当前 OpenAI 会话，"
    // endregion。

    // region ========== 直接通过 CPA 管理接口获取最新 OAuth 授权链接 ==========
    const apiResult = await requestCpaOAuthUrl(targetUrl, managementKey)
    throwIfAborted(getAbortSignal())
    const authTab =
      typeof options.targetTabId === "number"
        ? await chrome.tabs.update(options.targetTabId, {
            active: true,
            url: apiResult.oauthUrl
          })
        : await chrome.tabs.create({
            active: true,
            url: apiResult.oauthUrl
          })
    if (shouldCleanupSession && authTab.id) {
      try {
        await clearSiteStorageInTab(authTab.id)
      } catch {
        // Best effort only.
      }
    }
    // endregion

    // 整理结果
    throwIfAborted(getAbortSignal())
    return {
      ok: true,
      message: `${cleanupMessage}已通过 CPA 管理接口获取 OAuth 链接并${
        typeof options.targetTabId === "number" ? "复用当前 tab 打开" : "打开"
      } OpenAI 授权页`,
      cpaOAuthState: apiResult.oauthState,
      targetTab: {
        id: authTab.id,
        url: apiResult.oauthUrl
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
  const submitCodexLoginEmail = async (tabId: number, email: string) => {
    const result = await runAuthPageAction(tabId, {
      fields: [
        {
          selectors: OPENAI_LOGIN_INPUT_SELECTORS,
          value: email
        }
      ],
      button: {
        texts: OPENAI_LOGIN_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 15000,
      successMessage: CODEX_AUTH_CONTINUE_SUCCESS_MESSAGE,
      failureMessage: CODEX_AUTH_CONTINUE_FAILURE_MESSAGE
    })

    if (!result.ok) {
      const currentUrl = String(result.tab?.url || "").trim()
      return {
        ok: false,
        message: currentUrl
          ? `${result.message}；当前页：${currentUrl}`
          : result.message,
        targetTab: result.tab
      }
    }

    return {
      ok: true,
      message: result.message,
      targetTab: result.tab
    }
  }

  /**
   * 填写邮箱并等待 OpenAI 登录流程进入下一页。
   *
   * @param tabId 要操作的登录页标签页 id。
   * @param email 2925 邮箱地址。
   * @return 下一页状态；如果直接进入验证码页，会带上验证码发送时间。
   */
  const submitCodexLoginEmailAndWait = async (
    tabId: number,
    email: string
  ): Promise<CodexAuthProgressStepResponse> => {
    throwIfAborted(getAbortSignal())
    await waitForTabLoaded(tabId)

    const verificationRequestedAt = Date.now()
    const emailResult = await submitCodexLoginEmail(tabId, email)
    throwIfAborted(getAbortSignal())
    if (!emailResult.ok) {
      return emailResult
    }

    const authStepState = await waitForCodexAuthTabState(
      tabId,
      ["verification_pending", "password", "oauth_consent_ready", "callback"],
      {
        timeoutMs: 60000,
        intervalMs: 500,
        timeoutMessage: "60 秒内未进入密码页、邮箱验证码页或 OAuth 授权确认页",
        stopStates: ["extra_verification"]
      }
    )

    return {
      ok: authStepState.ok,
      message: `${emailResult.message}；${authStepState.message}`,
      targetTab: {
        id: tabId,
        url: authStepState.url
      },
      authState: authStepState.state,
      verificationRequestedAt:
        authStepState.state === "verification_pending"
          ? verificationRequestedAt
          : undefined
    }
  }

  /**
   * 等页面加载完成后
   * 在 OpenAI 密码页填写密码并提交。
   *
   * @param tabId 要操作的登录页标签页 id。
   * @param password Codex/OpenAI 登录密码。
   * @return 返回给侧边栏展示的执行结果。
   */
  const submitCodexLoginPassword = async (tabId: number, password: string) => {
    const result = await runAuthPageAction(tabId, {
      fields: [
        {
          selectors: OPENAI_PASSWORD_INPUT_SELECTORS,
          value: password
        }
      ],
      button: {
        texts: OPENAI_LOGIN_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 15000,
      successMessage: CODEX_AUTH_PASSWORD_SUCCESS_MESSAGE,
      failureMessage: CODEX_AUTH_PASSWORD_FAILURE_MESSAGE
    })

    if (!result.ok) {
      const currentUrl = String(result.tab?.url || "").trim()
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
   * 如果当前是密码页，则填写密码并等待验证码页；如果已经越过密码页则直接跳过。
   *
   * @param tabId 要操作的登录页标签页 id。
   * @param password Codex/OpenAI 登录密码。
   * @return 下一页状态；提交密码后进入验证码页时，会带上验证码发送时间。
   */
  const submitCodexLoginPasswordAndWait = async (
    tabId: number,
    password: string
  ): Promise<CodexAuthProgressStepResponse> => {
    throwIfAborted(getAbortSignal())
    const currentState = await detectCodexAuthTabState(tabId)
    if (
      currentState.state === "verification_pending" ||
      currentState.state === "oauth_consent_ready" ||
      currentState.state === "callback"
    ) {
      return {
        ok: true,
        message: `当前不需要填写密码；${currentState.message}`,
        targetTab: {
          id: tabId,
          url: currentState.url
        },
        authState: currentState.state,
        skipped: true
      }
    }

    if (currentState.state !== "password") {
      return {
        ok: false,
        message: `当前页面不是密码页，无法填写密码；${currentState.message}`,
        targetTab: {
          id: tabId,
          url: currentState.url
        },
        authState: currentState.state
      }
    }

    const verificationRequestedAt = Date.now()
    const passwordResult = await submitCodexLoginPassword(tabId, password)
    throwIfAborted(getAbortSignal())
    if (!passwordResult.ok) {
      return {
        ok: false,
        message: passwordResult.message,
        targetTab: passwordResult.tab,
        authState: "password"
      }
    }

    const verificationState = await waitForCodexAuthTabState(
      tabId,
      ["verification_pending", "oauth_consent_ready", "callback"],
      {
        timeoutMs: 60000,
        intervalMs: 500,
        timeoutMessage: "60 秒内未进入邮箱验证码页或 OAuth 授权确认页",
        stopStates: ["extra_verification"]
      }
    )

    return {
      ok: verificationState.ok,
      message: `${passwordResult.message}；${verificationState.message}`,
      targetTab: {
        id: tabId,
        url: verificationState.url
      },
      authState: verificationState.state,
      verificationRequestedAt:
        verificationState.state === "verification_pending"
          ? verificationRequestedAt
          : undefined
    }
  }

  /**
   * 在 OpenAI 邮箱验证码页读取 2925 验证码，并回填到当前 tab。
   *
   * @param tabId 要操作的验证码页标签页 id。
   * @param email 2925 邮箱地址。
   * @param password 2925 邮箱密码。
   * @param verificationRequestedAt 验证码发送时间
   * @return 返回给侧边栏展示的执行结果。
   */
  const fetchAndSubmitCodexVerificationCode = async (
    tabId: number,
    email: string,
    password: string,
    verificationRequestedAt = 0
  ): Promise<FetchAndSubmitCodexVerificationCodeResponse> => {
    throwIfAborted(getAbortSignal())
    const currentState = await detectCodexAuthTabState(tabId)
    if (
      currentState.state === "oauth_consent_ready" ||
      currentState.state === "callback"
    ) {
      return {
        ok: true,
        message: `当前不需要填写验证码；${currentState.message}`,
        targetTab: {
          id: tabId,
          url: currentState.url
        }
      }
    }

    if (currentState.state !== "verification_pending") {
      return {
        ok: false,
        message: `当前页面不是邮箱验证码页，无法回填验证码；${currentState.message}`,
        targetTab: {
          id: tabId,
          url: currentState.url
        }
      }
    }

    const maxAttempts = 2
    const excludedCodes: string[] = []
    const attemptMessages: string[] = []
    let latestMailTab: FetchAndSubmitCodexVerificationCodeResponse["mailTab"]

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(getAbortSignal())
      // region ========== 去2925邮箱获取验证码 ==========
      const mailResult = await fetchMail2925VerificationCode(email, password, {
        verificationRequestedAt,
        excludeCodes: excludedCodes
      })
      latestMailTab = mailResult.mailTab
      throwIfAborted(getAbortSignal())

      if (!mailResult.code) {
        return {
          ok: false,
          message: [...attemptMessages, mailResult.message]
            .filter(Boolean)
            .join("；"),
          targetTab: {
            id: mailResult.mailTab?.id || tabId,
            url: mailResult.mailTab?.url
          },
          mailTab: mailResult.mailTab
        }
      }
      // endregion

      // 回到登录页面输入验证码。是否真在验证码页交给输入框和提交后的页面状态判断。
      await activateBrowserTab(tabId)
      const result = await runAuthPageAction(tabId, {
        fields: [
          {
            selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
            value: mailResult.code,
            allowSplitInput: true
          }
        ],
        button: {
          texts: OPENAI_VERIFICATION_BUTTON_TEXTS,
          triggerMode: "requestSubmit"
        },
        timeoutMs: 15000,
        successMessage: CODEX_AUTH_VERIFY_SUCCESS_MESSAGE,
        failureMessage: CODEX_AUTH_VERIFY_FAILURE_MESSAGE
      })

      if (!result.ok) {
        return {
          ok: false,
          message: `${mailResult.message}；${result.message}`,
          targetTab: result.tab,
          mailTab: mailResult.mailTab
        }
      }

      const submitState = await waitForCodexVerificationSubmitStateInTab(tabId)
      const currentAttemptMessage = `${mailResult.message}；${result.message}；${submitState.message}`

      if (
        submitState.state === "oauth_consent_ready" ||
        submitState.state === "callback"
      ) {
        return {
          ok: true,
          message: currentAttemptMessage,
          targetTab: {
            id: tabId,
            url: submitState.url || result.tab?.url
          },
          mailTab: mailResult.mailTab
        }
      }

      if (submitState.state === "verification_invalid_code") {
        excludedCodes.push(mailResult.code)
        attemptMessages.push(
          `${currentAttemptMessage}；已排除本次验证码并准备重新读取`
        )

        if (attempt < maxAttempts) {
          continue
        }
      }

      return {
        ok: false,
        message: currentAttemptMessage,
        targetTab: {
          id: tabId,
          url: submitState.url || result.tab?.url
        },
        mailTab: mailResult.mailTab
      }
    }

    return {
      ok: false,
      message: attemptMessages.length
        ? attemptMessages.join("；")
        : "验证码提交失败",
      targetTab: {
        id: tabId
      },
      mailTab: latestMailTab
    }
  }

  /**
   * 点击 Codex OAuth 授权确认页的“继续”，捕获回调地址。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @return 捕获到的 localhost 回调地址；超时则返回空。
   */
  const confirmOAuthConsentAndCaptureCallback = async (tabId: number) => {
    throwIfAborted(getAbortSignal())
    await activateBrowserTab(tabId)
    await waitForTabLoaded(tabId)

    // region ========== 先判断一下是否已经是回调页面 ==========
    const currentTab = await chrome.tabs.get(tabId)
    if (isCodexOAuthCallbackUrl(currentTab.url)) {
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
    // endregion

    // region ========== 等待 OAuth 授权确认页真正就绪，避免过早点到验证码页按钮 ==========
    const consentReadyResult = await waitForCodexOAuthConsentReadyInTab(tabId)
    throwIfAborted(getAbortSignal())
    if (!consentReadyResult.ok) {
      return {
        ok: false,
        message: consentReadyResult.url
          ? `${consentReadyResult.message}；当前页：${consentReadyResult.url}`
          : consentReadyResult.message,
        targetTab: {
          id: tabId,
          url: consentReadyResult.url || currentTab.url
        },
        callbackUrl: ""
      }
    }

    if (
      consentReadyResult.state === "callback" &&
      isCodexOAuthCallbackUrl(consentReadyResult.url)
    ) {
      return {
        ok: true,
        callbackUrl: consentReadyResult.url,
        targetTab: {
          id: tabId,
          url: consentReadyResult.url
        },
        message: "当前页面已跳转到 localhost 回调地址"
      }
    }
    // endregion

    // region ========== 等待跳转到目标页面，这是个Promise，实际runAuthPageAction之后才可能结束 ==========
    const abortController = new AbortController()
    const callbackUrlPromise = waitForTabMatchingUrl(
      tabId,
      isCodexOAuthCallbackUrl,
      {
        timeoutMs: 120000,
        intervalMs: 500,
        signal: abortController.signal
      }
    )
    // endregion

    const confirmResult = await runAuthPageAction(tabId, {
      button: {
        texts: OPENAI_OAUTH_CONSENT_CONTINUE_BUTTON_TEXTS,
        triggerMode: "click"
      },
      timeoutMs: 15000,
      successMessage: CODEX_AUTH_CONFIRM_SUCCESS_MESSAGE,
      failureMessage: CODEX_AUTH_CONFIRM_FAILURE_MESSAGE
    })
    throwIfAborted(getAbortSignal())
    if (!confirmResult.ok) {
      abortController.abort()
      return {
        ok: false,
        message: confirmResult.message,
        targetTab: confirmResult.tab,
        callbackUrl: ""
      }
    }

    const callbackUrl = await raceWithAbort(
      callbackUrlPromise,
      getAbortSignal(),
      () => {
        abortController.abort()
      }
    )
    throwIfAborted(getAbortSignal())
    // 如果原tabId已经被关了，则处理异常，返回没关时候的地址
    const latestTab = await chrome.tabs.get(tabId).catch(() => currentTab)
    if (!callbackUrl) {
      return {
        ok: false,
        message:
          "已点击授权确认页“继续”，但 120 秒内未捕获到 localhost 回调地址",
        targetTab: {
          id: tabId,
          url: latestTab.url
        },
        callbackUrl: ""
      }
    } else {
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
  }

  /**
   * 执行第五步：点击 Codex OAuth 授权确认页的“继续”，捕获回调 URL。
   *
   * @param tabId 当前 OpenAI 授权页标签页 id。
   * @return 捕获到的 localhost 回调地址。
   */
  const confirmCodexOAuthConsent = async (
    tabId: number
  ): Promise<ConfirmCodexOAuthConsentResponse> => {
    return confirmOAuthConsentAndCaptureCallback(tabId)
  }

  /**
   * 执行第六步：把 OAuth 回调 URL 提交回 CPA 管理页。
   *
   * @param targetUrl CPA 地址。
   * @param managementKey CPA 管理密钥。
   * @param callbackUrl 第五步捕获到的 localhost 回调地址。
   * @param callbackTabId 可选，提交成功后关闭这个授权标签页。
   * @param cpaOAuthState 可选，用于校验回调 state 是否匹配当前授权会话。
   * @return 回填结果。
   */
  const submitCodexOAuthCallbackToCpa = async (
    targetUrl: string,
    managementKey: string,
    callbackUrl: string,
    callbackTabId?: number,
    cpaOAuthState = ""
  ): Promise<SubmitCodexOAuthCallbackResponse> => {
    throwIfAborted(getAbortSignal())
    let submitResult: Awaited<ReturnType<typeof submitCpaOAuthCallback>>
    try {
      submitResult = await submitCpaOAuthCallback(
        targetUrl,
        managementKey,
        callbackUrl,
        cpaOAuthState
      )
    } catch (error) {
      return {
        ok: false,
        message: `回填回调地址失败：${
          error instanceof Error ? error.message : "CPA 回调提交失败"
        }`,
        callbackUrl,
        cpaOAuthState
      }
    }
    throwIfAborted(getAbortSignal())
    const closedCallbackTab =
      typeof callbackTabId === "number"
        ? await closeBrowserTab(callbackTabId)
        : false

    return {
      ok: true,
      message: `${submitResult.verifiedStatus}；${
        closedCallbackTab
          ? "已关闭回调地址标签页"
          : "回调地址标签页未关闭或不需要关闭"
      }`,
      callbackUrl: submitResult.localhostUrl,
      cpaOAuthState,
      verifiedStatus: submitResult.verifiedStatus
    }
  }

  return {
    openCodexAuthLink,
    submitCodexLoginEmailAndWait,
    submitCodexLoginPasswordAndWait,
    fetchAndSubmitCodexVerificationCode,
    confirmCodexOAuthConsent,
    submitCodexOAuthCallbackToCpa
  }
}

const defaultCodexLoginRunner = createCodexLoginRunner()

export const {
  openCodexAuthLink,
  submitCodexLoginEmailAndWait,
  submitCodexLoginPasswordAndWait,
  fetchAndSubmitCodexVerificationCode,
  confirmCodexOAuthConsent,
  submitCodexOAuthCallbackToCpa
} = defaultCodexLoginRunner
