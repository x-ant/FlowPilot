import type { ManagedAccount } from "../../shared/account-state"
import type { CodexRegisterStepResponse } from "../../shared/flow-contracts"
import type { OAuthBinding, OAuthIntegrationConfig } from "../../shared/sub2api"
import {
  createMailVerificationRunner,
  type VerificationCodeResult
} from "../integrations/mail-verification"
import { createCodexLoginRunner } from "../login/steps"
import { detectCodexAuthPageStateInPage } from "../page-scripts/page-script"
import { abortableSleep } from "../utils/abort"
import {
  clearOpenTabSiteStorageForUrls,
  clearSessionCookiesForUrls,
  clearSiteStorageInTab
} from "../utils/browser-session-cleanup"
import {
  getOpenAiAuthUrlState,
  isCodexOAuthCallbackUrl,
  isOpenAiAddPhoneUrl,
  isOpenAiChooseAccountUrl,
  isOpenAiCodexConsentUrl,
  isOpenAiPhoneVerificationUrl,
  isOpenAiRegisterPasswordUrl,
  isOpenAiRegisterProfileUrl
} from "../utils/openai-auth-url"
import {
  detectPageButtonByTextInPage,
  runPageActionInTab
} from "../utils/page-action-runner"
import type { RunContext } from "../utils/run-context"
import {
  findOrOpenTab,
  isStableTabMatchingUrl,
  waitForTabLoaded,
  waitForTabMatchingUrl
} from "../utils/tab-utils"
import { retryVerificationCodeOnInvalidCode } from "../utils/verification-code-retry"
import {
  assertHeroSmsActivationCostWithinExpected,
  pollHeroSmsCode,
  requestHeroSmsActivation,
  setHeroSmsActivationStatus,
  type HeroSmsActivation,
  type HeroSmsPhoneVerificationOptions
} from "./phone-verification"
import {
  getOpenAiAuthPageErrorInPage,
  getPhoneNumberSubmitFailureInPage,
  requestHistoryBackInPage,
  submitPhoneNumberInPage,
  waitForPhoneInputInPage
} from "./phone-verification-page"
import { submitRegisterProfileInPage } from "./register-profile-page"

const CHATGPT_SIGNUP_ENTRY_URL = "https://chatgpt.com/"
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
const DEFAULT_REGISTER_FULL_NAME = "drizzle"
const DEFAULT_REGISTER_AGE = 20
const REGISTER_OAUTH_VALID_MS = 5 * 60 * 1000
/**
 * 预估一次返回获取新手机号，然后循环获取验证码的时间为140秒
 */
const REGISTER_PHONE_RETRY_MIN_REMAINING_MS = 140 * 1000
const REGISTER_PHONE_CODE_MAX_SUBMIT_ATTEMPTS = 3
const PHONE_SUBMIT_OUTCOME_TIMEOUT_MS = 20 * 1000
const PHONE_SUBMIT_OUTCOME_INTERVAL_MS = 500
const PHONE_SUBMIT_FAILURE_STABLE_COUNT = 2

const isReusableOpenAiTabUrl = (rawUrl?: string) => {
  try {
    const hostname = new URL(String(rawUrl || "")).hostname.toLowerCase()
    return (
      hostname === "auth.openai.com" ||
      hostname === "auth0.openai.com" ||
      hostname === "accounts.openai.com" ||
      hostname === "openai.com" ||
      hostname === "www.openai.com" ||
      hostname === "chat.openai.com" ||
      hostname === "chatgpt.com" ||
      hostname === "www.chatgpt.com"
    )
  } catch {
    return false
  }
}

const findReusableOpenAiTabId = async () => {
  const tabs = await chrome.tabs.query({})
  return tabs.find((tab) => {
    return typeof tab.id === "number" && isReusableOpenAiTabUrl(tab.url)
  })?.id
}

const isRegisterOAuthLoginFlowUrl = (rawUrl?: string) => {
  const state = getOpenAiAuthUrlState(rawUrl)
  return [
    "login_email_entry",
    "login_password",
    "email_verification",
    "oauth_account_choice",
    "phone_number_entry",
    "phone_verification",
    "oauth_consent",
    "oauth_callback"
  ].includes(state)
}

type RegisterPhoneVerificationSubmitState = {
  ok: boolean
  state: string
  message: string
  url: string
  releaseActivation?: boolean
}

type RegisterEmailVerificationSubmitState = {
  state: string
  message: string
  url: string
}

type HistoryBackGuardResult =
  | boolean
  | {
      ok: boolean
      message?: string
    }

const normalizeHistoryBackGuardResult = (
  result: HistoryBackGuardResult
): { ok: boolean; message: string } => {
  if (typeof result === "boolean") {
    return {
      ok: result,
      message: result ? "" : "回退保护条件未通过"
    }
  }

  return {
    ok: Boolean(result.ok),
    message: result.message || (result.ok ? "" : "回退保护条件未通过")
  }
}

/**
 * 把未知异常转成日志可读文本。
 *
 * @param error 捕获到的异常对象。
 * @return 可展示的错误信息。
 */
const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error || "未知错误")
}

/**
 * 把 Chrome tab 的加载状态整理成适合日志阅读的文本。
 *
 * @param tab Chrome 标签页；为空时返回 unknown。
 * @return 包含 status、url 和 pendingUrl 的诊断文本。
 */
const describeTabLoadState = (tab: chrome.tabs.Tab | null | undefined) => {
  const pendingUrl = String(tab?.pendingUrl || "")
  return [
    `status=${tab?.status || "unknown"}`,
    `url=${tab?.url || "unknown"}`,
    pendingUrl ? `pendingUrl=${pendingUrl}` : ""
  ]
    .filter(Boolean)
    .join("，")
}

type NavigationTraceDetails = {
  tabId: number
  frameId?: number
  parentFrameId?: number
  url?: string
  transitionType?: string
  transitionQualifiers?: string[]
  error?: string
  timeStamp?: number
}

/**
 * 格式化 Chrome webNavigation 事件。
 *
 * webNavigation 能提供 transitionType / transitionQualifiers / error 等信息，
 * 用来判断跳转更像浏览器前进后退、页面脚本跳转、服务端重定向还是导航错误。
 *
 * @param eventName 导航事件名。
 * @param details Chrome 导航事件详情。
 * @return 适合写入执行日志的诊断文本。
 */
const formatNavigationTraceDetail = (
  eventName: string,
  details: NavigationTraceDetails
) => {
  const transitionQualifiers = Array.isArray(details.transitionQualifiers)
    ? details.transitionQualifiers.join(",")
    : ""

  return [
    `event=${eventName}`,
    typeof details.frameId === "number" ? `frameId=${details.frameId}` : "",
    typeof details.parentFrameId === "number"
      ? `parentFrameId=${details.parentFrameId}`
      : "",
    details.url ? `url=${details.url}` : "",
    details.transitionType ? `transitionType=${details.transitionType}` : "",
    transitionQualifiers ? `transitionQualifiers=${transitionQualifiers}` : "",
    details.error ? `error=${details.error}` : "",
    typeof details.timeStamp === "number"
      ? `timeStamp=${details.timeStamp}`
      : ""
  ]
    .filter(Boolean)
    .join("，")
}

/**
 * 监听当前标签页的 Chrome 导航事件。
 *
 * 这里只在回退异常时把事件汇总写入日志，避免正常流程被调试日志刷屏。
 * 事件能帮助确认
 * `/add-phone -> /phone-verification` 是 history 回退恢复、前端跳转、服务端
 * 重定向还是 Chrome 导航错误。
 *
 * @param tabId 当前注册流程标签页 ID。
 * @param onLog 写入侧边栏日志的回调。
 * @param label 当前诊断日志前缀。
 * @return 停止监听并返回本次收集到的导航事件。
 */
const startTabNavigationTrace = (
  tabId: number,
  onLog: HeroSmsPhoneVerificationOptions["onLog"]
) => {
  if (!chrome.webNavigation) {
    onLog?.("warn", "webNavigation 权限不可用，无法记录回退导航事件")
    return () => [] as string[]
  }

  const events: string[] = []
  const record = (eventName: string, details: NavigationTraceDetails) => {
    if (details.tabId !== tabId) {
      return
    }

    const detailText = formatNavigationTraceDetail(eventName, details)
    events.push(detailText)
  }

  const onBeforeNavigate = (
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails
  ) => {
    record("onBeforeNavigate", details)
  }
  const onCommitted = (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ) => {
    record("onCommitted", details)
  }
  const onHistoryStateUpdated = (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ) => {
    record("onHistoryStateUpdated", details)
  }
  const onCompleted = (
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails
  ) => {
    record("onCompleted", details)
  }
  const onErrorOccurred = (
    details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails
  ) => {
    record("onErrorOccurred", details)
  }

  chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate)
  chrome.webNavigation.onCommitted.addListener(onCommitted)
  chrome.webNavigation.onHistoryStateUpdated.addListener(onHistoryStateUpdated)
  chrome.webNavigation.onCompleted.addListener(onCompleted)
  chrome.webNavigation.onErrorOccurred.addListener(onErrorOccurred)

  return () => {
    chrome.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate)
    chrome.webNavigation.onCommitted.removeListener(onCommitted)
    chrome.webNavigation.onHistoryStateUpdated.removeListener(
      onHistoryStateUpdated
    )
    chrome.webNavigation.onCompleted.removeListener(onCompleted)
    chrome.webNavigation.onErrorOccurred.removeListener(onErrorOccurred)

    return events
  }
}

/**
 * 汇总 HeroSMS 买号结果里的扣费和号码信息。
 *
 * selectedPrice 是本地请求的固定价格档位，activationCost 是 HeroSMS 返回的实际成本；
 * 两者同时展示，方便核对真实扣费是否符合预期。
 *
 * @param activation HeroSMS getNumberV2 返回并规范化后的激活信息。
 * @return 可追加到注册日志里的简短描述。
 */
const formatHeroSmsActivationSummary = (activation: HeroSmsActivation) => {
  return [
    `订单 ${activation.activationId}`,
    activation.selectedPrice ? `请求档位 ${activation.selectedPrice}` : "",
    `实际成本 ${activation.activationCost}`,
    `币种 ${activation.currency}`,
    `运营商 ${activation.activationOperator}`,
    `国家码 ${activation.countryCode}`,
    `手机号区号 ${activation.countryPhoneCode}`,
    `结束时间 ${activation.activationEndTime}`
  ]
    .filter(Boolean)
    .join("，")
}

