import { abortableSleep } from "../utils/abort"

import type { LogWriteOptions } from "../../shared/logging"

const HERO_SMS_API_URL = "https://hero-sms.com/stubs/handler_api.php"
const HERO_SMS_OPENAI_SERVICE_CODE = "dr"
const HERO_SMS_DEFAULT_OPERATOR = "any"
const HERO_SMS_DEFAULT_POLL_INTERVAL_MS = 5000
const HERO_SMS_DEFAULT_POLL_ROUNDS = 26

export type HeroSmsPhoneVerificationOptions = {
  apiKey: string
  countryId: number
  countryLabel: string
  operator: string
  /** 开启后不请求 HeroSMS，使用本地 mock 响应跑通流程。 */
  mockEnabled?: boolean
  /** 用户允许的最高单价；必填，用来防止无上限买号。 */
  maxPrice: string
  /** 固定价格档位；填写后直接按该价格买号，不再查询并选择最低档。 */
  fixedPrice?: string
  /** 将 HeroSMS 执行进度写入侧边栏执行日志。 */
  onLog?: (
    level: "error" | "info" | "warn" | "debug",
    message: string,
    options?: LogWriteOptions
  ) => void
  /** 通知侧边栏手机号已进入保护阶段/等待验证码已结束，用于决定停止策略。 */
  onPhoneVerificationPhase?: (
    phase: "phone_submitted" | "phone_wait_finished"
  ) => void
}

export type HeroSmsActivation = {
  /** 本次买号订单/激活任务 ID，后续查验证码、完成订单、取消订单都使用它。 */
  activationId: string
  /** HeroSMS 分配的手机号，填写页面时会结合 countryPhoneCode 处理区号。 */
  phoneNumber: string
  /** 本次买号实际扣费金额。 */
  activationCost: number
  /** 货币数字代码，例如 840 通常表示 USD 美元。 */
  currency: number
  /** 当前项目选择的 HeroSMS 国家 ID。 */
  countryId: number
  /** 当前项目展示用的国家名称。 */
  countryLabel: string
  /** HeroSMS 返回的平台国家编号，不是电话区号。 */
  countryCode: number
  /** 电话国家区号，例如 62 表示 +62。 */
  countryPhoneCode: number
  /** 是否支持在同一个激活订单上继续接收另一条短信。 */
  canGetAnotherSms: boolean
  /** 订单开始时间，通常是 ISO 格式 UTC 时间。 */
  activationTime: string
  /** 订单过期时间，超过后通常不再继续等待验证码。 */
  activationEndTime: string
  /** HeroSMS 实际分配的运营商；any 表示未指定运营商。 */
  activationOperator: string
  /** HeroSMS 返回的服务代码；OpenAI/ChatGPT 当前为 dr。 */
  serviceCode?: string
  /** HeroSMS 返回的号码/激活子类型。 */
  subtype?: number
  /** HeroSMS 返回的激活订单状态。 */
  status?: number
  /** 本地请求 getNumberV2 时选中的价格档位，用于和 activationCost 核对。 */
  selectedPrice?: number
}

export type HeroSmsActivationStatus = 3 | 6 | 8

type HeroSmsGetNumberV2Response = {
  /** 本次买号订单/激活任务 ID。 */
  activationId: string
  /** HeroSMS 返回的手机号。 */
  phoneNumber: string
  /** 本次买号实际扣费金额。 */
  activationCost: number
  /** 货币数字代码，例如 840 通常表示 USD 美元。 */
  currency: number
  /** HeroSMS 平台国家编号，不是电话区号。 */
  countryCode: number
  /** 电话国家区号，例如 62 表示 +62。 */
  countryPhoneCode: number
  /** 是否支持在同一个激活订单上继续接收另一条短信。 */
  canGetAnotherSms: boolean
  /** 订单开始时间，通常是 ISO 格式 UTC 时间。 */
  activationTime: string
  /** 订单过期时间，超过后通常不再继续等待验证码。 */
  activationEndTime: string
  /** HeroSMS 实际分配的运营商；any 表示未指定运营商。 */
  activationOperator: string
  /** HeroSMS 返回的服务代码；OpenAI/ChatGPT 当前为 dr。 */
  serviceCode?: string
  /** HeroSMS 返回的号码/激活子类型。 */
  subtype?: number
  /** HeroSMS 返回的激活订单状态。 */
  status?: number
}

type HeroSmsErrorResponse = {
  title: string
  details: string
  info?: Record<string, unknown>
}

type HeroSmsGetStatusV2Response = {
  verificationType?: number
  sms?: {
    dateTime?: string
    code?: string
    text?: string
  }
  call?: {
    from?: string
    text?: string
    code?: string
    dateTime?: string
    url?: string
    parsingCount?: number
  }
}

type HeroSmsCountryResponseItem = {
  id: number
  rus: string
  eng: string
  chn: string
  visible: 0 | 1
  retry: 0 | 1
}

type HeroSmsGetOperatorsResponse = {
  status: string
  countryOperators: Record<string, string[]>
}

type HeroSmsPriceInfo = {
  cost: number
  count: number
  physicalCount: number
}

type HeroSmsGetPricesResponse = Record<string, Record<string, HeroSmsPriceInfo>>

export type HeroSmsCountryOption = {
  value: string
  label: string
  countryLabel: string
  searchText: string
}

export type HeroSmsOperatorsByCountry = Record<string, string[]>

const HERO_SMS_GET_NUMBER_V2_ERROR_MESSAGES: Record<number, string> = {
  400: "请求参数无效",
  401: "无效的 API 密钥",
  402: "资金不足",
  403: "访问被拒绝",
  404: "未找到可用号码",
  422: "请求参数无效",
  500: "内部服务错误"
}

