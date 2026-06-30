type CpaManagementRequestOptions = {
  managementKey: string
  timeoutMs?: number
}

type CpaOAuthUrlResponse = {
  status?: string
  url?: string
  state?: string
  error?: string
}

type CpaOAuthCallbackResponse = {
  status?: string
  error?: string
}

type RequestCpaOAuthUrlResult = {
  oauthUrl: string
  oauthState: string
}

type SubmitCpaOAuthCallbackResult = {
  localhostUrl: string
  verifiedStatus: string
}

const normalizeString = (value: unknown) => {
  return String(value || "").trim()
}

const deriveCpaManagementOrigin = (rawUrl: string) => {
  const normalizedUrl = normalizeString(rawUrl)
  if (!normalizedUrl) {
    throw new Error("尚未填写 CPA 地址")
  }

  try {
    return new URL(normalizedUrl).origin
  } catch {
    throw new Error("CPA 地址格式无效")
  }
}

const fetchCpaManagementJson = async (
  origin: string,
  path: string,
  options: CpaManagementRequestOptions & {
    method?: "GET" | "POST"
    body?: Record<string, unknown>
  }
): Promise<unknown> => {
  const managementKey = normalizeString(options.managementKey)
  if (!managementKey) {
    throw new Error("尚未填写 CPA 管理密钥")
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => {
      controller.abort()
    },
    Math.max(1000, Math.floor(Number(options.timeoutMs) || 20000))
  )

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${managementKey}`
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const response = await fetch(`${origin}${path}`, {
      method: options.method || "POST",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })
    let payload: any = {}

    try {
      payload = await response.json()
    } catch {
      payload = {}
    }

    if (!response.ok) {
      throw new Error(
        normalizeString(payload?.error) ||
          `CPA 管理接口请求失败（HTTP ${response.status}）`
      )
    }

    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("CPA 管理接口请求超时")
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 获取 OAuth URL。
 *
 * 接口样例：
 * GET /v0/management/codex-auth-url
 * Authorization: Bearer <MANAGEMENT_KEY>
 *
 * 成功响应：
 * { "status": "ok", "url": "https://...", "state": "codex-1716206400" }
 */
export const requestCpaOAuthUrl = async (
  cpaUrl: string,
  managementKey: string
): Promise<RequestCpaOAuthUrlResult> => {
  const managementOrigin = deriveCpaManagementOrigin(cpaUrl)
  const result = (await fetchCpaManagementJson(
    managementOrigin,
    "/v0/management/codex-auth-url",
    {
      method: "GET",
      managementKey
    }
  )) as CpaOAuthUrlResponse
  const oauthUrl = normalizeString(result.url)
  const oauthState = normalizeString(result.state)

  if (result.status !== "ok") {
    throw new Error(normalizeString(result.error) || "获取 OAuth URL 失败")
  }

  if (!oauthUrl || !oauthUrl.startsWith("http")) {
    throw new Error("CPA 管理接口未返回有效的 url")
  }

  if (!oauthState) {
    throw new Error("CPA 管理接口未返回 state")
  }

  return {
    oauthUrl,
    oauthState
  }
}

/**
 * 回填 OAuth callback。
 *
 * 接口样例：
 * POST /v0/management/oauth-callback
 * Authorization: Bearer <MANAGEMENT_KEY>
 *
 * 请求体：
 * { "provider": "codex", "redirect_url": "http://localhost:.../auth/callback?code=...&state=..." }
 *
 * 成功响应：
 * { "status": "ok" }
 *
 * 失败响应：
 * { "status": "error", "error": "state is required" }
 */
export const submitCpaOAuthCallback = async (
  cpaUrl: string,
  managementKey: string,
  callbackUrl: string,
  expectedState = ""
): Promise<SubmitCpaOAuthCallbackResult> => {
  const normalizedCallbackUrl = normalizeString(callbackUrl)
  let callbackCode = ""
  let callbackState = ""
  try {
    const parsedCallbackUrl = new URL(normalizedCallbackUrl)
    callbackCode = normalizeString(parsedCallbackUrl.searchParams.get("code"))
    callbackState = normalizeString(parsedCallbackUrl.searchParams.get("state"))
  } catch {
    throw new Error("OAuth 回调地址格式无效")
  }
  const normalizedExpectedState = normalizeString(expectedState)

  if (!callbackCode || !callbackState) {
    throw new Error("OAuth 回调地址缺少 code 或 state")
  }

  if (normalizedExpectedState && normalizedExpectedState !== callbackState) {
    throw new Error("CPA 回调 state 与当前授权会话不匹配")
  }

  const managementOrigin = deriveCpaManagementOrigin(cpaUrl)
  const result = (await fetchCpaManagementJson(
    managementOrigin,
    "/v0/management/oauth-callback",
    {
      method: "POST",
      managementKey,
      body: {
        provider: "codex",
        redirect_url: normalizedCallbackUrl
      }
    }
  )) as CpaOAuthCallbackResponse

  if (result.status !== "ok") {
    throw new Error(normalizeString(result.error) || "CPA 回调提交失败")
  }

  return {
    localhostUrl: normalizedCallbackUrl,
    verifiedStatus: "CPA 已通过接口提交回调"
  }
}