const isChatGptPageUrl = (rawUrl?: string) => {
  try {
    const url = new URL(String(rawUrl || ""))
    return (
      url.protocol === "https:" &&
      ["chatgpt.com", "www.chatgpt.com"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

const detectChatGptEntryPageReadyInPage = () => {
  const hostname = window.location.hostname.toLowerCase()
  const isChatGptHost =
    hostname === "chatgpt.com" || hostname === "www.chatgpt.com"
  if (!isChatGptHost) {
    return {
      ok: false,
      message: `当前页面不是 ChatGPT：${window.location.href}`
    }
  }

  const body = document.body
  const text = body?.innerText?.replace(/\s+/g, " ").trim() || ""
  const hasContent = Boolean(body && (body.children.length > 0 || text))
  if (!hasContent) {
    return {
      ok: false,
      message: "ChatGPT 页面主体为空"
    }
  }

  return {
    ok: true,
    message: "ChatGPT 页面已加载并可注入"
  }
}

const isHeroSmsCodeTimeoutError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "")
  return /^等待手机验证码超时/.test(message)
}

const isChromeErrorPageInjectionMessage = (message: string) => {
  return /Frame with ID \d+ is showing error page|showing error page/i.test(
    String(message || "")
  )
}

const formatPhoneVerificationPageInjectionMessage = (
  message: string,
  rawUrl?: string
) => {
  if (!isChromeErrorPageInjectionMessage(message)) {
    return message
  }

  return `手机号验证页脚本注入失败，Chrome 判断当前页面是错误页，页面可能异常或显示 500；原始错误：${message}；当前 URL：${
    rawUrl || "unknown"
  }`
}

const isOpenAiPhoneVerificationRateLimited = (message: string) => {
  return /请求手机验证的次数过多|手机验证.*次数过多|too many.*phone.*verification|phone verification.*too many|try again later|稍后再试/i.test(
    String(message || "")
  )
}

const isOpenAiPhoneSubmitFailureMessage = (message: string) => {
  const text = String(message || "")
  return (
    isOpenAiPhoneVerificationRateLimited(text) ||
    /电话号码已被使用|手机号已被使用|号码已被使用|请使用其他电话号码|phone number.*(already|used|invalid|not valid|different)|already.*phone|number.*already.*used|invalid.*phone|not a valid phone/i.test(
      text
    )
  )
}

const isOpenAiPhoneSubmitPageErrorMessage = (message: string) => {
  return /failed to fetch|糟糕.*出错|出错了/i.test(String(message || ""))
}

const formatDurationSeconds = (ms: number) => {
  return `${Math.max(0, Math.floor(ms / 1000))} 秒`
}

type PhoneSubmitOutcome =
  | {
      status: "verification"
      url: string
    }
  | {
      status: "failure"
      message: string
      url: string
    }
  | {
      status: "page_error"
      message: string
      url: string
    }
  | {
      status: "timeout"
      url: string
    }

/**
 * 等待手机号提交后的页面结果。
 *
 * 成功仍以 `/phone-verification` URL 为准；失败只在 `/add-phone` 页面上读取明确
 * 手机号错误或 OpenAI 错误页，并要求同一错误连续稳定出现，避免 React
 * 短暂渲染状态被误判。
 *
 * @param tabId OpenAI 授权页标签页 id。
 * @param signal 外层流程取消信号。
 * @return 手机号提交后的成功、失败或超时结果。
 */
const waitForPhoneSubmitOutcome = async (
  tabId: number,
  signal?: AbortSignal,
  onLog?: HeroSmsPhoneVerificationOptions["onLog"]
): Promise<PhoneSubmitOutcome> => {
  let latestUrl = ""
  let stableFailureMessage = ""
  let stableFailureCount = 0
  let stablePageErrorMessage = ""
  let stablePageErrorCount = 0
  const startedAt = Date.now()

  while (Date.now() - startedAt < PHONE_SUBMIT_OUTCOME_TIMEOUT_MS) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }

    const currentTab = await chrome.tabs.get(tabId).catch(() => null)
    latestUrl = currentTab?.url || latestUrl

    if (isOpenAiPhoneVerificationUrl(latestUrl)) {
      onLog?.(
        "info",
        `手机号提交结果检测：已进入验证码页；标签状态：${describeTabLoadState(
          currentTab
        )}`
      )
      return {
        status: "verification",
        url: latestUrl
      }
    }

    if (isOpenAiAddPhoneUrl(latestUrl)) {
      let failureMessage = ""
      let pageErrorMessage = ""
      try {
        const [phoneFailureResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: getPhoneNumberSubmitFailureInPage
        })
        const phoneFailure = phoneFailureResult?.result
        failureMessage =
          phoneFailure?.hasFailure &&
          isOpenAiPhoneSubmitFailureMessage(phoneFailure.message)
            ? phoneFailure.message || ""
            : ""
      } catch {
        // 页面正在切换或暂时不可注入时，继续等 URL 或下一轮稳定错误。
      }
      try {
        const [pageErrorResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: getOpenAiAuthPageErrorInPage
        })
        const pageError = pageErrorResult?.result
        pageErrorMessage =
          pageError?.hasError &&
          isOpenAiPhoneSubmitPageErrorMessage(pageError.message)
            ? pageError.message || ""
            : ""
      } catch {
        // 页面正在切换或暂时不可注入时，继续等 URL 或下一轮稳定错误。
      }

      if (failureMessage) {
        if (failureMessage === stableFailureMessage) {
          stableFailureCount += 1
        } else {
          stableFailureMessage = failureMessage
          stableFailureCount = 1
        }

        if (stableFailureCount >= PHONE_SUBMIT_FAILURE_STABLE_COUNT) {
          onLog?.(
            "warn",
            `手机号提交结果检测：连续 ${stableFailureCount} 次识别到手机号错误：${failureMessage}；标签状态：${describeTabLoadState(
              currentTab
            )}`
          )
          return {
            status: "failure",
            message: failureMessage,
            url: latestUrl
          }
        }
      } else {
        stableFailureMessage = ""
        stableFailureCount = 0
      }

      if (pageErrorMessage) {
        if (pageErrorMessage === stablePageErrorMessage) {
          stablePageErrorCount += 1
        } else {
          stablePageErrorMessage = pageErrorMessage
          stablePageErrorCount = 1
        }

        if (stablePageErrorCount >= PHONE_SUBMIT_FAILURE_STABLE_COUNT) {
          onLog?.(
            "error",
            `手机号提交结果检测：连续 ${stablePageErrorCount} 次识别到 OpenAI 错误页：${pageErrorMessage}；标签状态：${describeTabLoadState(
              currentTab
            )}`
          )
          return {
            status: "page_error",
            message: pageErrorMessage,
            url: latestUrl
          }
        }
      } else {
        stablePageErrorMessage = ""
        stablePageErrorCount = 0
      }
    } else {
      stableFailureMessage = ""
      stableFailureCount = 0
      stablePageErrorMessage = ""
      stablePageErrorCount = 0
    }

    await abortableSleep(PHONE_SUBMIT_OUTCOME_INTERVAL_MS, signal)
  }

  const timeoutTab = await chrome.tabs.get(tabId).catch(() => null)
  onLog?.(
    "warn",
    `手机号提交结果检测：${formatDurationSeconds(
      PHONE_SUBMIT_OUTCOME_TIMEOUT_MS
    )} 内未确认验证码页、明确手机号错误或 OpenAI 错误页；标签状态：${describeTabLoadState(
      timeoutTab
    )}`
  )

  return {
    status: "timeout",
    url: timeoutTab?.url || latestUrl
  }
}

/**
 * 静默取消 HeroSMS 激活订单。
 *
 * 买号请求失败时 activation 仍然为空，不能调用 setStatus；买号成功后的任意
 * 后续失败才需要尝试 status=8 取消并返还资金。取消失败不覆盖原始错误。
 *
 * @param options HeroSMS 接码配置。
 * @param activation 已创建的 HeroSMS 激活信息；为空时跳过。
 */
const releaseHeroSmsActivationQuietly = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation | null
) => {
  if (activation === null) {
    return
  }

  options.onLog?.(
    "info",
    `HeroSMS 正在取消激活订单 ${activation.activationId}，手机号 ${activation.phoneNumber}`
  )
  try {
    await setHeroSmsActivationStatus(options, activation, 8)
    options.onLog?.(
      "info",
      `HeroSMS 已取消激活订单 ${activation.activationId}，手机号 ${activation.phoneNumber}`
    )
  } catch {
    options.onLog?.(
      "warn",
      `HeroSMS 取消激活订单失败 ${activation.activationId}，手机号 ${activation.phoneNumber}；请稍后人工检查`
    )
    // 订单释放失败不覆盖原始错误。
  }
}

const SIGNUP_ENTRY_BUTTON_TEXTS = [
  "免费注册",
  "立即注册",
  "注册",
  "登录",
  "登入",
  "sign up",
  "log in",
  "login",
  "sign in",
  "register",
  "create account",
  "create an account",
  "アカウントを作成",
  "サインアップ",
  "サインイン",
  "ログイン",
  "新規登録"
]

const LOGIN_ENTRY_BUTTON_TEXTS = [
  "登录",
  "登入",
  "log in",
  "login",
  "sign in",
  "サインイン",
  "ログイン"
]

const OPENAI_EMAIL_INPUT_SELECTORS = [
  "input[type='email']",
  "input[autocomplete='email']",
  "input[name='email']",
  "input[name='username']",
  "input[autocomplete='username']",
  "input[id*='email' i]",
  "input[id*='username' i]",
  "input[placeholder*='email' i]",
  "input[placeholder*='username' i]",
  "input[placeholder*='电子邮件']",
  "input[placeholder*='邮箱']",
  "input[aria-label*='email' i]",
  "input[aria-label*='username' i]",
  "input[aria-label*='电子邮件']",
  "input[aria-label*='邮箱']"
]

const OPENAI_CONTINUE_BUTTON_TEXTS = [
  "continue",
  "next",
  "submit",
  "sign up",
  "create account",
  "注册",
  "继续",
  "下一步",
  "提交"
]

const OPENAI_REGISTER_PASSWORD_INPUT_SELECTORS = [
  "input[type='password']",
  "input[autocomplete='new-password']",
  "input[name='password']",
  "input[id*='password' i]",
  "input[placeholder*='password' i]",
  "input[placeholder*='密码']",
  "input[aria-label*='password' i]",
  "input[aria-label*='密码']"
]

const OPENAI_PHONE_RESEND_BUTTON_TEXTS = [
  "resend",
  "resend code",
  "resend sms",
  "send again",
  "send new code",
  "重新发送",
  "重新发送验证码",
  "重新发送短信",
  "发送新验证码"
]

const OPENAI_VERIFICATION_INPUT_SELECTORS = [
  "input[name='code']",
  "input[name='otp']",
  "input[autocomplete='one-time-code']",
  "input[type='text'][maxlength='6']",
  "input[type='tel'][maxlength='6']",
  "input[aria-label*='code' i]",
  "input[aria-label*='验证码']",
  "input[placeholder*='code' i]",
  "input[placeholder*='验证码']",
  "input[inputmode='numeric']"
]

const OPENAI_READY_CONTINUE_BUTTON_TEXTS = ["继续", "continue"]

const OPENAI_AUTH_DIALOG_CONTAINER = {
  selectors: [
    "[role='dialog'][data-state='open']",
    "[role='dialog'][aria-modal='true']"
  ],
  textIncludes: [
    "登录或注册",
    "注册或登录",
    "log in or sign up",
    "sign up or log in",
    "login or signup",
    "signup or login"
  ]
}

/**
 * 检测注册邮箱是否已经提交到下一页。
 *
 * Step 2 重复执行时，页面可能已经进入密码页或验证码页；这种情况下不应把
 * “找不到邮箱输入框”当作失败。
 *
 * @return 已进入下一页时返回说明文案，否则返回空字符串。
 */