const HERO_SMS_GET_STATUS_V2_ERROR_MESSAGES: Record<number, string> = {
  400: "请求参数无效",
  401: "无效的 API 密钥",
  402: "资金不足",
  403: "访问被拒绝",
  404: "未找到激活",
  422: "请求参数无效",
  500: "内部服务错误"
}

const HERO_SMS_SET_STATUS_ERROR_MESSAGES: Record<number, string> = {
  400: "请求参数无效",
  401: "无效的 API 密钥",
  403: "访问被拒绝",
  404: "未找到激活",
  409: "无法取消激活",
  422: "请求参数无效",
  500: "内部服务错误"
}

const HERO_SMS_MOCK_COUNTRY: HeroSmsCountryResponseItem = {
  id: 4,
  rus: "Филиппины",
  eng: "Philippines",
  chn: "菲律宾",
  visible: 1,
  retry: 1
}

const HERO_SMS_MOCK_OPERATOR = "smart"
const HERO_SMS_MOCK_PHONE_NUMBER = "639317909039"
const HERO_SMS_MOCK_PHONE_CODE = "123456"

/**
 * 把 HeroSMS 响应体转换成适合错误信息展示的文本。
 *
 * 这里只作为兜底描述使用；官方错误响应优先走 { title, details } 解析。
 *
 * @param payload HeroSMS 原始响应体。
 * @return 可读的响应描述。
 */
const describeHeroSmsPayload = (payload: unknown) => {
  if (typeof payload === "string") {
    return payload.trim()
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    const text = String(
      record.message || record.msg || record.error || record.status || ""
    ).trim()
    if (text) {
      return text
    }

    try {
      return JSON.stringify(payload)
    } catch {
      return String(payload)
    }
  }

  return String(payload || "").trim()
}

/**
 * 按 HeroSMS 官方错误响应 Schema 提取错误内容。
 *
 * 错误响应固定为 { title, details, info? }；这里不猜其它字段，只有不符合
 * Schema 时才交给通用响应描述兜底。
 *
 * @param payload HeroSMS 错误响应体。
 * @return 官方错误代码和详情文本。
 */
const describeHeroSmsErrorPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ""
  }

  const errorPayload = payload as HeroSmsErrorResponse
  const title =
    typeof errorPayload.title === "string" ? errorPayload.title.trim() : ""
  const details =
    typeof errorPayload.details === "string" ? errorPayload.details.trim() : ""
  if (!title || !details) {
    return ""
  }

  return `${title}：${details}`
}

/**
 * 生成 HeroSMS 非 2xx 响应错误信息。
 *
 * @param actionLabel 当前调用的接口名称。
 * @param status HTTP 响应码。
 * @param payload HeroSMS 响应体。
 * @param statusMessages 当前接口官方响应码含义。
 * @return 适合展示给用户的错误文本。
 */
const formatHeroSmsHttpError = (
  actionLabel: string,
  status: number,
  payload: unknown,
  statusMessages: Record<number, string> = {}
) => {
  const statusMessage = statusMessages[status] || `HTTP ${status}`
  const payloadText =
    describeHeroSmsErrorPayload(payload) || describeHeroSmsPayload(payload)
  return payloadText
    ? `${actionLabel}失败：${payloadText}（HTTP ${status} ${statusMessage}）`
    : `${actionLabel}失败（HTTP ${status} ${statusMessage}）`
}

/**
 * 解析 HeroSMS handler 返回的文本响应。
 *
 * HeroSMS 成功响应多为 JSON，但 setStatus 的 200 响应是 string；所以这里只在
 * 文本看起来是 JSON 对象或数组时解析，否则保留原始字符串。
 *
 * @param text fetch 读取到的响应文本。
 * @return JSON 对象、数组或原始字符串。
 */
const parseHeroSmsPayload = (text: string) => {
  const trimmed = String(text || "").trim()
  if (!trimmed) {
    return ""
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      return trimmed
    }
  }

  return trimmed
}

/**
 * 构造 HeroSMS handler API URL。
 *
 * @param query 需要写入 URL query string 的参数。
 * @return 带完整查询参数的 HeroSMS 请求地址。
 */
const buildHeroSmsUrl = (query: Record<string, string | number>) => {
  const url = new URL(HERO_SMS_API_URL)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  return url.toString()
}

const maskHeroSmsQuery = (query: Record<string, string | number>) => {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      return [key, /api[_-]?key/i.test(key) ? "***MASKED***" : value] as const
    })
  )
}

const maskHeroSmsUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has("api_key")) {
      parsed.searchParams.set("api_key", "***MASKED***")
    }
    return parsed.toString()
  } catch {
    return url.replace(/(api_key=)[^&]+/i, "$1***MASKED***")
  }
}

const logHeroSmsRawSample = (
  phase: "mock" | "response",
  actionLabel: string,
  details: Record<string, unknown>
) => {
  console.info(`[flowpilot][HeroSMS raw][${phase}] ${actionLabel}`, details)
}

const logHeroSmsProgress = (
  options: HeroSmsPhoneVerificationOptions,
  level: "error" | "info" | "warn" | "debug",
  message: string,
  logOptions?: LogWriteOptions
) => {
  options.onLog?.(level, message, logOptions)
}

/**
 * 提取 HeroSMS 请求异常细节。
 *
 * @param error fetch 或响应读取过程中抛出的异常。
 * @return 带异常类型和消息的诊断文本。
 */
