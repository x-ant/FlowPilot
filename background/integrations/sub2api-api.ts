import type { OAuthBinding, Sub2ApiConfig } from "../../shared/oauth-integration"

type RequestOptions = {
  method?: "GET" | "POST"
  token?: string
  body?: Record<string, unknown>
  timeoutMs?: number
}

type Group = {
  id?: number
  name?: string
  platform?: string
}

type Proxy = {
  id?: number
  name?: string
  protocol?: string
  host?: string
  port?: number | string
  status?: string
}

export type Sub2ApiProxyOption = {
  id: number
  label: string
}

export type Sub2ApiGroupOption = {
  id: number
  name: string
}

export type Sub2ApiOAuthOptions = {
  groups: Sub2ApiGroupOption[]
  proxies: Sub2ApiProxyOption[]
}

const REDIRECT_URI = "http://localhost:1455/auth/callback"
const normalizeString = (value: unknown) => String(value || "").trim()

/**
 * 把 Sub2API 代理转换成下拉框使用的简短文案。
 *
 * @param proxy Sub2API 代理记录。
 * @return 包含名称、ID 和地址的显示文案。
 */
const buildProxyLabel = (proxy: Proxy) => {
  const name = normalizeString(proxy.name) || "未命名代理"
  const protocol = normalizeString(proxy.protocol)
  const host = normalizeString(proxy.host)
  const port = normalizeString(proxy.port)
  const address =
    protocol && host && port ? `${protocol}://${host}:${port}` : ""
  return [name, `#${proxy.id}`, address].filter(Boolean).join(" ")
}

/**
 * 调用 Sub2API JSON 管理接口，并兼容 `{ code, data }` 和普通 JSON 响应。
 *
 * @param origin Sub2API 服务 Origin。
 * @param path 管理接口路径。
 * @param options 请求方法、Bearer Token、请求体和超时时间。
 * @return 接口业务数据。
 */
const requestJson = async <T>(
  origin: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(options.timeoutMs) || 30000)
  )

  try {
    const response = await fetch(`${origin}${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })
    const text = await response.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (payload && typeof payload === "object" && "code" in payload) {
      if (Number(payload.code) === 0) {
        return payload.data as T
      }
      throw new Error(normalizeString(payload.message) || "Sub2API 请求失败")
    }
    if (!response.ok) {
      throw new Error(
        normalizeString(
          payload?.message || payload?.detail || payload?.error
        ) || `Sub2API 请求失败（HTTP ${response.status}）`
      )
    }
    return payload as T
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Sub2API 请求超时：${path}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 使用管理账号登录 Sub2API。
 *
 * @param config Sub2API 地址和登录凭据。
 * @return 服务 Origin 和管理 Bearer Token。
 */
const login = async (config: Sub2ApiConfig) => {
  const url = normalizeString(config.url)
  const email = normalizeString(config.email)
  const password = String(config.password || "")
  if (!url || !email || !password) {
    throw new Error("Sub2API 地址、登录邮箱和密码不能为空")
  }

  let origin = ""
  try {
    origin = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin
  } catch {
    throw new Error("Sub2API 地址格式无效")
  }
  const result = await requestJson<{
    access_token?: string
    accessToken?: string
  }>(origin, "/api/v1/auth/login", {
    method: "POST",
    body: { email, password }
  })
  const token = normalizeString(result?.access_token || result?.accessToken)
  if (!token) {
    throw new Error("Sub2API 登录返回缺少 access_token")
  }
  return { origin, token }
}

/**
 * 请求并严格筛选 Sub2API 的 OpenAI 分组。
 *
 * @param origin Sub2API 服务 Origin。
 * @param token 管理 Bearer Token。
 * @return platform 为 openai、且名称和 ID 有效的分组。
 */
const requestOpenAiGroups = async (origin: string, token: string) => {
  const groups = await requestJson<Group[]>(
    origin,
    "/api/v1/admin/groups/all",
    { token }
  )
  if (!Array.isArray(groups)) {
    throw new Error("Sub2API 分组接口返回格式无效")
  }

  return groups.flatMap((group) => {
    const id = Number(group.id)
    const name = normalizeString(group.name)
    const platform = normalizeString(group.platform).toLowerCase()
    return Number.isSafeInteger(id) && id > 0 && name && platform === "openai"
      ? [{ id, name }]
      : []
  })
}

/**
 * 请求 Sub2API 的已启用代理列表。
 *
 * @param origin Sub2API 服务 Origin。
 * @param token 管理 Bearer Token。
 * @return 已启用且具有有效 ID 的代理。
 */
const requestActiveProxies = async (origin: string, token: string) => {
  const proxies = await requestJson<Proxy[]>(
    origin,
    "/api/v1/admin/proxies/all?with_count=true",
    { token }
  )
  if (!Array.isArray(proxies)) {
    throw new Error("Sub2API 代理列表返回格式无效")
  }

  return proxies.filter((proxy) => {
    const id = Number(proxy.id)
    const status = normalizeString(proxy.status).toLowerCase()
    return (
      Number.isSafeInteger(id) && id > 0 && (!status || status === "active")
    )
  })
}

/**
 * 一次登录并读取 OpenAI 分组和已启用代理，供两个下拉框复用。
 *
 * @param config Sub2API 地址和登录凭据。
 * @return 可直接用于下拉框的分组和代理选项。
 */
export const listSub2ApiOAuthOptions = async (
  config: Sub2ApiConfig
): Promise<Sub2ApiOAuthOptions> => {
  const { origin, token } = await login(config)
  const [groups, proxies] = await Promise.all([
    requestOpenAiGroups(origin, token),
    requestActiveProxies(origin, token)
  ])
  return {
    groups,
    proxies: proxies.map((proxy) => ({
      id: Number(proxy.id),
      label: buildProxyLabel(proxy)
    }))
  }
}

/**
 * 校验当前选择的代理仍然存在且已启用。
 *
 * @param origin Sub2API 服务 Origin。
 * @param token 管理 Bearer Token。
 * @param proxyId 配置中保存的代理 ID。
 * @return 未选择代理时返回 undefined，否则返回已校验的代理 ID。
 */
const resolveProxyId = async (
  origin: string,
  token: string,
  proxyId: number | null
) => {
  if (!proxyId) {
    return undefined
  }
  const proxies = await requestActiveProxies(origin, token)
  if (!proxies.some((proxy) => Number(proxy.id) === proxyId)) {
    throw new Error(`Sub2API 代理 #${proxyId} 不存在或未启用`)
  }
  return proxyId
}