const detectRegisterEmailSubmittedInPage = () => {
  const pathname = window.location.pathname
  if (pathname === "/create-account/password") {
    return "当前 URL 已进入创建密码页，第二步无需重复提交邮箱"
  }

  if (pathname === "/email-verification") {
    return "当前 URL 已进入邮箱验证码页，第二步无需重复提交"
  }

  if (pathname === "/about-you") {
    return "当前 URL 已进入注册资料页，第二步无需重复提交"
  }

  /**
   * 清理页面文本里的多余空白。
   *
   * @param value 原始页面文本。
   * @return 规范化后的页面文本。
   */
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
  }
  const pageText = normalizeText(
    document.body?.innerText || document.body?.textContent || ""
  )
  const passwordInput = document.querySelector(
    "input[type='password'], input[autocomplete='new-password'], input[autocomplete='current-password']"
  )
  const verificationInput = document.querySelector(
    "input[name='code'], input[name='otp'], input[autocomplete='one-time-code'], input[inputmode='numeric']"
  )

  if (passwordInput) {
    return "当前已进入密码页，第二步无需重复提交"
  }

  if (
    verificationInput ||
    /验证码|验证邮箱|检查您的收件箱|verification|check your inbox|enter the code/i.test(
      pageText
    )
  ) {
    return "当前已进入邮箱验证码页，第二步无需重复提交"
  }

  return ""
}

/**
 * 创建 FlowPilot 注册调试流程 runner。
 *
 * runner 中每个方法对应一个注册/登录原子步骤，侧边栏调试按钮直接调用这些方法。
 *
 * @param context 当前运行上下文，主要用于中断信号。
 * @return FlowPilot 注册流程各步骤的执行函数集合。
 */