const describeHeroSmsRequestError = (error: unknown) => {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message || "DOMException"}`
  }

  if (error instanceof Error) {
    return `${error.name || "Error"}: ${error.message || "unknown"}`
  }

  return String(error || "unknown")
}

/**
 * 生成 HeroSMS mock 响应。
 *
 * mock 只用于本地跑通注册流程，不请求 HeroSMS，也不产生真实扣费。
 *
 * @param query HeroSMS handler API 查询参数。
 * @return 与对应接口 Schema 对齐的 mock 响应。
 */
const buildHeroSmsMockPayload = (query: Record<string, string | number>) => {
  const action = String(query.action || "")
  const country = normalizeRequiredHeroSmsCountryId(
    query.country ?? HERO_SMS_MOCK_COUNTRY.id
  )
  const maxPrice = normalizeHeroSmsPriceNumber(query.maxPrice) || 0.01

  if (action === "getCountries") {
    return [HERO_SMS_MOCK_COUNTRY]
  }

  if (action === "getOperators") {
    return {
      status: "success",
      countryOperators: {
        [String(country)]: [HERO_SMS_MOCK_OPERATOR]
      }
    }
  }

  if (action === "getPrices") {
    return {
      [String(country)]: {
        mockLow: {
          cost: 0.01,
          count: 10,
          physicalCount: 10
        },
        mockHigh: {
          cost: 0.02,
          count: 10,
          physicalCount: 10
        }
      }
    }
  }

  if (action === "getNumberV2") {
    return {
      activationId: "mock-activation-1",
      phoneNumber: HERO_SMS_MOCK_PHONE_NUMBER,
      activationCost: maxPrice,
      currency: 840,
      countryCode: country,
      countryPhoneCode: 63,
      canGetAnotherSms: true,
      activationTime: new Date().toISOString(),
      activationEndTime: new Date(
        Date.now() + 2 * 60 * 60 * 1000
      ).toISOString(),
      activationOperator: String(query.operator || HERO_SMS_MOCK_OPERATOR),
      serviceCode: HERO_SMS_OPENAI_SERVICE_CODE,
      subtype: 1,
      status: 4
    }
  }

  if (action === "getStatusV2") {
    return {
      verificationType: 2,
      sms: {
        dateTime: new Date().toISOString(),
        code: HERO_SMS_MOCK_PHONE_CODE,
        text: `Mock verification code: ${HERO_SMS_MOCK_PHONE_CODE}`
      },
      call: {
        from: "",
        text: "",
        code: "",
        dateTime: "",
        url: "",
        parsingCount: 0
      }
    }
  }

  if (action === "setStatus") {
    return "STATUS_OK"
  }

  throw new Error(`HeroSMS mock 未支持接口：${action || "unknown"}`)
}

/**
 * 请求 HeroSMS 列表接口并解析响应。
 *
 * getCountries/getOperators 文档示例均带 api_key，这里按文档要求必传。
 *
 * @param query 传给 handler API 的查询参数。
 * @param actionLabel 用于错误信息的动作名称。
 * @param apiKey HeroSMS API Key。
 * @return 解析后的 JSON 对象、数组或原始文本。
 * @throws 当 API Key 缺失、HTTP 请求失败或 HeroSMS 返回非 2xx 时抛错。
 */
const fetchHeroSmsPublicPayload = async <T>(
  query: Record<string, string | number>,
  actionLabel: string,
  apiKey = "",
  mockEnabled = false
): Promise<T> => {
  if (mockEnabled) {
    const mockPayload = buildHeroSmsMockPayload(query)
    logHeroSmsRawSample("mock", actionLabel, {
      request: maskHeroSmsQuery(query),
      payload: mockPayload
    })
    return mockPayload as T
  }

  const normalizedApiKey = String(apiKey || "").trim()
  if (!normalizedApiKey) {
    throw new Error("缺少 HeroSMS 接码 API")
  }

  const requestQuery = {
    api_key: normalizedApiKey,
    ...query
  }
  const requestUrl = buildHeroSmsUrl(requestQuery)
  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  })
  const rawText = await response.text()
  const payload = parseHeroSmsPayload(rawText)
  logHeroSmsRawSample("response", actionLabel, {
    requestUrl: maskHeroSmsUrl(requestUrl),
    request: maskHeroSmsQuery(requestQuery),
    status: response.status,
    ok: response.ok,
    rawText,
    payload
  })
  if (!response.ok) {
    throw new Error(
      `${actionLabel}失败：${describeHeroSmsPayload(payload) || response.status}`
    )
  }

  return payload as T
}

/**
 * 请求 HeroSMS handler API 并解析响应。
 *
 * @param options HeroSMS 认证和购买配置。
 * @param query 传给 handler API 的查询参数。
 * @param actionLabel 用于错误信息的动作名称。
 * @param errorStatusMessages 响应码与对应信息映射
 * @return 解析后的 JSON 对象、数组或原始文本。
 * @throws 当 API Key 缺失、HTTP 请求失败或 HeroSMS 返回非 2xx 时抛错。
 */
const fetchHeroSmsPayload = async <T>(
  options: HeroSmsPhoneVerificationOptions,
  query: Record<string, string | number>,
  actionLabel: string,
  errorStatusMessages: Record<number, string> = {}
): Promise<T> => {
  const apiKey = String(options.apiKey || "").trim()
  if (options.mockEnabled) {
    const mockPayload = buildHeroSmsMockPayload(query)
    logHeroSmsRawSample("mock", actionLabel, {
      request: maskHeroSmsQuery(query),
      payload: mockPayload
    })
    return mockPayload as T
  }

  if (!apiKey) {
    throw new Error("缺少 HeroSMS 接码 API")
  }

  const requestQuery = {
    api_key: apiKey,
    ...query
  }
  const requestUrl = buildHeroSmsUrl(requestQuery)
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(requestUrl)
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const detail = describeHeroSmsRequestError(error)
    logHeroSmsProgress(
      options,
      "warn",
      `${actionLabel} 请求异常：${detail}；耗时 ${elapsedMs}ms；请求 ${JSON.stringify(
        maskHeroSmsQuery(requestQuery)
      )}`
    )
    throw new Error(`${actionLabel}请求异常：${detail}`)
  }

  let rawText = ""
  try {
    rawText = await response.text()
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const detail = describeHeroSmsRequestError(error)
    logHeroSmsProgress(
      options,
      "warn",
      `${actionLabel} 响应读取异常：${detail}；HTTP ${response.status}；耗时 ${elapsedMs}ms；请求 ${JSON.stringify(
        maskHeroSmsQuery(requestQuery)
      )}`
    )
    throw new Error(`${actionLabel}响应读取异常：${detail}`)
  }

  const elapsedMs = Date.now() - startedAt
  const payload = parseHeroSmsPayload(rawText)
  logHeroSmsRawSample("response", actionLabel, {
    requestUrl: maskHeroSmsUrl(requestUrl),
    request: maskHeroSmsQuery(requestQuery),
    status: response.status,
    ok: response.ok,
    elapsedMs,
    rawText,
    payload
  })
  if (!response.ok) {
    logHeroSmsProgress(
      options,
      "warn",
      `${actionLabel} 响应异常：HTTP ${response.status}，耗时 ${elapsedMs}ms，请求 ${JSON.stringify(
        maskHeroSmsQuery(requestQuery)
      )}`
    )
    throw new Error(
      formatHeroSmsHttpError(
        actionLabel,
        response.status,
        payload,
        errorStatusMessages
      )
    )
  }

  return payload as T
}

/**
 * 把页面输入或 HeroSMS 返回的价格统一成最多 4 位小数的数字。
 *
 * HeroSMS 价格涉及真实扣费，所以只接受大于 0 的价格；无效值返回 null，
 * 由调用方决定是提示用户还是跳过该档位。
 *
 * @param value 原始价格文本或数字。
 * @return 规范化后的价格；无法识别时返回 null。
 */
const normalizeHeroSmsPriceNumber = (value: unknown) => {
  const direct = Number(value)
  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct * 10000) / 10000
  }

  const matched = String(value ?? "")
    .trim()
    .match(/\d+(?:[.,]\d+)?/)
  if (!matched) {
    return null
  }

  const parsed = Number(matched[0].replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 10000) / 10000
    : null
}

/**
 * 校验并规范化 HeroSMS 国家 ID。
 *
 * country 是 HeroSMS 买号和查价接口的必填参数。getCountries Schema 允许
 * 国家 ID 为 0，所以这里允许 0，但空字符串/null/undefined 仍然按缺失处理，
 * 避免把“没选国家”伪装成国家 0。
 *
 * @param value 页面传入的国家 ID。
 * @return 可传给 HeroSMS 的 0..999 整数国家 ID。
 * @throws 当国家 ID 缺失或不在 Schema 范围内时抛错。
 */
const normalizeRequiredHeroSmsCountryId = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error("HeroSMS 国家选项无效，请重新选择国家")
  }

  const parsed = Math.floor(Number(value))
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 999) {
    return parsed
  }

  throw new Error("HeroSMS 国家选项无效，请重新选择国家")
}

/**
 * 规范化 HeroSMS 运营商筛选参数。
 *
 * operator 是可选筛选项；FlowPilot 的 HeroSMS 适配层也只在非 any 时传它。
 * 用户选择 any 表示不限运营商，和不传 operator 是同一个意图。
 *
 * @param value 页面选择的运营商。
 * @return 需要传给 HeroSMS 的具体运营商；不限运营商时返回空字符串。
 */
const normalizeHeroSmsOperatorFilter = (value: unknown) => {
  const operator = String(value || HERO_SMS_DEFAULT_OPERATOR)
    .trim()
    .toLowerCase()
  return operator && operator !== HERO_SMS_DEFAULT_OPERATOR ? operator : ""
}

/**
 * 规范化 HeroSMS 下拉里展示的运营商值。
 *
 * @param value HeroSMS 返回的运营商原始值。
 * @return 可用于 getNumberV2 operator 参数的运营商；无效时返回空字符串。
 */
const normalizeHeroSmsOperatorValue = (value: unknown) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
}

/**
 * 把 getCountries 响应转换成侧边栏 Select 选项。
 *
 * 只展示 visible=1 且 retry=1 的国家；id 按 getCountries Schema 允许 0..999。
 *
 * @param payload HeroSMS getCountries 响应；真实接口返回按国家 ID 分组的对象，mock 可返回数组。
 * @return 可搜索、可展示的国家选项。
 */
const parseHeroSmsCountryOptions = (payload: unknown) => {
  const entries = Array.isArray(payload)
    ? payload
    : Object.values((payload || {}) as Record<string, unknown>)
  const seen = new Set<string>()

  return entries
    .map((entry) => {
      const country = entry as Partial<HeroSmsCountryResponseItem>
      const id = Math.floor(Number(country.id))
      if (!Number.isFinite(id) || id < 0 || id > 999 || seen.has(String(id))) {
        return null
      }

      if (country.visible !== 1 || country.retry !== 1) {
        return null
      }

      const english = String(country.eng || "").trim()
      const chinese = String(country.chn || "").trim()
      const russian = String(country.rus || "").trim()
      const label =
        chinese && english && chinese.toLowerCase() !== english.toLowerCase()
          ? `${chinese} (${english})`
          : chinese || english || `Country #${id}`
      seen.add(String(id))

      return {
        value: String(id),
        label,
        countryLabel: english || chinese || `Country #${id}`,
        searchText: [String(id), english, chinese, russian]
          .filter(Boolean)
          .join(" ")
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      return String(left?.countryLabel || left?.label || "").localeCompare(
        String(right?.countryLabel || right?.label || "")
      )
    }) as HeroSmsCountryOption[]
}

