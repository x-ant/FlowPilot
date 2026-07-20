const OPENAI_AUTH_ORIGIN = "https://auth.openai.com"

/**
 * OpenAI 授权地址对应的页面状态。
 *
 * 这个类型只描述“当前 URL 是哪个页面”，不描述页面动作是否已经成功。
 * - oauth_callback：OpenAI 已跳转到本机 callback，等待回填 CPA。
 * - login_email_entry：登录流程的邮箱输入页。
 * - login_password：登录流程的密码输入页。
 * - register_password：注册流程的创建密码页。
 * - email_verification：邮箱验证码页。
 * - register_profile：注册资料页，也就是填写姓名和年龄/生日/年份的页面。
 * - oauth_account_choice：OAuth 账号选择页。
 * - phone_number_entry：手机号填写页。
 * - phone_verification：手机验证码页。
 * - oauth_consent：Codex OAuth 授权确认页。
 * - other：不是当前已知的 OpenAI 授权页面。
 */
export type OpenAiAuthUrlState =
  | "oauth_callback"
  | "login_email_entry"
  | "login_password"
  | "register_password"
  | "email_verification"
  | "register_profile"
  | "oauth_account_choice"
  | "phone_number_entry"
  | "phone_verification"
  | "oauth_consent"
  | "other"

const parseUrl = (rawUrl?: string) => {
  try {
    return new URL(String(rawUrl || ""))
  } catch {
    return null
  }
}

const isOpenAiAuthPath = (rawUrl: string | undefined, pathname: string) => {
  const url = parseUrl(rawUrl)
  return Boolean(
    url && url.origin === OPENAI_AUTH_ORIGIN && url.pathname === pathname
  )
}

/**
 * 根据 URL 判断 OpenAI 授权流程所处阶段。
 *
 * 这里只做 URL 级别判断；验证码错误、按钮是否可点这类页面内容仍由页面脚本
 * 或具体动作步骤判断。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return URL 对应的授权流程状态；不认识时返回 other。
 */
export const getOpenAiAuthUrlState = (rawUrl?: string): OpenAiAuthUrlState => {
  if (isCodexOAuthCallbackUrl(rawUrl)) {
    return "oauth_callback"
  }

  const url = parseUrl(rawUrl)
  if (!url || url.origin !== OPENAI_AUTH_ORIGIN) {
    return "other"
  }

  if (url.pathname === "/log-in") {
    return "login_email_entry"
  }

  if (url.pathname === "/log-in/password") {
    return "login_password"
  }

  if (url.pathname === "/create-account/password") {
    return "register_password"
  }

  if (url.pathname === "/email-verification") {
    return "email_verification"
  }

  if (url.pathname === "/about-you") {
    return "register_profile"
  }

  if (url.pathname === "/choose-an-account") {
    return "oauth_account_choice"
  }

  if (url.pathname === "/add-phone") {
    return "phone_number_entry"
  }

  if (url.pathname === "/phone-verification") {
    return "phone_verification"
  }

  if (/^\/sign-in-with-chatgpt\/[^/?#]+\/consent$/i.test(url.pathname)) {
    return "oauth_consent"
  }

  return "other"
}

/**
 * 判断是否是登录流程的密码页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 登录密码页时返回 true。
 */
export const isOpenAiLoginPasswordUrl = (rawUrl?: string) => {
  return isOpenAiAuthPath(rawUrl, "/log-in/password")
}

/**
 * 判断是否是注册流程的创建密码页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 创建密码页时返回 true。
 */
export const isOpenAiRegisterPasswordUrl = (rawUrl?: string) => {
  return isOpenAiAuthPath(rawUrl, "/create-account/password")
}

/**
 * 判断是否是注册资料页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 注册资料页时返回 true。
 */
export const isOpenAiRegisterProfileUrl = (rawUrl?: string) => {
  return getOpenAiAuthUrlState(rawUrl) === "register_profile"
}

/**
 * 判断是否是 OAuth 账号选择页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 账号选择页时返回 true。
 */
export const isOpenAiChooseAccountUrl = (rawUrl?: string) => {
  return getOpenAiAuthUrlState(rawUrl) === "oauth_account_choice"
}

/**
 * 判断是否是手机号填写页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 手机号填写页时返回 true。
 */
export const isOpenAiAddPhoneUrl = (rawUrl?: string) => {
  return getOpenAiAuthUrlState(rawUrl) === "phone_number_entry"
}

/**
 * 判断是否是手机验证码页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI 手机验证码页时返回 true。
 */
export const isOpenAiPhoneVerificationUrl = (rawUrl?: string) => {
  return getOpenAiAuthUrlState(rawUrl) === "phone_verification"
}

/**
 * 判断是否是 Codex OAuth 授权确认页。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 位于 OpenAI Codex 授权确认页时返回 true。
 */
export const isOpenAiCodexConsentUrl = (rawUrl?: string) => {
  return getOpenAiAuthUrlState(rawUrl) === "oauth_consent"
}

/**
 * 判断是否是 Codex OAuth 完成后跳转出的本机回调地址。
 *
 * CPA 回填只需要 OpenAI 带回的 localhost callback；必须包含 code 和 state，
 * 避免把本地服务错误页或无效跳转误判为授权完成。
 *
 * @param rawUrl 浏览器标签页当前 URL。
 * @return 命中 localhost/127.0.0.1 回调且包含 code、state 时返回 true。
 */
export const isCodexOAuthCallbackUrl = (rawUrl?: string) => {
  const url = parseUrl(rawUrl)
  if (!url || !/^https?:$/.test(url.protocol)) {
    return false
  }

  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    return false
  }

  if (!["/auth/callback", "/codex/callback"].includes(url.pathname)) {
    return false
  }

  const code = url.searchParams.get("code")?.trim()
  const state = url.searchParams.get("state")?.trim()
  return Boolean(code && state)
}