export const createCodexRegisterRunner = (context: RunContext = {}) => {
  const { fetchVerificationCode } = createMailVerificationRunner(context)
  const {
    openCodexAuthLink,
    confirmCodexOAuthConsent,
    submitCodexLoginEmailAndWait,
    submitCodexLoginPasswordAndWait,
    fetchAndSubmitChatGptLoginVerificationCode,
    submitCodexOAuthCallback
  } = createCodexLoginRunner(context)
  /**
   * 获取当前流程的中断信号。
   *
   * @return AbortSignal；没有传入时为 undefined。
   */
  const getAbortSignal = () => context.abortSignal

  /**
   * 如果流程已经被取消，立即抛出标准 AbortError。
   *
   * @throws DOMException 当运行上下文已被取消时抛出。
   */
  const throwIfRunAborted = () => {
    if (getAbortSignal()?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
  }

  /**
   * 读取当前 OpenAI 注册页状态。
   *
   * @param tabId 注册流程标签页 ID。
   * @return 页面状态；读取失败时返回 other，调用方决定是否继续等待。
   */
  const detectRegisterAuthState = async (tabId: number) => {
    const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
    const currentUrl = String(currentTab?.url || "")
    const urlState = getOpenAiAuthUrlState(currentUrl)

    switch (urlState) {
      case "login_password":
      case "register_password":
        return {
          state: "password",
          message: isOpenAiRegisterPasswordUrl(currentUrl)
            ? "当前 URL 已进入创建密码页"
            : "当前 URL 已进入密码页",
          url: currentUrl
        }
      case "email_verification":
        return {
          state: "verification_pending",
          message: "当前 URL 已进入邮箱验证码页",
          url: currentUrl
        }
      case "register_profile":
        return {
          state: "register_profile",
          message: "当前 URL 已进入注册资料页",
          url: currentUrl
        }
    }

    try {
      await waitForTabLoaded(tabId)
      const [detectResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectCodexAuthPageStateInPage
      })
      const detected = detectResult?.result

      return {
        state: detected?.state || "other",
        message: detected?.message || "未识别注册认证页状态",
        url: detected?.url || currentUrl
      }
    } catch (error) {
      return {
        state: "other",
        message:
          error instanceof Error ? error.message : "注册认证页状态读取失败",
        url: currentUrl
      }
    }
  }

  /**
   * 等待注册邮箱提交后的页面进入指定状态。
   *
   * @param tabId 注册流程标签页 ID。
   * @param expectedStates 可接受的页面状态。
   * @param timeoutMs 最长等待毫秒数。
   * @return 最后一次读取到的页面状态。
   */
  const waitForRegisterAuthState = async (
    tabId: number,
    expectedStates: string[],
    timeoutMs: number
  ) => {
    const startedAt = Date.now()
    let lastState = await detectRegisterAuthState(tabId)

    while (Date.now() - startedAt < timeoutMs) {
      throwIfRunAborted()
      lastState = await detectRegisterAuthState(tabId)
      if (expectedStates.includes(lastState.state)) {
        return lastState
      }

      await abortableSleep(500, getAbortSignal())
    }

    return lastState
  }

  /**
   * 注册邮箱提交后，如果 OpenAI 要求创建密码，则填写账号注册密码并继续。
   *
   * @param tabId 注册流程标签页 ID。
   * @param password 账号管理里保存的注册密码。
   * @return 未出现密码页时返回跳过说明；出现密码页时返回填写结果。
   */
  const submitRegisterPasswordIfNeeded = async (
    tabId: number,
    password: string
  ): Promise<CodexRegisterStepResponse> => {
    const state = await waitForRegisterAuthState(
      tabId,
      ["password", "verification_pending", "register_profile"],
      10000
    )

    if (
      state.state === "verification_pending" ||
      state.state === "register_profile"
    ) {
      return {
        ok: true,
        message: state.message,
        targetTab: {
          id: tabId,
          url: state.url
        }
      }
    }

    if (state.state !== "password") {
      return {
        ok: true,
        message: `提交邮箱后未检测到创建密码页；${state.message}`,
        targetTab: {
          id: tabId,
          url: state.url
        }
      }
    }

    const normalizedPassword = String(password || "")
    if (!normalizedPassword) {
      return {
        ok: false,
        message: "当前已进入创建密码页，但账号没有注册密码",
        targetTab: {
          id: tabId,
          url: state.url
        }
      }
    }

    const verificationRequestedAt = Date.now()
    const passwordResult = await runPageActionInTab(tabId, {
      fields: [
        {
          selectors: OPENAI_REGISTER_PASSWORD_INPUT_SELECTORS,
          value: normalizedPassword
        }
      ],
      button: {
        texts: OPENAI_CONTINUE_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: 15000,
      successMessage: "已填写注册密码并点击继续",
      failureMessage: "未找到创建密码页的密码输入框或继续按钮"
    })

    if (!passwordResult.ok) {
      return {
        ok: false,
        message: `${state.message}；${passwordResult.message}`,
        targetTab: passwordResult.tab
      }
    }

    const nextState = await waitForRegisterAuthState(
      tabId,
      ["verification_pending", "register_profile"],
      15000
    )

    return {
      ok: true,
      message: `${state.message}；${passwordResult.message}；${nextState.message}`,
      verificationRequestedAt,
      targetTab: {
        id: tabId,
        url: nextState.url || passwordResult.tab?.url
      }
    }
  }

  /**
   * 准备注册时提交给 OpenAI 的实际邮箱。
   *
   * 注册流程只使用账号列表里已经保存的注册邮箱。
   *
   * @param account 当前要注册的账号配置。
   * @return 准备结果；成功时返回可继续执行的账号快照。
   */
  const prepareRegisterAccountEmail = async (
    account: ManagedAccount
  ): Promise<CodexRegisterStepResponse & { account?: ManagedAccount }> => {
    throwIfRunAborted()

    if (!account.email) {
      return {
        ok: false,
        message: "缺少注册邮箱"
      }
    }

    return {
      ok: true,
      message: "已准备注册邮箱",
      account
    }
  }

  const waitForChatGptEntryPageReady = async (tabId: number) => {
    let lastMessage = ""

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      throwIfRunAborted()

      if (attempt > 1) {
        await chrome.tabs.update(tabId, {
          active: true,
          url: CHATGPT_SIGNUP_ENTRY_URL
        })
      }

      await waitForTabLoaded(tabId, isChatGptPageUrl, 30000)
      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (!currentTab?.id) {
        lastMessage = "GPT 页面标签页已关闭"
      } else if (!isChatGptPageUrl(currentTab.url)) {
        lastMessage = `GPT 页面未打开到 chatgpt.com，当前地址：${currentTab.url || "unknown"}`
      } else {
        try {
          const [readyResult] = await chrome.scripting.executeScript({
            target: { tabId },
            func: detectChatGptEntryPageReadyInPage
          })
          const readyValue = readyResult?.result
          if (readyValue?.ok) {
            return {
              ok: true,
              message:
                attempt > 1 ? "ChatGPT 页面重载后已可操作" : readyValue.message
            }
          }
          lastMessage = readyValue?.message || "ChatGPT 页面未确认可操作"
        } catch (error) {
          lastMessage = `ChatGPT 页面不可注入：${
            error instanceof Error ? error.message : String(error || "未知错误")
          }`
        }
      }

      if (attempt < 2) {
        await abortableSleep(1500, getAbortSignal())
      }
    }

    return {
      ok: false,
      message: `GPT 页面没有正常加载，疑似系统休眠后网络或 Chrome 页面尚未恢复；${lastMessage}`
    }
  }

  /**
   * 等待手机验证码提交后的页面结果。
   *
   * 只把进入 localhost 回调当成成功；如果进入 OAuth 授权确认页，
   * 复用登录流程点击继续并等待回调；如果已经离开验证码页但不是回调页，
   * 停止自动重试，交给人工判断手机号是否已经验证完成。
   *
   * @param tabId 当前 OpenAI 授权页标签页 ID。
   * @return 页面状态检测结果。
   */
  const waitForPhoneVerificationSubmitState = async (
    tabId: number
  ): Promise<RegisterPhoneVerificationSubmitState> => {
    const startedAt = Date.now()
    let lastState = {
      ok: false,
      state: "other",
      message: "手机验证码提交后未确认页面状态",
      url: ""
    }

    while (Date.now() - startedAt < 45000) {
      throwIfRunAborted()

      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
      const currentUrl = String(currentTab?.url || "")
      if (isCodexOAuthCallbackUrl(currentUrl)) {
        return {
          ok: true,
          state: "callback",
          message: "手机验证码已通过，页面已跳转到 localhost 回调地址",
          url: currentUrl
        }
      }

      try {
        await waitForTabLoaded(tabId)
        const [detectResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectCodexAuthPageStateInPage
        })
        const detected = detectResult?.result
        lastState = {
          ok: Boolean(detected?.ok),
          state: detected?.state || "other",
          message: detected?.message || "未识别手机验证码提交后的页面状态",
          url: detected?.url || currentUrl
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "手机验证码提交后页面暂不可检测"
        lastState = {
          ok: false,
          state: "other",
          message: formatPhoneVerificationPageInjectionMessage(
            errorMessage,
            currentUrl
          ),
          url: currentUrl
        }
      }

      if (lastState.state === "oauth_consent_ready") {
        const consentResult = await confirmCodexOAuthConsent(tabId)
        if (consentResult.ok && consentResult.callbackUrl) {
          return {
            ok: true,
            state: "callback",
            message: `手机验证码已通过；${consentResult.message}`,
            url: consentResult.callbackUrl
          }
        }

        return {
          ...lastState,
          ok: false,
          releaseActivation: false,
          message: consentResult.ok
            ? `手机验证码已通过并进入授权确认页，但未捕获到 localhost 回调地址：${consentResult.message}`
            : `手机验证码已通过并进入授权确认页，但未能完成授权继续：${consentResult.message}`
        }
      }

      if (lastState.state === "verification_invalid_code") {
        return lastState
      }

      if (lastState.state !== "verification_pending") {
        const statusMessage = isOpenAiPhoneVerificationUrl(lastState.url)
          ? `${lastState.message}；当前仍在手机号验证地址，但页面状态无法读取，请停止当前账号后人工检查`
          : `${lastState.message}；手机验证码提交后已离开验证码页，但还没有到 localhost 回调地址，请人工判断是否已验证成功`
        return {
          ...lastState,
          ok: false,
          releaseActivation: false,
          message: statusMessage
        }
      }

      await abortableSleep(500, getAbortSignal())
    }

    return {
      ...lastState,
      ok: false,
      releaseActivation: lastState.state === "verification_pending",
      message: `${lastState.message}；45 秒内未确认手机验证码提交后的页面状态`
    }
  }

  /**
   * 等待邮箱验证码提交后的页面状态。
   *
   * 这里只关心验证码是否被判错；只要页面离开验证码输入状态，就交给后续
   * 注册资料步骤继续处理，避免把注册页后续形态复杂化。
   *
   * @param tabId 当前 OpenAI 注册页标签页 ID。
   * @return 提交后的认证页状态。
   */
  const waitForRegisterEmailVerificationSubmitState = async (
    tabId: number
  ): Promise<RegisterEmailVerificationSubmitState> => {
    const startedAt = Date.now()
    let lastState: RegisterEmailVerificationSubmitState = {
      state: "other",
      message: "注册邮箱验证码提交后未确认页面状态",
      url: ""
    }

    while (Date.now() - startedAt < 5000) {
      throwIfRunAborted()

      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
      const currentUrl = String(currentTab?.url || "")

      try {
        await waitForTabLoaded(tabId)
        const [detectResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectCodexAuthPageStateInPage
        })
        const detected = detectResult?.result
        lastState = {
          state: detected?.state || "other",
          message: detected?.message || "未识别注册验证码提交后的页面状态",
          url: detected?.url || currentUrl
        }
      } catch (error) {
        lastState = {
          state: "other",
          message:
            error instanceof Error
              ? error.message
              : "注册验证码提交后页面暂不可检测",
          url: currentUrl
        }
      }

      if (lastState.state === "verification_invalid_code") {
        return lastState
      }

      if (lastState.state === "register_profile") {
        return lastState
      }

      if (lastState.state !== "verification_pending") {
        return lastState
      }

      await abortableSleep(500, getAbortSignal())
    }

    if (lastState.state === "verification_pending") {
      return {
        ...lastState,
        state: "other",
        message: `${lastState.message}；5 秒内未发现验证码错误，继续等待注册资料页`
      }
    }

    return lastState
  }

  /**
   * Step 6 开始前检查手机号验证是否已被 OpenAI 跳过。
   *
   * 有些账号在完成 OAuth 登录后会直接进入 Codex 授权确认页，不再要求手机号。
   * 这种情况下不能继续买 HeroSMS 号码，只需要点击授权确认页继续并把回调地址交给 Step 7。
   *
   * @param tabId 当前 OpenAI 授权页标签页 ID。
   * @return 已处理时返回 Step 6 结果；不属于跳过手机号场景时返回 null。
   */
  const completeOAuthConsentIfReady = async (
    tabId: number
  ): Promise<CodexRegisterStepResponse | null> => {
    const currentTab = await chrome.tabs.get(tabId).catch(() => null)
    const currentUrl = String(currentTab?.url || "")
    if (isCodexOAuthCallbackUrl(currentUrl)) {
      return {
        ok: true,
        message: "当前账号不需要手机号验证，页面已跳转到 localhost 回调地址",
        callbackUrl: currentUrl,
        targetTab: {
          id: tabId,
          url: currentUrl
        }
      }
    }

    if (!isOpenAiCodexConsentUrl(currentUrl)) {
      try {
        await waitForTabLoaded(tabId)
        const [detectResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectCodexAuthPageStateInPage
        })
        const detected = detectResult?.result
        if (detected?.state !== "oauth_consent_ready") {
          return null
        }
      } catch {
        return null
      }
    }

    const consentResult = await confirmCodexOAuthConsent(tabId)
    if (!consentResult.ok) {
      return {
        ok: false,
        message: `当前账号不需要手机号验证，已进入 OAuth 授权确认页，但未能点击继续并捕获回调地址：${consentResult.message}`,
        targetTab: consentResult.targetTab || {
          id: tabId,
          url: currentUrl
        }
      }
    }

    return {
      ok: true,
      message: `当前账号不需要手机号验证，已跳过 Step 6；${consentResult.message}`,
      callbackUrl: consentResult.callbackUrl,
      targetTab: consentResult.targetTab || {
        id: tabId,
        url: consentResult.callbackUrl
      }
    }
  }

  /**
   * 手机验证码超时后回退到手机号输入页。
   *
   * 这里按用户要求使用页面内 window.history.back() 触发历史回退，不直接跳转
   * /add-phone；如果历史栈无法回到手机号页，就交给外层重新执行 Step 5 刷新 OAuth。
   *
   * @param tabId 当前手机号验证码页标签页 ID。
   * @param canGoBack 回退保护回调；浏览器不允许读取 history 上一项，调用方可用闭包检查自己记录的 URL，并返回具体失败原因。
   * @param onLog 写入侧边栏日志的回调。
   * @return 是否重新看到手机号输入框。
   */
  const tryHistoryBackToPhoneInput = async (
    tabId: number,
    canGoBack: () => HistoryBackGuardResult = () => true,
    onLog?: HeroSmsPhoneVerificationOptions["onLog"]
  ) => {
    const beforeBackTab = await chrome.tabs.get(tabId).catch(() => null)
    const beforeBackUrl = beforeBackTab?.url || ""
    const guardResult = normalizeHistoryBackGuardResult(canGoBack())
    if (!guardResult.ok) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      onLog?.(
        "warn",
        `浏览器回退保护未通过：${
          guardResult.message
        }；当前标签状态：${describeTabLoadState(currentTab)}`
      )
      return {
        ok: false,
        message: `${guardResult.message}，已停止 window.history.back；当前 URL：${
          currentTab?.url || "unknown"
        }`
      }
    }

    let backMessage = ""
    onLog?.(
      "info",
      `准备从手机号验证码页回退到手机号输入页；回退前标签状态：${describeTabLoadState(
        beforeBackTab
      )}`
    )
    const stopBackNavigationTrace = startTabNavigationTrace(tabId, onLog)
    try {
      const [backResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: requestHistoryBackInPage
      })
      const backValue = backResult?.result
      if (!backValue?.ok) {
        onLog?.(
          "warn",
          `window.history.back 返回失败：${
            backValue?.message || "触发页面回退失败"
          }；回退前 URL：${beforeBackUrl || "unknown"}`
        )
        const navigationEvents = stopBackNavigationTrace()
        return {
          ok: false,
          message: `${backValue?.message || "触发页面回退失败"}；回退前 URL：${
            beforeBackUrl || "unknown"
          }${
            navigationEvents.length
              ? `；回退期间导航：${navigationEvents.slice(0, 6).join("；")}`
              : ""
          }`
        }
      }
      backMessage = "已通过页面 window.history.back 触发回退"
      onLog?.("info", backMessage)
    } catch (error) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      const historyBackErrorMessage = getErrorMessage(error)
      onLog?.(
        "warn",
        `window.history.back 注入失败；错误：${historyBackErrorMessage}；当前标签状态：${describeTabLoadState(
          currentTab
        )}`
      )
      const navigationEvents = stopBackNavigationTrace()
      return {
        ok: false,
        message: `window.history.back 注入失败；错误：${historyBackErrorMessage}；回退前 URL：${
          beforeBackUrl || "unknown"
        }；当前标签状态：${describeTabLoadState(currentTab)}${
          navigationEvents.length
            ? `；回退期间导航：${navigationEvents.slice(0, 6).join("；")}`
            : ""
        }`
      }
    }

    // 等待回退动作开始；requestHistoryBackInPage 返回时页面不一定已经切换。
    await abortableSleep(1000, getAbortSignal())
    const afterBackTab = await chrome.tabs.get(tabId).catch(() => null)
    const afterBackUrl = afterBackTab?.url || ""
    let readyResult: chrome.scripting.InjectionResult<
      Awaited<ReturnType<typeof waitForPhoneInputInPage>>
    >[]
    try {
      readyResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: waitForPhoneInputInPage
      })
    } catch (error) {
      const readyTab = await chrome.tabs.get(tabId).catch(() => null)
      onLog?.(
        "warn",
        `回退后检测手机号输入页注入失败：${getErrorMessage(
          error
        )}；当前标签状态：${describeTabLoadState(readyTab)}`
      )
      const navigationEvents = stopBackNavigationTrace()
      return {
        ok: false,
        message: `${backMessage}；回退后检测手机号输入页注入失败：${getErrorMessage(
          error
        )}；回退前 URL：${beforeBackUrl || "unknown"}；触发后 URL：${
          afterBackUrl || "unknown"
        }；当前标签状态：${describeTabLoadState(readyTab)}${
          navigationEvents.length
            ? `；回退期间导航：${navigationEvents.slice(0, 6).join("；")}`
            : ""
        }`
      }
    }
    const readyTab = await chrome.tabs.get(tabId).catch(() => null)
    const readyUrl = readyTab?.url || ""
    const readyValue = readyResult[0]?.result
    const hasPhoneInput = Boolean(readyValue?.ok)
    const isStablePhoneInputPage =
      hasPhoneInput && isStableTabMatchingUrl(readyTab, isOpenAiAddPhoneUrl)
    const readyMessage = readyValue?.message || "未确认页面是否回到手机号输入页"
    const phoneInputMessage = `检测到手机号输入框：${
      hasPhoneInput ? "是" : "否"
    }；稳定停在手机号输入页：${isStablePhoneInputPage ? "是" : "否"}`

    const navigationEvents = stopBackNavigationTrace()
    if (!hasPhoneInput || !isStablePhoneInputPage) {
      onLog?.(
        "warn",
        `回退后未稳定回到手机号输入页：${readyMessage}；${phoneInputMessage}；检测后标签状态：${describeTabLoadState(
          readyTab
        )}${
          navigationEvents.length
            ? `；回退期间导航：${navigationEvents.slice(0, 6).join("；")}`
            : ""
        }`
      )
    }
    return {
      ok: isStablePhoneInputPage,
      message: `${backMessage}；${readyMessage}；${phoneInputMessage}；回退前 URL：${beforeBackUrl || "unknown"}；触发后 URL：${
        afterBackUrl || "unknown"
      }；检测后 URL：${readyUrl || "unknown"}；检测后标签状态：${describeTabLoadState(
        readyTab
      )}${
        (!hasPhoneInput || !isStablePhoneInputPage) && navigationEvents.length
          ? `；回退期间导航：${navigationEvents.slice(0, 6).join("；")}`
          : ""
      }`
    }
  }

  /**
   * Step 1：清理 OpenAI/ChatGPT 旧会话并打开 GPT 注册入口页。
   *
   * @param reuseTabId 可选复用的标签页 ID；传入时会在该标签页打开入口页。
   * @return 打开入口页后的标签页信息。
   */
  const openChatGptRegisterEntry = async (
    reuseTabId?: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const cookieResult = await clearSessionCookiesForUrls(
      OPENAI_SESSION_CLEANUP_URLS
    )
    const storageResult = await clearOpenTabSiteStorageForUrls(
      OPENAI_SESSION_CLEANUP_URLS,
      {
        abortSignal: getAbortSignal()
      }
    )
    // 打开；第 7 步 fallback 会传入当前 OAuth tab 复用 reuse 复用，其它入口保持原来的查找/打开行为。
    const tabId =
      typeof reuseTabId === "number"
        ? reuseTabId
        : await findOrOpenTab(CHATGPT_SIGNUP_ENTRY_URL)
    let currentTabStorageMessage = ""

    try {
      // 页面站点存储必须打开界面后注入清理，所以这里清理当前注册页 origin。
      const currentTabStorageResult = await clearSiteStorageInTab(tabId, {
        abortSignal: getAbortSignal()
      })
      currentTabStorageMessage = `；当前注册页已清理 ${currentTabStorageResult.localCount}/${currentTabStorageResult.sessionCount}/${currentTabStorageResult.indexedDbCount}/${currentTabStorageResult.cacheCount} 个 local/session/indexedDB/cache 项`
    } catch {
      throwIfRunAborted()
      currentTabStorageMessage = "；当前注册页站点存储清理失败，已继续打开页面"
    }

    // 再刷新一下，防止页面还是有缓存展示的状态
    await chrome.tabs.update(tabId, {
      active: true,
      url: CHATGPT_SIGNUP_ENTRY_URL
    })
    const readyResult = await waitForChatGptEntryPageReady(tabId)
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!readyResult.ok) {
      return {
        ok: false,
        message: `${cookieResult.message}；${storageResult.message}${currentTabStorageMessage}；${readyResult.message}`,
        targetTab: {
          id: tabId,
          url: tab?.url
        }
      }
    }

    return {
      ok: true,
      message: `${cookieResult.message}；${storageResult.message}${currentTabStorageMessage}；${
        typeof reuseTabId === "number"
          ? "已在当前 tab 打开 GPT 页面"
          : "已打开 GPT 页面"
      }；${readyResult.message}`,
      targetTab: {
        id: tab?.id,
        url: tab?.url
      }
    }
  }

  /**
   * Step 2：提交注册邮箱，必要时先点击 GPT 注册/登录入口。
   *
   * 有注册/登录入口按钮时先点击入口；没有入口按钮时跳过点击。
   * 后续统一填写邮箱并点击继续；如果进入创建密码页，则填写注册密码后继续。
   * 如果页面已经进入验证码页或注册资料页，会视为已完成。
   *
   * @param email 要注册的邮箱。
   * @param password 要设置的注册密码。
   * @param tabId Step 1 打开的 GPT 页面标签页 ID。
   * @return 邮箱提交结果。
   */
  const clickRegisterAndSubmitEmail = async (
    email: string,
    password: string,
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedEmail = String(email || "").trim()
    if (!normalizedEmail) {
      return {
        ok: false,
        message: "缺少注册邮箱"
      }
    }

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到 Step 1 打开的 GPT 页面，请重新执行 Step 1"
      }
    }

    let entryState = {
      hasEntryButton: false,
      message: "未检测到注册/登录入口按钮"
    }
    try {
      const [entryDetectResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectPageButtonByTextInPage,
        args: [SIGNUP_ENTRY_BUTTON_TEXTS]
      })
      const detected = entryDetectResult?.result
      entryState = detected
        ? {
            hasEntryButton: detected.hasButton,
            message: detected.message
          }
        : entryState
    } catch {
      entryState = {
        ...entryState,
        message: "注册/登录入口检测失败，按当前页邮箱表单处理"
      }
    }

    let entryMessage = ""
    if (entryState.hasEntryButton) {
      const entryResult = await runPageActionInTab(tabId, {
        button: {
          texts: SIGNUP_ENTRY_BUTTON_TEXTS
        },
        timeoutMs: 10000,
        successMessage: "已点击 GPT 注册/登录入口",
        failureMessage: "未找到 GPT 页面上的注册/登录入口"
      })

      throwIfRunAborted()
      if (!entryResult.ok) {
        return {
          ok: false,
          message: `${entryState.message}；${entryResult.message}`,
          targetTab: entryResult.tab
        }
      }
      entryMessage = entryResult.message
    }

    const submitResult = await runPageActionInTab(tabId, {
      container: entryState.hasEntryButton
        ? OPENAI_AUTH_DIALOG_CONTAINER
        : undefined,
      fields: [
        {
          selectors: OPENAI_EMAIL_INPUT_SELECTORS,
          value: normalizedEmail
        }
      ],
      button: {
        texts: OPENAI_CONTINUE_BUTTON_TEXTS,
        triggerMode: "requestSubmit"
      },
      timeoutMs: entryState.hasEntryButton ? 20000 : 5000,
      successMessage: entryState.hasEntryButton
        ? "已填写注册弹窗邮箱并点击继续"
        : "当前页面已有邮箱输入框，已填写注册邮箱并点击继续",
      failureMessage: entryState.hasEntryButton
        ? "未找到注册弹窗里的邮箱输入框或继续按钮"
        : "当前页面未找到可直接提交的邮箱输入框"
    })

    if (!submitResult.ok) {
      // 即便失败，也要检测一下是不是已经到下一步了，如果是说明就不是失败。
      let submittedMessage = ""
      try {
        const [detectResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectRegisterEmailSubmittedInPage
        })
        submittedMessage = String(detectResult?.result || "")
      } catch {
        submittedMessage = ""
      }
      if (submittedMessage) {
        const passwordResult = await submitRegisterPasswordIfNeeded(
          tabId,
          password
        )
        return {
          ok: passwordResult.ok,
          message: `${submittedMessage}；${passwordResult.message}`,
          verificationRequestedAt: passwordResult.verificationRequestedAt,
          targetTab: passwordResult.targetTab || submitResult.tab
        }
      }

      return {
        ok: false,
        message: entryMessage
          ? `${entryMessage}；${submitResult.message}`
          : submitResult.message,
        targetTab: submitResult.tab
      }
    }

    const passwordResult = await submitRegisterPasswordIfNeeded(tabId, password)

    return {
      ok: passwordResult.ok,
      message: [entryMessage, submitResult.message, passwordResult.message]
        .filter(Boolean)
        .join("；"),
      verificationRequestedAt: passwordResult.verificationRequestedAt,
      targetTab: passwordResult.targetTab || submitResult.tab
    }
  }

  /**
   * Step 3：按账号邮箱服务读取验证码，并填写到当前 OpenAI 页面。
   *
   * @param tabId 等待填写验证码的 OpenAI/ChatGPT 标签页 ID。
   * @param account 当前账号配置。
   * @param verificationRequestedAt 发起验证码请求的时间，用于过滤旧邮件。
   * @param onProgress 用于改变当前账号步骤流程的回调
   * @return 验证码读取和提交结果。
   */
  const fetchAndSubmitRegisterVerificationCode = async (
    tabId: number,
    account: ManagedAccount,
    verificationRequestedAt = 0,
    onProgress?: (message: string) => void
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    return retryVerificationCodeOnInvalidCode<
      VerificationCodeResult,
      CodexRegisterStepResponse
    >({
      fetchCode: async (excludeCodes) => {
        const mailResult = await fetchVerificationCode(account, {
          verificationRequestedAt,
          excludeCodes
        })
        throwIfRunAborted()
        return mailResult
      },
      buildNoCodeResult: (mailResult, attemptMessages) => {
        return {
          ok: false,
          message: [...attemptMessages, mailResult.message]
            .filter(Boolean)
            .join("；"),
          targetTab: mailResult.mailTab
        }
      },
      submitCode: async (mailResult) => {
        onProgress?.(mailResult.message)

        await chrome.tabs.update(tabId, { active: true })
        const fillResult = await runPageActionInTab(tabId, {
          fields: [
            {
              selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
              value: mailResult.code,
              allowSplitInput: true
            }
          ],
          timeoutMs: 15000,
          successMessage: "已填写注册验证码",
          failureMessage: "未找到验证码输入框"
        })

        if (!fillResult.ok) {
          return {
            invalidCode: false,
            result: {
              ok: false,
              message: `${mailResult.message}；${fillResult.message}`,
              targetTab: fillResult.tab
            }
          }
        }
        onProgress?.(fillResult.message)

        const submitResult = await runPageActionInTab(tabId, {
          button: {
            texts: OPENAI_CONTINUE_BUTTON_TEXTS,
            triggerMode: "requestSubmit"
          },
          timeoutMs: 15000,
          successMessage: "已点击注册验证码页继续按钮",
          failureMessage: "未找到验证码页继续按钮"
        })

        if (!submitResult.ok) {
          return {
            invalidCode: false,
            result: {
              ok: false,
              message: `${mailResult.message}；${fillResult.message}；${submitResult.message}`,
              targetTab: submitResult.tab
            }
          }
        }
        onProgress?.(submitResult.message)

        const submitState =
          await waitForRegisterEmailVerificationSubmitState(tabId)
        const currentAttemptMessage = `${mailResult.message}；${fillResult.message}；${submitResult.message}；${submitState.message}`
        if (submitState.state === "account_unavailable") {
          return {
            invalidCode: false,
            result: {
              ok: false,
              accountInvalid: true,
              message: currentAttemptMessage,
              targetTab: {
                id: tabId,
                url: submitState.url || submitResult.tab?.url
              }
            }
          }
        }

        return {
          invalidCode: submitState.state === "verification_invalid_code",
          attemptMessage: currentAttemptMessage,
          result: {
            ok: submitState.state !== "verification_invalid_code",
            message: currentAttemptMessage,
            targetTab: {
              id: tabId,
              url: submitState.url || submitResult.tab?.url
            }
          }
        }
      },
      buildFallbackResult: (attemptMessages) => {
        return {
          ok: false,
          message: attemptMessages.join("；") || "注册验证码提交失败"
        }
      }
    })
  }

  /**
   * Step 4：填写注册资料页的名称和年龄/生日。
   *
   * @param tabId 注册资料页所在标签页 ID。
   * @return 资料填写和提交结果。
   */
  const submitRegisterProfile = async (
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    const profileUrl = await waitForTabMatchingUrl(
      tabId,
      isOpenAiRegisterProfileUrl,
      {
        timeoutMs: 15000,
        intervalMs: 300,
        signal: getAbortSignal()
      }
    )
    if (!profileUrl) {
      const currentTab = await chrome.tabs.get(tabId)
      return {
        ok: false,
        message: "15 秒内未进入注册资料页 https://auth.openai.com/about-you",
        targetTab: {
          id: tabId,
          url: currentTab.url
        }
      }
    }

    await waitForTabLoaded(tabId)
    const [profileResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: submitRegisterProfileInPage,
      args: [DEFAULT_REGISTER_FULL_NAME, DEFAULT_REGISTER_AGE]
    })
    const currentTab = await chrome.tabs.get(tabId)
    const result = profileResult?.result

    return {
      ok: Boolean(result?.ok),
      message: result?.message || "填写名称、年龄或生日失败",
      targetTab: {
        id: tabId,
        url: currentTab.url
      }
    }
  }

  /**
   * 注册资料完成页：点击“继续/Continue”按钮。
   *
   * @param tabId 注册流程标签页 ID。
   * @return 点击继续按钮的结果。
   */
  const clickRegisterReadyContinue = async (
    tabId: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到注册页面 tab，请先执行 Step 1 或使用当前标签页"
      }
    }

    const readyUrl = await waitForTabMatchingUrl(tabId, isChatGptPageUrl, {
      timeoutMs: 30000,
      intervalMs: 300,
      signal: getAbortSignal()
    })
    if (!readyUrl) {
      const currentTab = await chrome.tabs.get(tabId)
      return {
        ok: false,
        message: "30 秒内未等到准备就绪页跳转到 ChatGPT 页面",
        targetTab: {
          id: tabId,
          url: currentTab.url
        }
      }
    }

    const submitResult = await runPageActionInTab(tabId, {
      button: {
        texts: OPENAI_READY_CONTINUE_BUTTON_TEXTS
      },
      timeoutMs: 30000,
      successMessage: "已点击准备就绪页继续按钮",
      failureMessage: "未找到准备就绪页继续按钮"
    })

    return {
      ok: true,
      message: submitResult.ok
        ? submitResult.message
        : "超时认为 准备就绪页未出现继续按钮，已跳过",
      targetTab: submitResult.tab
    }
  }

  /**
   * Step 5 前半段：从当前管理来源刷新 OAuth URL 并进入 OpenAI 登录授权页。
   *
   * @param integration CPA 或 Sub2API 接入参数。
   * @param targetTabId 可选复用的标签页 ID。
   * @return 打开 OAuth 登录授权页的结果。
   */
  const refreshRegisterOAuthAndLogin = async (
    integration: OAuthIntegrationConfig,
    targetTabId?: number
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const reusableTabId = targetTabId ?? (await findReusableOpenAiTabId())
    const previousReusableTab = reusableTabId
      ? await chrome.tabs.get(reusableTabId).catch(() => undefined)
      : undefined
    const previousReusableUrl = String(previousReusableTab?.url || "")
    const result = await openCodexAuthLink(integration, {
      cleanupSession: false,
      targetTabId: reusableTabId
    })
    if (
      result.ok &&
      typeof result.targetTab?.id === "number" &&
      previousReusableUrl
    ) {
      const oauthFlowUrl = await waitForTabMatchingUrl(
        result.targetTab.id,
        (url) => {
          if (!url) {
            return false
          }

          if (url !== previousReusableUrl) {
            return isRegisterOAuthLoginFlowUrl(url)
          }

          return isOpenAiChooseAccountUrl(url)
        },
        {
          timeoutMs: 15000,
          intervalMs: 300,
          signal: getAbortSignal()
        }
      )

      if (!oauthFlowUrl) {
        const currentTab = await chrome.tabs
          .get(result.targetTab.id)
          .catch(() => undefined)
        return {
          ok: false,
          message: `${result.message}；复用 tab 打开 OAuth 后 15 秒内未进入已知 OAuth 流程页，已停止后续判断，旧 URL：${previousReusableUrl}，当前标签状态：${describeTabLoadState(
            currentTab
          )}`,
          targetTab: {
            id: result.targetTab.id,
            url: currentTab?.url || result.targetTab.url
          }
        }
      }

      result.targetTab.url = oauthFlowUrl
    }

    return {
      ok: result.ok,
      message: result.ok
        ? `${result.message}；已刷新 OAuth 并进入登录授权流程`
        : result.message,
      oauthStartedAt: result.ok ? Date.now() : undefined,
      oauthBinding: result.oauthBinding,
      targetTab: result.targetTab
    }
  }

  /**
   * Step 5 后半段：在 OAuth 登录授权页选择目标账号卡片。
   *
   * @param tabId OAuth 登录授权页标签页 ID。
   * @param email 要点击的目标账号邮箱。
   * @param onLog 日志打印回调
   * @return 账号卡片点击结果。
   */
  const chooseRegisterLoginAccount = async (
    tabId: number,
    email: string,
    onLog?: (message: string) => void
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const normalizedEmail = String(email || "").trim()
    if (!normalizedEmail) {
      return {
        ok: false,
        message: "缺少登录邮箱"
      }
    }

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到 OpenAI 授权页 tab，请先执行 Step 5 或使用当前标签页"
      }
    }

    const authUrl = await waitForTabMatchingUrl(
      tabId,
      (url) => {
        return (
          isOpenAiChooseAccountUrl(url) ||
          isOpenAiAddPhoneUrl(url) ||
          isOpenAiPhoneVerificationUrl(url) ||
          isOpenAiCodexConsentUrl(url)
        )
      },
      {
        timeoutMs: 15000,
        intervalMs: 300,
        signal: getAbortSignal()
      }
    )
    const currentTab = await chrome.tabs.get(tabId).catch(() => undefined)
    const currentUrl = authUrl || currentTab?.url || ""
    onLog?.(
      `Step 5 账号选择页检测：命中 URL=${authUrl || "未命中"}；当前 tab URL=${
        currentTab?.url || "unknown"
      }；用于判断 URL=${currentUrl || "unknown"}`
    )

    if (
      isOpenAiAddPhoneUrl(currentUrl) ||
      isOpenAiPhoneVerificationUrl(currentUrl) ||
      isOpenAiCodexConsentUrl(currentUrl)
    ) {
      return {
        ok: true,
        message: `当前 URL 已越过账号选择页，无需重复选择账号：${currentUrl}`,
        targetTab: {
          id: tabId,
          url: currentUrl
        }
      }
    }

    if (!isOpenAiChooseAccountUrl(currentUrl)) {
      onLog?.(
        `Step 5 未识别账号选择页，停止点击账号卡片；当前 URL=${currentUrl || "unknown"}`
      )
      return {
        ok: false,
        message: `15 秒内未进入账号选择页 https://auth.openai.com/choose-an-account；当前 URL：${
          currentUrl || "unknown"
        }`,
        targetTab: {
          id: tabId,
          url: currentUrl
        }
      }
    }

    onLog?.(`Step 5 已进入账号选择页，准备点击账号卡片 ${normalizedEmail}`)
    const targetAccountResult = await runPageActionInTab(tabId, {
      button: {
        texts: [normalizedEmail]
      },
      timeoutMs: 5000,
      successMessage: `已点击目标账号卡片 ${normalizedEmail}`,
      failureMessage: `未找到目标账号卡片 ${normalizedEmail}`
    })
    if (targetAccountResult.ok) {
      const nextUrl = await waitForTabMatchingUrl(
        tabId,
        (url) => {
          return (
            isOpenAiAddPhoneUrl(url) ||
            isOpenAiPhoneVerificationUrl(url) ||
            isOpenAiCodexConsentUrl(url)
          )
        },
        {
          timeoutMs: 10000,
          intervalMs: 300,
          signal: getAbortSignal()
        }
      )
      return {
        ok: true,
        message: nextUrl
          ? `${targetAccountResult.message}；已进入下一步 URL：${nextUrl}`
          : targetAccountResult.message,
        targetTab: nextUrl
          ? {
              id: tabId,
              url: nextUrl
            }
          : targetAccountResult.tab
      }
    }

    return {
      ok: false,
      message: `${targetAccountResult.message}；需要先执行注册流程 1、登录版 2、3 完成目标账号登录`,
      targetTab: targetAccountResult.tab
    }
  }

  /**
   * Step 6：通过 HeroSMS 完成 OpenAI 手机号验证。
   *
   * @param tabId 手机号验证页面标签页 ID。
   * @param options HeroSMS 接码配置。
   * @param oauthStartedAt 验证开始时间戳，用于后面判断是重新拿 OAuth URL，还是重新拿手机号。
   * @param shouldStopAfterCurrentPhoneAttempt 当前手机号失败或验证码被拒后是否停止，不再回退页面换号。
   * @return 手机号提交、短信验证码读取和提交结果。
   */
  const completeRegisterPhoneVerification = async (
    tabId: number,
    options: HeroSmsPhoneVerificationOptions,
    oauthStartedAt = Date.now(),
    shouldStopAfterCurrentPhoneAttempt: () => boolean = () => false
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    try {
      await chrome.tabs.get(tabId)
    } catch {
      return {
        ok: false,
        message: "未找到手机号验证页面 tab，请先执行 Step 5 或使用当前标签页"
      }
    }

    const skippedPhoneResult = await completeOAuthConsentIfReady(tabId)
    if (skippedPhoneResult) {
      return skippedPhoneResult
    }

    const phoneEntryUrl = await waitForTabMatchingUrl(
      tabId,
      (url) => {
        return (
          isOpenAiAddPhoneUrl(url) ||
          isOpenAiCodexConsentUrl(url) ||
          isCodexOAuthCallbackUrl(url)
        )
      },
      {
        timeoutMs: 15000,
        intervalMs: 300,
        signal: getAbortSignal()
      }
    )
    if (
      isOpenAiCodexConsentUrl(phoneEntryUrl) ||
      isCodexOAuthCallbackUrl(phoneEntryUrl)
    ) {
      const consentResult = await completeOAuthConsentIfReady(tabId)
      if (consentResult) {
        return consentResult
      }
    }

    if (!isOpenAiAddPhoneUrl(phoneEntryUrl)) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      return {
        ok: false,
        message: `未进入手机号填写页 https://auth.openai.com/add-phone，已停止买号；当前 URL：${
          currentTab?.url || phoneEntryUrl || "unknown"
        }`,
        targetTab: {
          id: tabId,
          url: currentTab?.url || phoneEntryUrl
        }
      }
    }

    let activation: HeroSmsActivation | null = null
    let hasReceivedHeroSmsCode = false
    try {
      phoneActivationLoop: while (true) {
        activation = await requestHeroSmsActivation(options)
        assertHeroSmsActivationCostWithinExpected(activation)
        const activationSummary = formatHeroSmsActivationSummary(activation)
        throwIfRunAborted()

        await waitForTabLoaded(tabId)
        // 只在确认本轮手机号是从 /add-phone 提交时，才允许后续浏览器回退换号。
        const phoneInputTab = await chrome.tabs.get(tabId).catch(() => null)
        const phoneInputUrl = phoneInputTab?.url || ""
        const canHistoryBackToPhoneInput = isOpenAiAddPhoneUrl(phoneInputUrl)
        const getPhoneInputHistoryBackGuard = () => {
          return {
            ok: canHistoryBackToPhoneInput,
            message: canHistoryBackToPhoneInput
              ? ""
              : `手机号提交前页面不是 https://auth.openai.com/add-phone，而是 ${
                  phoneInputUrl || "unknown"
                }`
          }
        }
        options.onLog?.(
          "info",
          `手机号提交前页面 URL：${phoneInputUrl || "unknown"}；${
            canHistoryBackToPhoneInput
              ? "后续验证码超时允许浏览器回退换号"
              : "后续验证码超时不允许浏览器回退，将刷新 OAuth"
          }`
        )
        if (!canHistoryBackToPhoneInput) {
          options.onLog?.(
            "warn",
            `提交手机号脚本注入前已不在手机号输入页；当前 URL：${
              phoneInputUrl || "unknown"
            }`
          )
        }
        // 提交手机号，页面到获取验证码的页面
        const [phoneResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: submitPhoneNumberInPage,
          args: [
            activation.phoneNumber,
            activation.countryLabel,
            activation.countryPhoneCode
          ]
        })
        const phonePageResult = phoneResult?.result
        if (!phonePageResult?.ok) {
          options.onPhoneVerificationPhase?.("phone_wait_finished")
          options.onLog?.(
            "warn",
            `手机号 ${activation.phoneNumber} 页面提交失败，HeroSMS 订单 ${activation.activationId} 未取消；新订单未满 2 分钟通常无法取消，等待平台自动回收`
          )
          const currentTab = await chrome.tabs.get(tabId)
          return {
            ok: false,
            message: `已从 HeroSMS 获取手机号 ${activation.phoneNumber}，但页面提交失败：${
              phonePageResult?.message || "未知错误"
            }；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: currentTab.url
            }
          }
        }
        options.onPhoneVerificationPhase?.("phone_submitted")

        // region ========== 等待跳转到验证码页面 ==========
        const phoneSubmitOutcome = await waitForPhoneSubmitOutcome(
          tabId,
          getAbortSignal(),
          options.onLog
        )
        throwIfRunAborted()
        // 如果能在页面拿到信息说明手机号有问题，直接拿下一个手机号
        if (phoneSubmitOutcome.status !== "verification") {
          if (phoneSubmitOutcome.status === "page_error") {
            options.onLog?.(
              "error",
              `手机号提交失败：${phoneSubmitOutcome.message}；OpenAI 手机号提交后显示错误页，已停止自动换号；${activationSummary}`
            )
            await releaseHeroSmsActivationQuietly(options, activation)
            activation = null
            options.onPhoneVerificationPhase?.("phone_wait_finished")
            return {
              ok: false,
              message: `${phonePageResult.message}；${phoneSubmitOutcome.message}；OpenAI 手机号提交后显示错误页，已停止自动换号；${activationSummary}`,
              targetTab: {
                id: tabId,
                url: (await chrome.tabs.get(tabId).catch(() => null))?.url
              }
            }
          }

          const failureMessage =
            phoneSubmitOutcome.status === "failure"
              ? phoneSubmitOutcome.message
              : ""
          // 如果没拿到提示信息，并且也没有跳转到验证码页面，说明意外情况了，停止吧
          if (failureMessage) {
            if (isOpenAiPhoneVerificationRateLimited(failureMessage)) {
              options.onLog?.(
                "error",
                `手机号提交失败：${failureMessage}；OpenAI 已限制当前账号的手机验证请求次数，停止当前账号，不再继续换号；${activationSummary}`
              )
              await releaseHeroSmsActivationQuietly(options, activation)
              activation = null
              options.onPhoneVerificationPhase?.("phone_wait_finished")
              return {
                ok: false,
                message: `${phonePageResult.message}；${failureMessage}；OpenAI 已限制当前账号的手机验证请求次数，已停止当前账号，不再继续换号；${activationSummary}`,
                targetTab: {
                  id: tabId,
                  url: (await chrome.tabs.get(tabId).catch(() => null))?.url
                }
              }
            }

            const submittedPhoneNumber = activation.phoneNumber
            await releaseHeroSmsActivationQuietly(options, activation)
            activation = null
            if (shouldStopAfterCurrentPhoneAttempt()) {
              options.onLog?.(
                "warn",
                `手机号提交失败：${failureMessage}；已按停止策略停止，不再更换手机号；${activationSummary}`
              )
              return {
                ok: false,
                message: `${phonePageResult.message}；${failureMessage}；已按停止策略停止，不再更换手机号；${activationSummary}`,
                targetTab: {
                  id: tabId,
                  url: (await chrome.tabs.get(tabId).catch(() => null))?.url
                }
              }
            }
            options.onLog?.(
              "warn",
              `手机号提交失败：${failureMessage}；手机号 ${submittedPhoneNumber} 未进入验证码页，不进入验证码轮询，准备更换手机号；${activationSummary}`
            )
            continue
          }
          // 打印当前异常的页面，现在还不知道这个是啥情况，实际应该没有这种情况
          const currentTab = await chrome.tabs.get(tabId).catch(() => null)
          options.onLog?.(
            "error",
            `手机号 ${activation.phoneNumber} 提交后未进入验证码页，不进入 HeroSMS 轮询；当前 URL：${
              currentTab?.url || phoneSubmitOutcome.url || "unknown"
            }；${activationSummary}`
          )
          await releaseHeroSmsActivationQuietly(options, activation)
          activation = null
          options.onPhoneVerificationPhase?.("phone_wait_finished")
          return {
            ok: false,
            message: `${phonePageResult.message}；手机号提交后未进入验证码页，已停止自动换号；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: currentTab?.url
            }
          }
        }
        // endregion
        for (
          let codeAttempt = 1;
          codeAttempt <= REGISTER_PHONE_CODE_MAX_SUBMIT_ATTEMPTS;
          codeAttempt += 1
        ) {
          let code = ""
          try {
            code = await pollHeroSmsCode(options, activation, getAbortSignal())
            hasReceivedHeroSmsCode = true
          } catch (error) {
            options.onPhoneVerificationPhase?.("phone_wait_finished")
            if (!isHeroSmsCodeTimeoutError(error)) {
              throw error
            }

            const timeoutMessage =
              error instanceof Error ? error.message : "等待手机验证码超时"
            await releaseHeroSmsActivationQuietly(options, activation)
            activation = null

            const remainingMs =
              oauthStartedAt + REGISTER_OAUTH_VALID_MS - Date.now()
            options.onLog?.(
              "warn",
              `${timeoutMessage}；OAuth 预计剩余 ${formatDurationSeconds(
                remainingMs
              )}`
            )

            if (remainingMs > REGISTER_PHONE_RETRY_MIN_REMAINING_MS) {
              if (shouldStopAfterCurrentPhoneAttempt()) {
                return {
                  ok: false,
                  message: `${timeoutMessage}；已按停止策略停止，不再更换手机号；${activationSummary}`,
                  targetTab: {
                    id: tabId,
                    url: (await chrome.tabs.get(tabId).catch(() => null))?.url
                  }
                }
              }

              const backResult = await tryHistoryBackToPhoneInput(
                tabId,
                getPhoneInputHistoryBackGuard,
                options.onLog
              )
              if (backResult.ok) {
                options.onLog?.(
                  "warn",
                  `${backResult.message}，OAuth 剩余时间充足，继续更换手机号`
                )
                continue phoneActivationLoop
              }

              options.onLog?.(
                "warn",
                `浏览器回退后未稳定回到手机号输入页，可能已进入 OpenAI 错误页或被重新导航到验证码页；准备重新执行 Step 5 刷新 OAuth 后再进入手机号填写页；${backResult.message}`
              )
              return {
                ok: false,
                needRefreshOAuth: true,
                message: `${timeoutMessage}；${backResult.message}，需要重新执行 Step 5 刷新 OAuth；${activationSummary}`,
                targetTab: {
                  id: tabId,
                  url: (await chrome.tabs.get(tabId).catch(() => null))?.url
                }
              }
            }

            return {
              ok: false,
              needRefreshOAuth: true,
              message: `${timeoutMessage}；OAuth 剩余时间不足 ${formatDurationSeconds(
                REGISTER_PHONE_RETRY_MIN_REMAINING_MS
              )}，需要重新执行 Step 5 刷新 OAuth；${activationSummary}`,
              targetTab: {
                id: tabId,
                url: (await chrome.tabs.get(tabId).catch(() => null))?.url
              }
            }
          }
          options.onPhoneVerificationPhase?.("phone_wait_finished")
          throwIfRunAborted()

          await chrome.tabs.update(tabId, { active: true })
          const submitResult = await runPageActionInTab(tabId, {
            fields: [
              {
                selectors: OPENAI_VERIFICATION_INPUT_SELECTORS,
                value: code,
                allowSplitInput: true
              }
            ],
            button: {
              texts: OPENAI_CONTINUE_BUTTON_TEXTS,
              triggerMode: "requestSubmit"
            },
            timeoutMs: 20000,
            successMessage: "已填写手机验证码并点击继续",
            failureMessage: "未找到手机验证码输入框或继续按钮"
          })

          if (!submitResult.ok) {
            await releaseHeroSmsActivationQuietly(options, activation)
            return {
              ok: false,
              message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${formatPhoneVerificationPageInjectionMessage(
                submitResult.message,
                submitResult.tab?.url
              )}；${activationSummary}`,
              targetTab: submitResult.tab
            }
          }

          const submitState = await waitForPhoneVerificationSubmitState(tabId)
          if (submitState.ok) {
            try {
              await setHeroSmsActivationStatus(options, activation, 6)
            } catch {
              // 页面已经提交成功，平台完成状态失败只留给后续人工检查。
            }

            return {
              ok: true,
              message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${submitState.message}；${activationSummary}`,
              callbackUrl: submitState.url,
              targetTab: {
                id: tabId,
                url: submitState.url || submitResult.tab?.url
              }
            }
          }

          if (submitState.state === "verification_invalid_code") {
            const invalidMessage = `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${submitState.message}；${activationSummary}`
            if (
              codeAttempt < REGISTER_PHONE_CODE_MAX_SUBMIT_ATTEMPTS &&
              activation.canGetAnotherSms
            ) {
              options.onLog?.(
                "warn",
                `手机验证码被 OpenAI 拒绝，准备请求重新发送短信并重试（${codeAttempt}/${REGISTER_PHONE_CODE_MAX_SUBMIT_ATTEMPTS}）；${activationSummary}`
              )
              try {
                await setHeroSmsActivationStatus(options, activation, 3)
                options.onLog?.(
                  "info",
                  `HeroSMS 已为订单 ${activation.activationId} 请求重新发送短信`
                )
              } catch (error) {
                await releaseHeroSmsActivationQuietly(options, activation)
                return {
                  ok: false,
                  message: `${invalidMessage}；请求 HeroSMS 重新发送短信失败：${
                    error instanceof Error ? error.message : "未知错误"
                  }`,
                  targetTab: {
                    id: tabId,
                    url: submitState.url || submitResult.tab?.url
                  }
                }
              }

              const resendResult = await runPageActionInTab(tabId, {
                button: {
                  texts: OPENAI_PHONE_RESEND_BUTTON_TEXTS,
                  triggerMode: "click"
                },
                timeoutMs: 15000,
                successMessage: "已点击手机验证码重新发送按钮",
                failureMessage: "未找到手机验证码重新发送按钮"
              })
              if (!resendResult.ok) {
                await releaseHeroSmsActivationQuietly(options, activation)
                return {
                  ok: false,
                  message: `${invalidMessage}；${resendResult.message}`,
                  targetTab: resendResult.tab
                }
              }

              options.onPhoneVerificationPhase?.("phone_submitted")
              continue
            }

            await releaseHeroSmsActivationQuietly(options, activation)
            activation = null
            const remainingMs =
              oauthStartedAt + REGISTER_OAUTH_VALID_MS - Date.now()
            if (shouldStopAfterCurrentPhoneAttempt()) {
              options.onLog?.(
                "warn",
                `手机验证码连续 ${codeAttempt} 次被拒，已按停止策略停止，不再更换手机号`
              )
              return {
                ok: false,
                message: `${invalidMessage}；已按停止策略停止，不再更换手机号`,
                targetTab: {
                  id: tabId,
                  url: submitState.url || submitResult.tab?.url
                }
              }
            }
            options.onLog?.(
              "warn",
              `手机验证码连续 ${codeAttempt} 次被拒，准备更换手机号；OAuth 预计剩余 ${formatDurationSeconds(
                remainingMs
              )}`
            )

            if (remainingMs > REGISTER_PHONE_RETRY_MIN_REMAINING_MS) {
              const backResult = await tryHistoryBackToPhoneInput(
                tabId,
                getPhoneInputHistoryBackGuard,
                options.onLog
              )
              if (backResult.ok) {
                options.onLog?.(
                  "warn",
                  `${backResult.message}，OAuth 剩余时间充足，继续更换手机号`
                )
                continue phoneActivationLoop
              }

              options.onLog?.(
                "warn",
                `浏览器回退后未稳定回到手机号输入页，可能已进入 OpenAI 错误页或被重新导航到验证码页；准备重新执行 Step 5 刷新 OAuth 后再进入手机号填写页；${backResult.message}`
              )
              return {
                ok: false,
                needRefreshOAuth: true,
                message: `${invalidMessage}；${backResult.message}，需要重新执行 Step 5 刷新 OAuth`,
                targetTab: {
                  id: tabId,
                  url: (await chrome.tabs.get(tabId).catch(() => null))?.url
                }
              }
            }

            return {
              ok: false,
              needRefreshOAuth: true,
              message: `${invalidMessage}；OAuth 剩余时间不足 ${formatDurationSeconds(
                REGISTER_PHONE_RETRY_MIN_REMAINING_MS
              )}，需要重新执行 Step 5 刷新 OAuth`,
              targetTab: {
                id: tabId,
                url: submitState.url || submitResult.tab?.url
              }
            }
          }

          if (submitState.releaseActivation) {
            await releaseHeroSmsActivationQuietly(options, activation)
          } else {
            options.onLog?.(
              "warn",
              `HeroSMS 订单 ${activation.activationId} 已收到并提交验证码，页面结果需要人工判断，未取消该订单`
            )
          }
          return {
            ok: false,
            needsManualReview: !submitState.releaseActivation,
            message: `${phonePageResult.message}；HeroSMS 已收到验证码 ${code}；${submitResult.message}；${submitState.message}；${activationSummary}`,
            targetTab: {
              id: tabId,
              url: submitState.url || submitResult.tab?.url
            }
          }
        }
      }
    } catch (error) {
      if (hasReceivedHeroSmsCode) {
        await releaseHeroSmsActivationQuietly(options, activation)
      } else if (activation) {
        options.onLog?.(
          "warn",
          `HeroSMS 订单 ${activation.activationId} 尚未收到验证码，未主动取消；新订单未满 2 分钟通常无法取消，等待平台自动回收`
        )
      }

      const currentTab = await chrome.tabs.get(tabId).catch(() => null)
      const errorMessage =
        error instanceof Error ? error.message : "手机号验证流程执行失败"
      const readableErrorMessage = formatPhoneVerificationPageInjectionMessage(
        errorMessage,
        currentTab?.url
      )
      const activationSummary = activation
        ? formatHeroSmsActivationSummary(activation)
        : ""
      return {
        ok: false,
        message: activationSummary
          ? `${readableErrorMessage}；${activationSummary}`
          : readableErrorMessage,
        targetTab: {
          id: tabId,
          url: currentTab?.url
        }
      }
    }
  }

  /**
   * 完成 Step 5 的账号选择兜底流程。
   *
   * 先尝试点击已有账号卡片；如果没有对应卡片，则复用 Step 1、登录版 Step 2、
   * Step 3 完成目标账号登录，再刷新 OAuth 并重新点击账号卡片。
   *
   * @param tabId OAuth 登录授权页标签页 ID。
   * @param account 当前账号配置。
   * @param integration CPA 或 Sub2API 接入参数，用于登录后重新刷新授权页。
   * @param onFallbackLog 日志打印回调
   * @return OAuth 账号选择或兜底登录后的结果。
   */
  const completeRegisterOAuthLogin = async (
    tabId: number,
    account: ManagedAccount,
    integration: OAuthIntegrationConfig,
    onFallbackLog?: (message: string) => void
  ): Promise<CodexRegisterStepResponse> => {
    throwIfRunAborted()

    const email = account.email
    const password = account.password
    const firstChoice = await chooseRegisterLoginAccount(
      tabId,
      email,
      onFallbackLog
    )
    if (firstChoice.ok) {
      return firstChoice
    }
    onFallbackLog?.(`${firstChoice.message}；开始执行登录兜底流程 1、2、3`)

    onFallbackLog?.("登录兜底 Step 1：正在打开 GPT 页面")
    const openResult = await openChatGptRegisterEntry(tabId)
    if (!openResult.ok || typeof openResult.targetTab?.id !== "number") {
      return {
        ok: false,
        message: `${firstChoice.message}；${openResult.message}`,
        targetTab: openResult.targetTab
      }
    }
    onFallbackLog?.(`登录兜底 Step 1：${openResult.message}`)

    onFallbackLog?.("登录兜底 Step 2：正在点击登录入口")
    const entryResult = await runPageActionInTab(openResult.targetTab.id, {
      button: {
        texts: LOGIN_ENTRY_BUTTON_TEXTS
      },
      timeoutMs: 10000,
      successMessage: "已点击 GPT 登录入口",
      failureMessage: "未找到 GPT 页面上的登录入口"
    })
    onFallbackLog?.(`登录兜底 Step 2：${entryResult.message}`)
    const buildFallbackMessage = (...messages: Array<string | undefined>) => {
      return [
        firstChoice.message,
        openResult.message,
        entryResult.ok ? entryResult.message : "",
        ...messages
      ]
        .filter(Boolean)
        .join("；")
    }

    onFallbackLog?.("登录兜底 Step 2：正在填写登录邮箱并等待下一页")
    const loginResult = await submitCodexLoginEmailAndWait(
      openResult.targetTab.id,
      email
    )
    onFallbackLog?.(`登录兜底 Step 2：${loginResult.message}`)
    if (!loginResult.ok) {
      return {
        ok: false,
        message: buildFallbackMessage(loginResult.message),
        targetTab: loginResult.targetTab
      }
    }

    onFallbackLog?.("登录兜底 Step 2：正在处理密码页")
    const passwordResult = await submitCodexLoginPasswordAndWait(
      openResult.targetTab.id,
      password
    )
    onFallbackLog?.(`登录兜底 Step 2：${passwordResult.message}`)
    if (!passwordResult.ok) {
      return {
        ok: false,
        message: buildFallbackMessage(
          loginResult.message,
          passwordResult.message
        ),
        targetTab: passwordResult.targetTab
      }
    }

    const verificationRequestedAt =
      passwordResult.verificationRequestedAt ||
      loginResult.verificationRequestedAt ||
      Date.now()
    onFallbackLog?.("登录兜底 Step 3：正在读取并提交登录验证码")
    let codeResult: Awaited<
      ReturnType<typeof fetchAndSubmitChatGptLoginVerificationCode>
    >
    try {
      codeResult = await fetchAndSubmitChatGptLoginVerificationCode(
        openResult.targetTab.id,
        account,
        verificationRequestedAt
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "登录验证码提交异常"
      const currentTab = await chrome.tabs
        .get(openResult.targetTab.id)
        .catch(() => undefined)
      const currentUrl = String(currentTab?.url || "")
      const message = currentUrl
        ? `登录兜底 Step 3：异常：${errorMessage}；当前页：${currentUrl}`
        : `登录兜底 Step 3：异常：${errorMessage}`
      onFallbackLog?.(message)

      return {
        ok: false,
        message: buildFallbackMessage(
          loginResult.message,
          passwordResult.message,
          message
        ),
        targetTab: {
          id: openResult.targetTab.id,
          url: currentUrl || undefined
        }
      }
    }
    onFallbackLog?.(`登录兜底 Step 3：${codeResult.message}`)
    if (codeResult.accountInvalid) {
      onFallbackLog?.("登录兜底 Step 3：检测到 OpenAI 账号失效，停止登录兜底")
    }
    if (!codeResult.ok) {
      return {
        ok: false,
        accountInvalid: codeResult.accountInvalid,
        message: buildFallbackMessage(
          loginResult.message,
          passwordResult.message,
          codeResult.message
        ),
        targetTab: codeResult.targetTab
      }
    }

    const codeTabId = codeResult.targetTab?.id || openResult.targetTab.id
    await waitForTabLoaded(codeTabId, undefined, 30000)

    // 验证码提交后给页面一点时间写入登录缓存，再重新打开 OAuth。
    onFallbackLog?.("登录兜底：验证码已提交，等待 OpenAI 写入登录状态")
    await abortableSleep(15000, getAbortSignal())

    onFallbackLog?.("登录兜底：正在重新刷新 OAuth")
    const refreshResult = await refreshRegisterOAuthAndLogin(
      integration,
      codeTabId
    )
    onFallbackLog?.(`登录兜底：${refreshResult.message}`)
    if (!refreshResult.ok || typeof refreshResult.targetTab?.id !== "number") {
      return {
        ok: false,
        message: buildFallbackMessage(
          loginResult.message,
          passwordResult.message,
          codeResult.message,
          refreshResult.message
        ),
        targetTab: refreshResult.targetTab
      }
    }

    onFallbackLog?.("登录兜底：正在重新选择目标账号卡片")
    const secondChoice = await chooseRegisterLoginAccount(
      refreshResult.targetTab.id,
      email,
      onFallbackLog
    )
    onFallbackLog?.(`登录兜底：${secondChoice.message}`)
    return {
      ok: secondChoice.ok,
      message: buildFallbackMessage(
        loginResult.message,
        passwordResult.message,
        codeResult.message,
        refreshResult.message,
        secondChoice.message
      ),
      oauthStartedAt: refreshResult.oauthStartedAt,
      oauthBinding: refreshResult.oauthBinding,
      targetTab: secondChoice.targetTab
    }
  }

  /**
   * Step 7：把注册 OAuth callback 提交给当前管理来源。
   *
   * 复用登录流程的最后一步；CPA 执行回填，Sub2API 交换 code 并创建账号。
   *
   * @param integration CPA 或 Sub2API 接入参数。
   * @param oauthBinding Step 5 获取 OAuth URL 时返回的来源绑定信息。
   * @param callbackUrl Step 6 成功后捕获到的 localhost 回调地址。
   * @param callbackTabId 可选，回填成功后关闭这个授权标签页。
   * @param accountEmail 当前注册账号邮箱。
   * @return 当前管理来源的 callback 提交结果。
   */
  const submitRegisterOAuthCallback = async (
    integration: OAuthIntegrationConfig,
    oauthBinding: OAuthBinding,
    callbackUrl: string,
    callbackTabId?: number,
    accountEmail = ""
  ): Promise<CodexRegisterStepResponse> => {
    const result = await submitCodexOAuthCallback(
      integration,
      oauthBinding,
      callbackUrl,
      callbackTabId,
      accountEmail
    )
    return {
      ok: result.ok,
      message: result.message,
      callbackUrl: result.callbackUrl || callbackUrl,
      oauthBinding,
      targetTab: {
        id: callbackTabId,
        url: result.callbackUrl || callbackUrl
      }
    }
  }

  return {
    openChatGptRegisterEntry,
    prepareRegisterAccountEmail,
    clickRegisterAndSubmitEmail,
    fetchAndSubmitRegisterVerificationCode,
    submitRegisterProfile,
    clickRegisterReadyContinue,
    refreshRegisterOAuthAndLogin,
    completeRegisterPhoneVerification,
    completeRegisterOAuthLogin,
    submitRegisterOAuthCallback
  }
}

export const {
  openChatGptRegisterEntry,
  prepareRegisterAccountEmail,
  clickRegisterAndSubmitEmail,
  fetchAndSubmitRegisterVerificationCode,
  submitRegisterProfile,
  clickRegisterReadyContinue,
  refreshRegisterOAuthAndLogin,
  completeRegisterPhoneVerification,
  completeRegisterOAuthLogin,
  submitRegisterOAuthCallback
} = createCodexRegisterRunner()