/**
 * 把 getOperators 响应转换成按国家 ID 分组的运营商列表。
 *
 * @param payload HeroSMS getOperators 响应对象。
 * @return key 为国家 ID、value 为运营商数组的映射。
 */
const parseHeroSmsOperatorsByCountry = (
  payload: HeroSmsGetOperatorsResponse
) => {
  return Object.entries(payload.countryOperators || {}).reduce(
    (result, [countryId, operators]) => {
      const normalizedCountryId = Math.floor(Number(countryId))
      if (
        !Number.isFinite(normalizedCountryId) ||
        normalizedCountryId < 0 ||
        normalizedCountryId > 999
      ) {
        return result
      }

      const seen = new Set<string>()
      const normalizedOperators = operators
        .map(normalizeHeroSmsOperatorValue)
        .filter(Boolean)
        .filter((operator) => {
          if (operator === HERO_SMS_DEFAULT_OPERATOR || seen.has(operator)) {
            return false
          }

          seen.add(operator)
          return true
        })

      if (normalizedOperators.length) {
        result[String(normalizedCountryId)] = normalizedOperators
      }

      return result
    },
    {} as HeroSmsOperatorsByCountry
  )
}

/**
 * 从 HeroSMS getPrices 文档结构里收集指定服务的可用价格档位。
 *
 * HeroSMS getPrices Schema 是两层 additionalProperties，第二层 value 才是
 * { cost, count, physicalCount }。本请求已经传入 service 和 country，所以这里
 * 只在这两层 Schema 内收集价格，不递归猜测其它字段。价格涉及真实扣费，所以要求
 * count 与 physicalCount 都大于 0，避免对无库存档位发起购买。
 *
 * @param payload HeroSMS getPrices 响应对象。
 * @return 可购买的价格候选列表。
 */