/**
 * 生成 OpenAI OAuth URL，并保存 callback 阶段需要的 Sub2API 会话信息。
 *
 * @param config Sub2API 地址、登录凭据和目标分组。
 * @return OAuth URL 与会话绑定信息。
 */
export const requestSub2ApiOAuthUrl = async (config: Sub2ApiConfig) => {
  const { origin, token } = await login(config)
  const proxyId = await resolveProxyId(origin, token, config.proxyId)
  const groups = await requestOpenAiGroups(origin, token)
  const groupName = normalizeString(config.groupName) || "codex"
  const group = groups.find((item) => {
    return item.name.toLowerCase() === groupName.toLowerCase()
  })
  const groupId = Number(group?.id)
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new Error(`Sub2API 中未找到 OpenAI 分组“${groupName}”`)
  }

  const result = await requestJson<{
    auth_url?: string
    authUrl?: string
    session_id?: string
    sessionId?: string
    state?: string
  }>(origin, "/api/v1/admin/openai/generate-auth-url", {
    method: "POST",
    token,
    timeoutMs: 90000,
    body: {
      redirect_uri: REDIRECT_URI,
      ...(proxyId ? { proxy_id: proxyId } : {})
    }
  })
  const oauthUrl = normalizeString(result.auth_url || result.authUrl)
  const sessionId = normalizeString(result.session_id || result.sessionId)
  let oauthState = normalizeString(result.state)
  try {
    oauthState ||= normalizeString(new URL(oauthUrl).searchParams.get("state"))
  } catch {
    oauthState = ""
  }
  if (!oauthUrl || !sessionId || !oauthState) {
    throw new Error("Sub2API 未返回完整的 OAuth 会话信息")
  }

  return {
    oauthUrl,
    binding: {
      source: "sub2api",
      sessionId,
      oauthState,
      groupId,
      ...(proxyId ? { proxyId } : {})
    } satisfies OAuthBinding
  }
}

/**
 * 交换 OpenAI callback，并把 OAuth 凭据创建为 Sub2API 账号。
 *
 * @param config Sub2API 地址、登录凭据和目标分组。
 * @param binding 生成 OAuth URL 时保存的会话信息。
 * @param callbackUrl OpenAI 返回的 localhost callback。
 * @param accountEmail 当前流程账号邮箱，用于账号名称兜底。
 * @return callback 地址和创建结果文案。
 */
export const submitSub2ApiOAuthCallback = async (
  config: Sub2ApiConfig,
  binding: Extract<OAuthBinding, { source: "sub2api" }>,
  callbackUrl: string,
  accountEmail = ""
) => {
  let callback: URL
  try {
    callback = new URL(normalizeString(callbackUrl))
  } catch {
    throw new Error("Sub2API OAuth callback 地址格式无效")
  }
  const code = normalizeString(callback.searchParams.get("code"))
  const state = normalizeString(callback.searchParams.get("state"))
  if (
    !["http:", "https:"].includes(callback.protocol) ||
    !["localhost", "127.0.0.1"].includes(callback.hostname) ||
    callback.pathname !== "/auth/callback" ||
    !code ||
    !state
  ) {
    throw new Error("Sub2API OAuth callback 地址无效")
  }
  if (state !== binding.oauthState) {
    throw new Error("Sub2API callback state 与当前授权会话不匹配")
  }

  const { origin, token } = await login(config)
  const exchange = await requestJson<Record<string, unknown>>(
    origin,
    "/api/v1/admin/openai/exchange-code",
    {
      method: "POST",
      token,
      timeoutMs: 120000,
      body: {
        session_id: binding.sessionId,
        code,
        state,
        ...(binding.proxyId ? { proxy_id: binding.proxyId } : {})
      }
    }
  )
  if (!exchange.access_token) {
    throw new Error("Sub2API 交换授权码后未返回 access_token")
  }

  const credentialKeys = [
    "access_token",
    "refresh_token",
    "id_token",
    "expires_at",
    "email",
    "chatgpt_account_id",
    "chatgpt_user_id",
    "organization_id",
    "plan_type",
    "client_id"
  ]
  const credentials = Object.fromEntries(
    credentialKeys
      .map((key) => [key, exchange[key]])
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== ""
      )
  )
  const created = await requestJson<{ id?: number | string }>(
    origin,
    "/api/v1/admin/accounts",
    {
      method: "POST",
      token,
      timeoutMs: 120000,
      body: {
        name: normalizeString(exchange.email) || normalizeString(accountEmail),
        notes: "",
        platform: "openai",
        type: "oauth",
        credentials,
        concurrency: 10,
        priority: 1,
        rate_multiplier: 1,
        group_ids: [binding.groupId],
        auto_pause_on_expired: true,
        ...(binding.proxyId ? { proxy_id: binding.proxyId } : {})
      }
    }
  )

  return {
    localhostUrl: callback.toString(),
    verifiedStatus: `Sub2API 已创建账号 #${created?.id || "unknown"}`
  }
}