const collectHeroSmsPriceCandidates = (payload: HeroSmsGetPricesResponse) => {
  const candidates: number[] = []

  Object.values(payload).forEach((priceGroup) => {
    if (!priceGroup || typeof priceGroup !== "object") {
      return
    }

    Object.values(priceGroup).forEach((priceInfo) => {
      const cost = normalizeHeroSmsPriceNumber(priceInfo.cost)
      const count = Number(priceInfo.count)
      const physicalCount = Number(priceInfo.physicalCount)
      if (
        cost !== null &&
        Number.isFinite(count) &&
        count > 0 &&
        Number.isFinite(physicalCount) &&
        physicalCount > 0
      ) {
        candidates.push(cost)
      }
    })
  })

  return candidates
}

/**
 * 判断买号失败响应是否属于明确不可继续的配置或余额问题。
 *
 * 这些错误和价格档位无关，继续尝试更高价格也不会成功，所以直接中断。
 *
 * @param payload HeroSMS 买号响应或异常文本。
 * @return 命中终止类错误时返回 true。
 */
const isTerminalHeroSmsActivationPayload = (payload: unknown) => {
  return /(?:BAD_KEY|NO_BALANCE|BANNED|BAD_ACTION|WRONG_SERVICE|WRONG_COUNTRY|ERROR_SQL)/i.test(
    describeHeroSmsPayload(payload)
  )
}

/**
 * 生成本次买号要尝试的价格档位列表。
 *
 * 规则：
 * 1. 价格上限必填，防止没有上限时由平台默认价格策略扣费。
 * 2. 填了固定价格档位时，只返回该档位，不查询 getPrices。
 * 3. 没填固定价格档位时，查询 getPrices，在价格上限内按低价优先返回所有可用档位。
 *
 * @param options HeroSMS 认证、国家和价格配置。
 * @return 本次请求 getNumberV2 要依次尝试的 maxPrice 列表。
 * @throws 当价格上限无效、固定档位超过上限、或上限内没有可用档位时抛错。
 */
const resolveHeroSmsPriceCandidates = async (
  options: HeroSmsPhoneVerificationOptions
) => {
  const maxPrice = normalizeHeroSmsPriceNumber(options.maxPrice)
  if (maxPrice === null) {
    throw new Error("HeroSMS 价格上限必填，且必须是大于 0 的数字")
  }

  const fixedPrice = normalizeHeroSmsPriceNumber(options.fixedPrice)
  if (fixedPrice !== null) {
    if (fixedPrice > maxPrice) {
      throw new Error(
        `HeroSMS 固定价格档位 ${fixedPrice} 不能高于价格上限 ${maxPrice}`
      )
    }

    return [fixedPrice]
  }

  const payload = await fetchHeroSmsPayload<HeroSmsGetPricesResponse>(
    options,
    {
      action: "getPrices",
      service: HERO_SMS_OPENAI_SERVICE_CODE,
      country: normalizeRequiredHeroSmsCountryId(options.countryId)
    },
    "HeroSMS getPrices"
  )
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("HeroSMS getPrices 返回格式异常，未收到价格对象")
  }

  const candidates = Array.from(
    new Set(
      collectHeroSmsPriceCandidates(payload)
        .filter((price) => price <= maxPrice)
        .map((price) => Math.round(price * 10000) / 10000)
    )
  ).sort((left, right) => left - right)

  if (candidates.length === 0) {
    throw new Error(`HeroSMS 价格上限 ${maxPrice} 内没有查到可用号码价格档位`)
  }

  return candidates
}

/**
 * 从 HeroSMS 状态响应字段中提取验证码。
 *
 * getStatusV2 的验证码只来自 sms.code 或 call.code；这里仅做数字验证码截取。
 *
 * @param value sms.code 或 call.code。
 * @return 4 到 8 位验证码；没有匹配时返回空字符串。
 */
const extractHeroSmsCode = (value: unknown) => {
  return (
    String(value || "")
      .trim()
      .match(/\b(\d{4,8})\b/)?.[1] || ""
  )
}

/**
 * 把 getNumberV2 响应转换成当前流程使用的激活对象。
 *
 * @param payload HeroSMS getNumberV2 响应对象。
 * @param options 本次买号时使用的国家配置。
 * @return 可继续提交页面和轮询验证码的激活对象；关键字段缺失时返回 null。
 */
const parseHeroSmsActivation = (
  payload: HeroSmsGetNumberV2Response,
  options: HeroSmsPhoneVerificationOptions
): HeroSmsActivation | null => {
  const activationId =
    typeof payload.activationId === "string" ? payload.activationId.trim() : ""
  const phoneNumber =
    typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : ""
  if (!activationId || !phoneNumber) {
    return null
  }

  return {
    activationId,
    phoneNumber,
    activationCost: payload.activationCost,
    currency: payload.currency,
    countryId: normalizeRequiredHeroSmsCountryId(options.countryId),
    countryLabel: String(options.countryLabel || "").trim(),
    countryCode: payload.countryCode,
    countryPhoneCode: payload.countryPhoneCode,
    canGetAnotherSms: payload.canGetAnotherSms,
    activationTime: payload.activationTime,
    activationEndTime: payload.activationEndTime,
    activationOperator: payload.activationOperator,
    serviceCode: payload.serviceCode,
    subtype: payload.subtype,
    status: payload.status
  }
}

/**
 * 校验 HeroSMS 返回的实际成本没有超过本轮请求档位。
 *
 * selectedPrice 是本地调用 getNumberV2 时传入的 maxPrice，并且同时传了
 * fixedPrice=true；activationCost 是 HeroSMS 返回的实际扣费。这个校验理论上
 * 不应触发，但如果前面的价格选择或 HeroSMS 行为异常，这里会在提交手机号前拦截。
 *
 * @param activation HeroSMS getNumberV2 返回并规范化后的激活信息。
 * @throws 当实际成本缺失、请求档位缺失，或实际成本高于请求档位时抛错。
 */
export const assertHeroSmsActivationCostWithinExpected = (
  activation: HeroSmsActivation
) => {
  const expectedPrice = Number(activation.selectedPrice)
  const actualCost = Number(activation.activationCost)
  if (!Number.isFinite(expectedPrice) || expectedPrice <= 0) {
    throw new Error("HeroSMS 请求价格档位缺失，已停止手机号验证流程")
  }

  if (!Number.isFinite(actualCost) || actualCost < 0) {
    throw new Error("HeroSMS 实际成本无效，已停止手机号验证流程")
  }

  if (actualCost > expectedPrice + 0.000001) {
    throw new Error(
      `HeroSMS 实际成本 ${actualCost} 高于本次请求固定档位 ${expectedPrice}，已停止手机号验证流程`
    )
  }
}

/**
 * 拉取 HeroSMS 国家下拉选项。
 *
 * @return 可直接用于侧边栏国家 Select 的选项列表。
 * @throws 当接口失败或没有解析到国家时抛错。
 */
export const fetchHeroSmsCountries = async (
  apiKey = "",
  mockEnabled = false
) => {
  const payload = await fetchHeroSmsPublicPayload<unknown>(
    {
      action: "getCountries"
    },
    "HeroSMS getCountries",
    apiKey,
    mockEnabled
  )
  const countries = parseHeroSmsCountryOptions(payload)
  if (countries.length === 0) {
    throw new Error("HeroSMS 国家列表为空")
  }

  return countries
}

/**
 * 拉取 HeroSMS 按国家分组的运营商列表。
 *
 * @return key 为国家 ID、value 为运营商列表的对象。
 * @throws 当接口失败或没有解析到运营商映射时抛错。
 */
export const fetchHeroSmsOperators = async (
  countryId: string | number,
  apiKey = "",
  mockEnabled = false
) => {
  const normalizedCountryId = normalizeRequiredHeroSmsCountryId(countryId)
  const payload = await fetchHeroSmsPublicPayload<HeroSmsGetOperatorsResponse>(
    {
      action: "getOperators",
      country: normalizedCountryId
    },
    "HeroSMS getOperators",
    apiKey,
    mockEnabled
  )
  const operatorsByCountry = parseHeroSmsOperatorsByCountry(payload)
  if (Object.keys(operatorsByCountry).length === 0) {
    throw new Error("HeroSMS 运营商列表为空")
  }

  return operatorsByCountry
}

/**
 * 从 HeroSMS 获取手机号。
 *
 * 固定价格档位存在时只尝试该档位；否则先查 getPrices，再按低价优先逐档
 * 调用 getNumberV2。每次请求都传 fixedPrice=true，避免平台自动抬价。
 *
 * @param options HeroSMS API Key、国家、运营商和价格配置。
 * @return HeroSMS 激活信息，并带上本轮请求使用的 selectedPrice。
 * @throws 当查价失败、无可用档位或买号失败时抛错。
 */
export const requestHeroSmsActivation = async (
  options: HeroSmsPhoneVerificationOptions
) => {
  const pricesToTry = await resolveHeroSmsPriceCandidates(options)
  const operator = normalizeHeroSmsOperatorFilter(options.operator)
  logHeroSmsProgress(
    options,
    "info",
    `HeroSMS 准备获取手机号：国家 ${options.countryLabel || options.countryId}，运营商 ${
      operator || "any"
    }，价格档位 ${pricesToTry.join(", ")}`
  )

  let lastPayloadText = ""
  for (const maxPrice of pricesToTry) {
    logHeroSmsProgress(
      options,
      "info",
      `HeroSMS 正在请求手机号：maxPrice=${maxPrice}，fixedPrice=true`
    )
    const payload = await fetchHeroSmsPayload<HeroSmsGetNumberV2Response>(
      options,
      {
        action: "getNumberV2",
        service: HERO_SMS_OPENAI_SERVICE_CODE,
        country: normalizeRequiredHeroSmsCountryId(options.countryId),
        ...(operator ? { operator } : {}),
        // 价格涉及真实扣费：每个档位都固定价格购买，不允许平台自动抬价。
        maxPrice,
        fixedPrice: "true"
      },
      "HeroSMS getNumberV2",
      HERO_SMS_GET_NUMBER_V2_ERROR_MESSAGES
    )
    const activation = parseHeroSmsActivation(payload, options)
    if (activation) {
      logHeroSmsProgress(
        options,
        "info",
        `HeroSMS 已获取手机号 ${activation.phoneNumber}：订单 ${activation.activationId}，国家码 ${activation.countryCode}，区号 +${activation.countryPhoneCode}，运营商 ${activation.activationOperator}，成本 ${activation.activationCost}，币种 ${activation.currency}，结束时间 ${activation.activationEndTime}`
      )
      return {
        ...activation,
        selectedPrice: maxPrice
      }
    }

    lastPayloadText = describeHeroSmsPayload(payload) || lastPayloadText
    if (isTerminalHeroSmsActivationPayload(payload)) {
      throw new Error(`HeroSMS 获取手机号失败：${lastPayloadText}`)
    }
  }

  throw new Error(
    `HeroSMS 获取手机号失败，已按低价优先尝试档位：${pricesToTry.join(", ")}${
      lastPayloadText ? `；最后响应：${lastPayloadText}` : ""
    }`
  )
}

/**
 * 轮询 HeroSMS getStatusV2 获取手机验证码。
 *
 * @param options HeroSMS API Key 等请求配置。
 * @param activation 已创建的 HeroSMS 激活订单。
 * @param signal 外层运行流程的取消信号。
 * @return 获取到的验证码。
 * @throws 超时、请求失败或外层取消时抛错。
 */
export const pollHeroSmsCode = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation,
  signal?: AbortSignal
) => {
  let lastStatus = ""
  const pollLogId = `${Date.now()}-hero-sms-poll-${activation.activationId}`

  // 130s，2分钟10秒，2分钟可以取消判断为确实收不到验证码了，这里冗余10秒
  for (let round = 1; round <= HERO_SMS_DEFAULT_POLL_ROUNDS; round += 1) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }

    let payload: HeroSmsGetStatusV2Response
    try {
      payload = await fetchHeroSmsPayload<HeroSmsGetStatusV2Response>(
        options,
        {
          action: "getStatusV2",
          id: activation.activationId
        },
        "HeroSMS getStatusV2",
        HERO_SMS_GET_STATUS_V2_ERROR_MESSAGES
      )
    } catch (error) {
      const detail = describeHeroSmsRequestError(error)
      logHeroSmsProgress(
        options,
        "warn",
        `HeroSMS 查询短信验证码失败：订单 ${activation.activationId}，第 ${round}/${HERO_SMS_DEFAULT_POLL_ROUNDS} 轮；${detail}`
      )
      throw new Error(
        `HeroSMS 查询短信验证码失败：订单 ${activation.activationId}，第 ${round}/${HERO_SMS_DEFAULT_POLL_ROUNDS} 轮；${detail}`
      )
    }
    lastStatus = describeHeroSmsPayload(payload)

    const code =
      extractHeroSmsCode(payload.sms?.code) ||
      extractHeroSmsCode(payload.call?.code)
    if (code) {
      logHeroSmsProgress(
        options,
        "info",
        `HeroSMS 已收到短信验证码：订单 ${activation.activationId}，第 ${round} 轮`
      )
      return code
    }

    const currentRoundText = `当前第 ${round}/${HERO_SMS_DEFAULT_POLL_ROUNDS} 轮`
    logHeroSmsProgress(
      options,
      "info",
      `HeroSMS 正在等待短信验证码：订单 ${activation.activationId}，${currentRoundText}，每 ${
        HERO_SMS_DEFAULT_POLL_INTERVAL_MS / 1000
      } 秒查询一次，状态 ${lastStatus || "空"}`,
      {
        id: pollLogId,
        highlights: [currentRoundText]
      }
    )
    if (round < HERO_SMS_DEFAULT_POLL_ROUNDS) {
      await abortableSleep(HERO_SMS_DEFAULT_POLL_INTERVAL_MS, signal)
    }
  }

  throw new Error(
    `等待手机验证码超时${lastStatus ? `，HeroSMS 最后状态：${lastStatus}` : ""}`
  )
}

/**
 * 更新 HeroSMS 激活状态。
 *
 * 官方状态：3 请求重新发送短信，6 完成激活，8 取消激活并返还资金。
 *
 * @param options HeroSMS API Key 等请求配置。
 * @param activation 已创建的 HeroSMS 激活订单。
 * @param status 要设置的官方激活状态。
 * @throws 当状态更新请求失败时抛错。
 */
export const setHeroSmsActivationStatus = async (
  options: HeroSmsPhoneVerificationOptions,
  activation: HeroSmsActivation,
  status: HeroSmsActivationStatus
) => {
  await fetchHeroSmsPayload<string>(
    options,
    {
      action: "setStatus",
      id: activation.activationId,
      status
    },
    "HeroSMS setStatus",
    HERO_SMS_SET_STATUS_ERROR_MESSAGES
  )
}

/**
 * 在手机号验证页面填入 HeroSMS 手机号并点击继续。
 *
 * 该函数会被 chrome.scripting.executeScript 注入目标页面执行，所以内部只能使用
 * 页面环境可用的 DOM API，不能依赖扩展上下文里的变量。
 *
 * @param phoneNumber HeroSMS 返回的完整手机号。
 * @param _countryLabel 侧边栏选择的国家展示名；当前保留参数用于兼容调用方。
 * @param _countryPhoneCode HeroSMS 返回的手机号区号；当前由页面根据完整号码自动识别国家。
 * @return 页面操作结果。
 */
export const submitPhoneNumberInPage = (
  phoneNumber: string,
  _countryLabel: string,
  _countryPhoneCode: number
): Promise<{ ok: boolean; message: string }> => {
  const phoneInputSelectors = [
    "input[type='tel']",
    "input[name*='phone' i]:not([type='hidden'])",
    "input[id*='phone' i]:not([type='hidden'])",
    "input[autocomplete='tel']",
    "input[placeholder*='phone' i]",
    "input[placeholder*='手机号']",
    "input[placeholder*='电话号码']",
    "input[aria-label*='phone' i]",
    "input[aria-label*='手机号']",
    "input[aria-label*='电话号码']"
  ]
  const continueButtonTexts = [
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

  /**
   * 在页面脚本里等待一小段时间。
   *
   * @param timeoutMs 等待毫秒数。
   * @return 等待完成的 Promise。
   */
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
  }

  /**
   * 规范化按钮或国家选项文本，便于做宽松匹配。
   *
   * @param value 原始文本。
   * @return 去空白并转小写后的文本。
   */
  const normalizeText = (value: string) => {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

  /**
   * 只保留字符串里的数字。
   *
   * @param value 原始文本。
   * @return 数字字符串。
   */
  const normalizeDigits = (value: string) => {
    return String(value || "").replace(/\D+/g, "")
  }

  /**
   * 判断元素是否在页面上可见。
   *
   * @param element 待检测元素。
   * @return 元素有尺寸且没有被 display/visibility 隐藏时返回 true。
   */
  const isVisible = (element: Element | null) => {
    if (!element) {
      return false
    }

    const htmlElement = element as HTMLElement
    const rect = htmlElement.getBoundingClientRect()
    const style = window.getComputedStyle(htmlElement)

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    )
  }

  /**
   * 判断按钮类元素是否可点击。
   *
   * @param element 待检测元素。
   * @return 可见且未 disabled 时返回 true。
   */
  const isEnabled = (element: Element | null) => {
    const htmlElement = element as HTMLElement | null
    return Boolean(
      htmlElement &&
        isVisible(htmlElement) &&
        !(htmlElement as HTMLButtonElement).disabled &&
        htmlElement.getAttribute("aria-disabled") !== "true"
    )
  }

  /**
   * 收集元素上可用于匹配按钮文案的文本。
   *
   * @param element 页面元素。
   * @return input value、textContent、aria-label 和 title 的组合文本。
   */
  const getElementText = (element: Element) => {
    const inputValue = element instanceof HTMLInputElement ? element.value : ""

    return [
      inputValue,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
  }

  /**
   * 以 React 可感知的方式设置 input 值。
   *
   * @param input 目标输入框。
   * @param value 要写入的值。
   */
  const setInputValue = (input: HTMLInputElement, value: string) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    if (valueSetter) {
      valueSetter.call(input, value)
    } else {
      input.value = value
    }

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  /**
   * 查找页面上的手机号输入框。
   *
   * @return 第一个可见且可编辑的手机号输入框。
   */
  const findPhoneInput = () => {
    for (const selector of phoneInputSelectors) {
      const input = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          const candidate = element as HTMLInputElement
          return (
            candidate instanceof HTMLInputElement &&
            candidate.type !== "hidden" &&
            !candidate.disabled &&
            isVisible(candidate)
          )
        }
      ) as HTMLInputElement | undefined

      if (input) {
        return input
      }
    }

    return undefined
  }

  /**
   * 查找手机号页继续按钮。
   *
   * @return 第一个文案匹配且可点击的按钮。
   */
  const findContinueButton = () => {
    const buttonTexts = continueButtonTexts.map(normalizeText)
    return Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='button'],input[type='submit']"
      )
    ).find((element) => {
      return (
        isEnabled(element) &&
        buttonTexts.some((text) => {
          return normalizeText(getElementText(element)).includes(text)
        })
      )
    }) as HTMLElement | undefined
  }

  /**
   * 点击继续按钮。
   *
   * 这里优先模拟真实点击，保证页面挂在按钮 click 上的校验和通道逻辑会执行。
   *
   * @param button 继续按钮。
   */
  const clickButton = (button: HTMLElement) => {
    button.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    )
  }

  return (async () => {
    const startedAt = Date.now()
    let phoneInput: HTMLInputElement | undefined

    while (Date.now() - startedAt < 15000) {
      phoneInput = findPhoneInput()
      if (phoneInput) {
        break
      }

      await waitForDelay(300)
    }

    if (!phoneInput) {
      return {
        ok: false,
        message: "未找到手机号输入框"
      }
    }

    const digits = normalizeDigits(phoneNumber)
    setInputValue(phoneInput, `+${digits}`)
    phoneInput.focus()

    const hiddenInput = Array.from(
      (phoneInput.form || document).querySelectorAll(
        "input[name*='phone' i][type='hidden'],input[name='phoneNumber']"
      )
    ).find((element) => {
      return element !== phoneInput
    }) as HTMLInputElement | undefined
    if (hiddenInput) {
      setInputValue(hiddenInput, `+${digits}`)
    }

    await waitForDelay(300)
    const button = findContinueButton()
    if (!button) {
      return {
        ok: false,
        message: "未找到手机号页继续按钮"
      }
    }

    clickButton(button)

    return {
      ok: true,
      message: `已填写手机号 +${digits}，已点击继续`
    }
  })()
}
