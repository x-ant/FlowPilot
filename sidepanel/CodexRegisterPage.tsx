import { Button, Checkbox, Input, Select, Space, Tag } from "antd"
import { useEffect, useMemo, useState } from "react"

import {
  clickRegisterAndSubmitEmail,
  clickRegisterReadyContinue,
  completeRegisterPhoneVerification,
  fetchAndSubmitRegisterVerificationCode,
  openChatGptRegisterEntry,
  refreshRegisterOAuthAndLogin,
  submitRegisterProfile
} from "../background/codex-register"
import {
  fetchHeroSmsCountries,
  fetchHeroSmsOperators,
  type HeroSmsCountryOption,
  type HeroSmsPhoneVerificationOptions
} from "../background/register-phone-verification"
import { AccountWorkspace } from "./AccountWorkspace"
import { DebugTabControl } from "./DebugTabControl"
import {
  normalizeEmail,
  REGISTER_STORAGE_KEYS,
  type ManagedAccountProgress,
  type ManagedAccountStatus,
  type PageProps
} from "./shared"
import { useAccountPageState } from "./useAccountPageState"

const REGISTER_STEP_COUNT = 7
const REGISTER_HERO_SMS_STORAGE_KEY = "codex-register:hero-sms-settings"
const REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY =
  "codex-register:hero-sms-countries-cache"
const REGISTER_HERO_SMS_OPERATORS_CACHE_KEY =
  "codex-register:hero-sms-operators-cache"
const HERO_SMS_COUNTRIES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const HERO_SMS_OPERATORS_CACHE_TTL_MS = 60 * 60 * 1000

const HERO_SMS_DEFAULT_OPERATOR_OPTION = {
  label: "不限（any）",
  value: "any"
}

type HeroSmsSettings = {
  apiKey: string
  countryId: string
  operator: string
  mockEnabled: boolean
  maxPrice: string
  fixedPrice: string
}

type HeroSmsCountriesCache = {
  updatedAt: number
  options: HeroSmsCountryOption[]
}

type HeroSmsOperatorsCache = {
  updatedAtByCountry: Record<string, number>
  operatorsByCountry: Record<string, string[]>
}

const DEFAULT_HERO_SMS_SETTINGS: HeroSmsSettings = {
  apiKey: "",
  countryId: "",
  operator: "any",
  mockEnabled: false,
  maxPrice: "",
  fixedPrice: ""
}

const readLocalStorage = (keys: string[]) => {
  return new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(keys, resolve)
  })
}

const writeLocalStorage = (items: Record<string, unknown>) => {
  return new Promise<void>((resolve) => {
    chrome.storage.local.set(items, () => {
      resolve()
    })
  })
}

const isFreshCache = (updatedAt: unknown, ttlMs: number) => {
  const timestamp = Number(updatedAt)
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlMs
}

const normalizeHeroSmsCountryIdValue = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return ""
  }

  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 999
    ? String(parsed)
    : ""
}

const buildHeroSmsOperatorOptions = (
  operators: string[] = [],
  selectedOperator = "any"
) => {
  const normalizedSelected = String(selectedOperator || "any")
    .trim()
    .toLowerCase()
  const options = [HERO_SMS_DEFAULT_OPERATOR_OPTION]
  const seen = new Set(["any"])

  operators.forEach((operator) => {
    const normalized = String(operator || "")
      .trim()
      .toLowerCase()
    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    options.push({
      label: normalized,
      value: normalized
    })
  })

  if (normalizedSelected && !seen.has(normalizedSelected)) {
    options.push({
      label: normalizedSelected,
      value: normalizedSelected
    })
  }

  return options
}

type RegisterStepResult = {
  ok: boolean
  message: string
  targetTab?: {
    id?: number
    url?: string
  }
}

type RegisterDebugStepOptions = {
  step: number
  runningStatus: string
  runningMessage: string
  runningProgress: ManagedAccountProgress
  action: (tabId: number) => Promise<RegisterStepResult>
  failureStatus: string
  successStatus: string
  successProgress: ManagedAccountProgress
  successAccountStatus: ManagedAccountStatus
  exceptionStatus: string
  exceptionMessage: string
  beforeRun?: () => void
}

export function CodexRegisterPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: REGISTER_STORAGE_KEYS,
    log,
    setStatus
  })
  const {
    accounts,
    cpaManagementKey,
    cpaUrl,
    patchAccountState,
    setRunningEmail
  } = accountPage
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [debugEmail, setDebugEmail] = useState("")
  const [debugRegisterTabId, setDebugRegisterTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [heroSmsSettings, setHeroSmsSettings] = useState<HeroSmsSettings>(
    DEFAULT_HERO_SMS_SETTINGS
  )
  const [heroSmsCountryOptions, setHeroSmsCountryOptions] = useState<
    HeroSmsCountryOption[]
  >([])
  const [heroSmsOperatorOptions, setHeroSmsOperatorOptions] = useState<
    (typeof HERO_SMS_DEFAULT_OPERATOR_OPTION)[]
  >([])
  const [isHeroSmsCountriesLoading, setIsHeroSmsCountriesLoading] =
    useState(false)
  const [isHeroSmsOperatorsLoading, setIsHeroSmsOperatorsLoading] =
    useState(false)

  const selectedDebugAccount = useMemo(() => {
    const normalizedDebugEmail = normalizeEmail(debugEmail)
    return (
      accounts.find((account) => {
        return normalizeEmail(account.email) === normalizedDebugEmail
      }) || null
    )
  }, [accounts, debugEmail])

  useEffect(() => {
    if (accounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugEmail = normalizeEmail(debugEmail)
    const hasCurrentDebugAccount = accounts.some((account) => {
      return normalizeEmail(account.email) === currentDebugEmail
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(accounts[0].email)
    }
  }, [accounts, debugEmail])

  useEffect(() => {
    onBusyChange?.(isDebugRunning)
    return () => {
      onBusyChange?.(false)
    }
  }, [isDebugRunning, onBusyChange])

  useEffect(() => {
    void chrome.storage.local.get([REGISTER_HERO_SMS_STORAGE_KEY], (result) => {
      const stored = result?.[REGISTER_HERO_SMS_STORAGE_KEY] as
        | Partial<HeroSmsSettings>
        | undefined
      setHeroSmsSettings({
        apiKey: String(stored?.apiKey || ""),
        countryId: normalizeHeroSmsCountryIdValue(stored?.countryId),
        operator: String(
          stored?.operator || DEFAULT_HERO_SMS_SETTINGS.operator
        ),
        mockEnabled: Boolean(stored?.mockEnabled),
        maxPrice: String(stored?.maxPrice || ""),
        fixedPrice: String(stored?.fixedPrice || "")
      })
    })
  }, [])

  const patchHeroSmsSettings = (patch: Partial<HeroSmsSettings>) => {
    setHeroSmsSettings((current) => {
      const next = {
        ...current,
        ...patch
      }
      void chrome.storage.local.set({
        [REGISTER_HERO_SMS_STORAGE_KEY]: next
      })
      return next
    })
  }

  /**
   * 加载 HeroSMS 国家列表。
   *
   * 国家列表变化很低，先用 7 天缓存；缓存过期才请求 getCountries。
   */
  const loadHeroSmsCountryOptions = async () => {
    if (!heroSmsSettings.mockEnabled && !heroSmsSettings.apiKey.trim()) {
      setHeroSmsCountryOptions([])
      return
    }

    setIsHeroSmsCountriesLoading(true)
    try {
      if (heroSmsSettings.mockEnabled) {
        const options = await fetchHeroSmsCountries("", true)
        setHeroSmsCountryOptions(options)
        return
      }

      const cached = (
        await readLocalStorage([REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY])
      )[REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY] as
        | HeroSmsCountriesCache
        | undefined

      if (
        cached?.options?.length &&
        isFreshCache(cached.updatedAt, HERO_SMS_COUNTRIES_CACHE_TTL_MS)
      ) {
        setHeroSmsCountryOptions(cached.options)
        return
      }

      const options = await fetchHeroSmsCountries(
        heroSmsSettings.apiKey,
        heroSmsSettings.mockEnabled
      )
      setHeroSmsCountryOptions(options)
      await writeLocalStorage({
        [REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY]: {
          updatedAt: Date.now(),
          options
        } satisfies HeroSmsCountriesCache
      })
    } catch (error) {
      setHeroSmsCountryOptions([])
      log.warn(
        `[注册调试] HeroSMS 国家列表加载失败：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
    } finally {
      setIsHeroSmsCountriesLoading(false)
    }
  }

  /**
   * 加载当前国家可选运营商。
   *
   * HeroSMS getOperators 返回按国家分组的运营商；这里按国家做 1 小时缓存。
   *
   * @param countryId 当前选择的 HeroSMS 国家 ID。
   */
  const loadHeroSmsOperatorOptions = async (countryId: string) => {
    const normalizedCountryId = normalizeHeroSmsCountryIdValue(countryId)
    if (
      normalizedCountryId === "" ||
      (!heroSmsSettings.mockEnabled && !heroSmsSettings.apiKey.trim())
    ) {
      setHeroSmsOperatorOptions([])
      return
    }

    setIsHeroSmsOperatorsLoading(true)
    try {
      if (heroSmsSettings.mockEnabled) {
        const operatorsByCountry = await fetchHeroSmsOperators(
          normalizedCountryId,
          "",
          true
        )
        const operators = operatorsByCountry[normalizedCountryId] || []
        setHeroSmsOperatorOptions(
          buildHeroSmsOperatorOptions(operators, heroSmsSettings.operator)
        )
        return
      }

      const cached = (
        await readLocalStorage([REGISTER_HERO_SMS_OPERATORS_CACHE_KEY])
      )[REGISTER_HERO_SMS_OPERATORS_CACHE_KEY] as
        | HeroSmsOperatorsCache
        | undefined
      const cachedOperators =
        cached?.operatorsByCountry?.[normalizedCountryId] || []
      const cachedAt = cached?.updatedAtByCountry?.[normalizedCountryId]

      if (isFreshCache(cachedAt, HERO_SMS_OPERATORS_CACHE_TTL_MS)) {
        setHeroSmsOperatorOptions(
          buildHeroSmsOperatorOptions(cachedOperators, heroSmsSettings.operator)
        )
        return
      }

      const operatorsByCountry = await fetchHeroSmsOperators(
        normalizedCountryId,
        heroSmsSettings.apiKey,
        heroSmsSettings.mockEnabled
      )
      const now = Date.now()
      const updatedAtByCountry = {
        ...(cached?.updatedAtByCountry || {})
      }
      Object.keys(operatorsByCountry).forEach((itemCountryId) => {
        updatedAtByCountry[itemCountryId] = now
      })
      updatedAtByCountry[normalizedCountryId] = now
      const nextCache: HeroSmsOperatorsCache = {
        updatedAtByCountry,
        operatorsByCountry: {
          ...(cached?.operatorsByCountry || {}),
          ...operatorsByCountry,
          [normalizedCountryId]: operatorsByCountry[normalizedCountryId] || []
        }
      }
      const operators = nextCache.operatorsByCountry[normalizedCountryId] || []
      setHeroSmsOperatorOptions(
        buildHeroSmsOperatorOptions(operators, heroSmsSettings.operator)
      )
      await writeLocalStorage({
        [REGISTER_HERO_SMS_OPERATORS_CACHE_KEY]: nextCache
      })
    } catch (error) {
      setHeroSmsOperatorOptions([])
      log.warn(
        `[注册调试] HeroSMS 运营商列表加载失败：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
    } finally {
      setIsHeroSmsOperatorsLoading(false)
    }
  }

  useEffect(() => {
    void loadHeroSmsCountryOptions()
  }, [])

  useEffect(() => {
    if (!heroSmsSettings.mockEnabled && !heroSmsSettings.apiKey.trim()) {
      setHeroSmsCountryOptions([])
      setHeroSmsOperatorOptions([])
      return
    }

    const timer = window.setTimeout(() => {
      void loadHeroSmsCountryOptions()
      void loadHeroSmsOperatorOptions(heroSmsSettings.countryId)
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [heroSmsSettings.apiKey, heroSmsSettings.mockEnabled])

  useEffect(() => {
    void loadHeroSmsOperatorOptions(heroSmsSettings.countryId)
  }, [heroSmsSettings.countryId, heroSmsSettings.operator])

  /**
   * 组装 Step 7 使用的 HeroSMS 参数，并在发起扣费请求前做第一层价格校验。
   *
   * @return 参数合法时返回 HeroSMS 配置；缺少 API Key、价格上限或固定档位非法时返回 null。
   */
  const buildHeroSmsOptions = (): HeroSmsPhoneVerificationOptions | null => {
    const apiKey = String(heroSmsSettings.apiKey || "").trim()
    if (!heroSmsSettings.mockEnabled && !apiKey) {
      setStatus("请先填写 HeroSMS 接码 API")
      log.warn("[注册调试] Step 7 缺少 HeroSMS 接码 API")
      return null
    }

    const maxPrice = String(heroSmsSettings.maxPrice || "").trim()
    if (
      !maxPrice ||
      !Number.isFinite(Number(maxPrice)) ||
      Number(maxPrice) <= 0
    ) {
      setStatus("请先填写有效的 HeroSMS 价格上限")
      log.warn("[注册调试] Step 7 缺少有效 HeroSMS 价格上限")
      return null
    }

    const country = heroSmsCountryOptions.find((item) => {
      return item.value === heroSmsSettings.countryId
    })
    const countryId = normalizeHeroSmsCountryIdValue(country?.value)
    if (countryId === "") {
      setStatus("请先选择有效的 HeroSMS 国家")
      log.warn("[注册调试] Step 7 HeroSMS 国家选项无效")
      return null
    }
    const fixedPrice = String(heroSmsSettings.fixedPrice || "").trim()

    if (
      fixedPrice &&
      (!Number.isFinite(Number(fixedPrice)) || Number(fixedPrice) <= 0)
    ) {
      setStatus("请填写有效的 HeroSMS 固定价格档位")
      log.warn("[注册调试] Step 7 HeroSMS 固定价格档位无效")
      return null
    }

    if (fixedPrice && Number(fixedPrice) > Number(maxPrice)) {
      setStatus("HeroSMS 固定价格档位不能高于价格上限")
      log.warn("[注册调试] Step 7 HeroSMS 固定价格档位高于价格上限")
      return null
    }

    return {
      apiKey: heroSmsSettings.mockEnabled ? apiKey || "mock-api-key" : apiKey,
      countryId: Number(countryId),
      countryLabel: country?.countryLabel || `Country #${countryId}`,
      operator: String(heroSmsSettings.operator || "any").trim() || "any",
      mockEnabled: heroSmsSettings.mockEnabled,
      maxPrice,
      fixedPrice
    }
  }

  const handleOpenRegisterEntry = async () => {
    if (isDebugRunning) {
      return
    }

    setIsDebugRunning(true)
    setStatus("正在打开 GPT 页面")
    log.info("[注册调试] Step 1 开始打开 GPT 页面")

    try {
      const result = await openChatGptRegisterEntry()
      if (!result.ok) {
        setStatus("打开 GPT 页面失败")
        log.warn(`[注册调试] ${result.message}`)
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || ""))
      setDebugProgress(1)
      setStatus("已打开 GPT 页面")
      log.info(
        `[注册调试] Step 1 ${result.message}；tab=${result.targetTab?.id || "unknown"}；url=${
          result.targetTab?.url || "unknown"
        }`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "打开 GPT 页面异常"
      setStatus("打开 GPT 页面异常")
      log.warn(`[注册调试] ${message}`)
    } finally {
      setIsDebugRunning(false)
    }
  }

  const handleUseActiveTabAsDebugRegisterTab = async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (!activeTab?.id) {
      setStatus("未找到当前激活标签页")
      log.warn("未找到当前激活标签页，无法设置注册 tab")
      return
    }

    setDebugRegisterTabId(String(activeTab.id))
    setStatus(`已使用当前标签页作为注册 tab：${activeTab.id}`)
    log.debug(
      `注册调试 tab 已设置为 ${activeTab.id}（${activeTab.url || "unknown"}）`
    )
  }

  const handleClearDebugState = () => {
    setDebugRegisterTabId("")
    setDebugProgress(0)
    setDebugVerificationRequestedAt(0)
    setStatus("注册调试状态已清空")
  }

  const runRegisterDebugStep = async (options: RegisterDebugStepOptions) => {
    if (isDebugRunning || !selectedDebugAccount) {
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    if (!Number.isFinite(parsedTabId) || parsedTabId <= 0) {
      setStatus("请先执行 Step 1 打开 GPT 页面")
      log.warn(
        `[注册调试] Step ${options.step} 缺少注册 tabId，请先执行 Step 1`
      )
      return
    }

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus(options.runningStatus)
    log.info(
      `[注册调试][${selectedDebugAccount.email}] Step ${options.step} 开始`
    )
    options.beforeRun?.()
    patchAccountState(selectedDebugAccount.email, {
      progress: options.runningProgress,
      status: "running",
      lastMessage: options.runningMessage
    })

    try {
      const result = await options.action(parsedTabId)

      if (!result.ok) {
        setStatus(options.failureStatus)
        log.warn(`[注册调试][${selectedDebugAccount.email}] ${result.message}`)
        patchAccountState(selectedDebugAccount.email, {
          status: "failed",
          lastMessage: result.message
        })
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || parsedTabId))
      setDebugProgress(options.successProgress)
      setStatus(options.successStatus)
      log.info(
        `[注册调试][${selectedDebugAccount.email}] Step ${options.step} ${result.message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(selectedDebugAccount.email, {
        progress: options.successProgress,
        status: options.successAccountStatus,
        lastMessage: result.message
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : options.exceptionMessage
      setStatus(options.exceptionStatus)
      log.warn(`[注册调试][${selectedDebugAccount.email}] ${message}`)
      patchAccountState(selectedDebugAccount.email, {
        status: "failed",
        lastMessage: message
      })
    } finally {
      setIsDebugRunning(false)
      setRunningEmail("")
    }
  }

  const handleSubmitRegisterEmail = async () => {
    const verificationRequestedAt = Date.now()
    await runRegisterDebugStep({
      step: 2,
      runningStatus: `正在提交注册邮箱 ${selectedDebugAccount?.email || ""}`,
      runningMessage: "正在点击注册并提交邮箱",
      runningProgress: 1,
      beforeRun: () => {
        setDebugVerificationRequestedAt(verificationRequestedAt)
      },
      action: (tabId) => {
        return clickRegisterAndSubmitEmail(
          selectedDebugAccount?.email || "",
          tabId
        )
      },
      failureStatus: "提交注册邮箱失败",
      successStatus: "已提交注册邮箱",
      successProgress: 2,
      successAccountStatus: "running",
      exceptionStatus: "提交注册邮箱异常",
      exceptionMessage: "提交注册邮箱异常"
    })
  }

  const handleSubmitRegisterVerificationCode = async () => {
    await runRegisterDebugStep({
      step: 3,
      runningStatus: `正在读取并提交验证码 ${selectedDebugAccount?.email || ""}`,
      runningMessage: "正在读取并提交验证码",
      runningProgress: 2,
      action: (tabId) => {
        return fetchAndSubmitRegisterVerificationCode(
          tabId,
          selectedDebugAccount?.email || "",
          selectedDebugAccount?.password || "",
          debugVerificationRequestedAt
        )
      },
      failureStatus: "提交注册验证码失败",
      successStatus: "已提交注册验证码",
      successProgress: 3,
      successAccountStatus: "running",
      exceptionStatus: "提交注册验证码异常",
      exceptionMessage: "提交注册验证码异常"
    })
  }

  const handleSubmitRegisterProfile = async () => {
    await runRegisterDebugStep({
      step: 4,
      runningStatus: "正在完成账户创建",
      runningMessage: "正在填写名称和年龄/生日",
      runningProgress: 3,
      action: submitRegisterProfile,
      failureStatus: "完成账户创建失败",
      successStatus: "已完成账户创建",
      successProgress: 4,
      successAccountStatus: "running",
      exceptionStatus: "完成账户创建异常",
      exceptionMessage: "完成账户创建异常"
    })
  }

  const handleClickRegisterReadyContinue = async () => {
    await runRegisterDebugStep({
      step: 5,
      runningStatus: "正在点击继续",
      runningMessage: "正在点击继续",
      runningProgress: 4,
      action: clickRegisterReadyContinue,
      failureStatus: "点击继续失败",
      successStatus: "已点击继续",
      successProgress: 5,
      successAccountStatus: "running",
      exceptionStatus: "点击继续异常",
      exceptionMessage: "点击继续异常"
    })
  }

  const handleRefreshRegisterOAuthAndLogin = async () => {
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const normalizedCpaManagementKey = String(cpaManagementKey || "").trim()

    if (isDebugRunning) {
      return
    }

    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("[注册调试] Step 6 缺少 CPA 地址")
      return
    }

    if (!normalizedCpaManagementKey) {
      setStatus("请先填写 CPA 管理密钥")
      log.warn("[注册调试] Step 6 缺少 CPA 管理密钥")
      return
    }

    setIsDebugRunning(true)
    setStatus("正在刷新 OAuth 并登录")
    log.info("[注册调试] Step 6 开始刷新 OAuth 并登录")

    try {
      const result = await refreshRegisterOAuthAndLogin(
        normalizedCpaUrl,
        normalizedCpaManagementKey
      )

      if (!result.ok) {
        setStatus("刷新 OAuth 并登录失败")
        log.warn(`[注册调试] Step 6 ${result.message}`)
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || ""))
      setDebugProgress(6)
      setStatus("已刷新 OAuth 并进入登录授权流程")
      log.info(
        `[注册调试] Step 6 ${result.message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "刷新 OAuth 并登录异常"
      setStatus("刷新 OAuth 并登录异常")
      log.warn(`[注册调试] Step 6 ${message}`)
    } finally {
      setIsDebugRunning(false)
    }
  }

  const handleCompleteRegisterPhoneVerification = async () => {
    const heroSmsOptions = buildHeroSmsOptions()
    if (!heroSmsOptions) {
      return
    }

    await runRegisterDebugStep({
      step: 7,
      runningStatus: "正在执行手机号验证",
      runningMessage: "正在获取手机号并等待短信验证码",
      runningProgress: 6,
      action: (tabId) => {
        return completeRegisterPhoneVerification(tabId, heroSmsOptions)
      },
      failureStatus: "手机号验证失败",
      successStatus: "已完成手机号验证",
      successProgress: REGISTER_STEP_COUNT as ManagedAccountProgress,
      successAccountStatus: "done",
      exceptionStatus: "手机号验证异常",
      exceptionMessage: "手机号验证异常"
    })
  }

  return (
    <AccountWorkspace
      {...accountPage}
      disabled={isDebugRunning}
      stepCount={REGISTER_STEP_COUNT}
      onCpaUrlChange={accountPage.handleCpaUrlChange}
      onCpaManagementKeyChange={accountPage.handleCpaManagementKeyChange}
      onSubmitAccount={accountPage.handleSubmitAccount}
      onCancelEdit={accountPage.handleCancelEdit}
      onEditAccount={accountPage.handleEditAccount}
      onRemoveAccount={accountPage.handleRemoveAccount}
      onToggleAccountSelected={accountPage.handleToggleAccountSelected}
      onToggleAllAccountsSelected={accountPage.handleToggleAllAccountsSelected}
      onMoveSelectedAccount={accountPage.handleMoveSelectedAccount}
      onMarkSelectedAccountsDone={accountPage.handleMarkSelectedAccountsDone}
      debugTitleExtra={
        <Tag color="default">{`当前进度 ${debugProgress}/${REGISTER_STEP_COUNT}`}</Tag>
      }
      debugContent={
        <div className="debug-panel">
          <DebugTabControl
            disabled={isDebugRunning}
            label="注册 tab"
            leadingContent={
              <div className="debug-field">
                <span className="debug-label">账号</span>
                <Select
                  value={debugEmail || undefined}
                  placeholder="选择账号"
                  options={accounts.map((account) => {
                    return {
                      label: account.email,
                      value: account.email
                    }
                  })}
                  onChange={(value) => {
                    setDebugEmail(value)
                    setDebugProgress(0)
                    setDebugVerificationRequestedAt(0)
                  }}
                  disabled={isDebugRunning || accounts.length === 0}
                />
              </div>
            }
            value={debugRegisterTabId}
            onChange={setDebugRegisterTabId}
            onUseActiveTab={handleUseActiveTabAsDebugRegisterTab}
            onClear={handleClearDebugState}
          />

          <div className="debug-grid debug-grid--two">
            <div className="debug-field">
              <span className="debug-label">国家选项</span>
              <Select
                value={
                  heroSmsCountryOptions.length
                    ? heroSmsSettings.countryId || undefined
                    : undefined
                }
                placeholder="填写 API 后加载"
                showSearch={{
                  optionFilterProp: "label",
                  filterOption: (input, option) => {
                    const keyword = input.trim().toLowerCase()
                    const searchText = String(
                      option?.searchText || option?.label || option?.value || ""
                    ).toLowerCase()
                    return searchText.includes(keyword)
                  }
                }}
                loading={isHeroSmsCountriesLoading}
                options={heroSmsCountryOptions}
                onChange={(value) => {
                  patchHeroSmsSettings({ countryId: value, operator: "any" })
                }}
                disabled={
                  isDebugRunning ||
                  (!heroSmsSettings.mockEnabled &&
                    !heroSmsSettings.apiKey.trim()) ||
                  heroSmsCountryOptions.length === 0
                }
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">运营商选项</span>
              <Select
                value={
                  heroSmsOperatorOptions.length
                    ? heroSmsSettings.operator || undefined
                    : undefined
                }
                placeholder="选择国家后加载"
                showSearch={{
                  optionFilterProp: "label"
                }}
                loading={isHeroSmsOperatorsLoading}
                options={heroSmsOperatorOptions}
                onChange={(value) => {
                  patchHeroSmsSettings({ operator: value })
                }}
                disabled={
                  isDebugRunning ||
                  (!heroSmsSettings.mockEnabled &&
                    !heroSmsSettings.apiKey.trim()) ||
                  heroSmsSettings.countryId === "" ||
                  heroSmsOperatorOptions.length === 0
                }
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">HeroSMS Mock</span>
              <Checkbox
                checked={heroSmsSettings.mockEnabled}
                onChange={(event) => {
                  patchHeroSmsSettings({
                    mockEnabled: event.target.checked,
                    operator: "any"
                  })
                }}
                disabled={isDebugRunning}>
                不请求 HeroSMS
              </Checkbox>
            </div>
            <div className="debug-field">
              <span className="debug-label">接码 API</span>
              <Input.Password
                value={heroSmsSettings.apiKey}
                placeholder="HeroSMS API key"
                allowClear
                onChange={(event) => {
                  patchHeroSmsSettings({ apiKey: event.target.value })
                }}
                disabled={isDebugRunning || heroSmsSettings.mockEnabled}
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">价格上限</span>
              <Input
                value={heroSmsSettings.maxPrice}
                placeholder="必填，例如 0.12"
                allowClear
                onChange={(event) => {
                  patchHeroSmsSettings({ maxPrice: event.target.value })
                }}
                disabled={isDebugRunning}
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">固定价格档位</span>
              <Input
                value={heroSmsSettings.fixedPrice}
                placeholder="可选，例如 0.08"
                allowClear
                onChange={(event) => {
                  patchHeroSmsSettings({
                    fixedPrice: event.target.value
                  })
                }}
                disabled={isDebugRunning}
              />
            </div>
          </div>

          <Space size={8} wrap>
            <Button
              type="primary"
              onClick={() => {
                void handleOpenRegisterEntry()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning}>
              1 打开 GPT 页面
            </Button>
            <Button
              onClick={() => {
                void handleSubmitRegisterEmail()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning || !selectedDebugAccount}>
              2 点击注册并提交邮箱
            </Button>
            <Button
              onClick={() => {
                void handleSubmitRegisterVerificationCode()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning || !selectedDebugAccount}>
              3 提交验证码
            </Button>
            <Button
              onClick={() => {
                void handleSubmitRegisterProfile()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning || !selectedDebugAccount}>
              4 完成账户创建
            </Button>
            <Button
              onClick={() => {
                void handleClickRegisterReadyContinue()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning || !selectedDebugAccount}>
              5 点击继续
            </Button>
            <Button
              onClick={() => {
                void handleRefreshRegisterOAuthAndLogin()
              }}
              loading={isDebugRunning}
              disabled={
                isDebugRunning || !cpaUrl.trim() || !cpaManagementKey.trim()
              }>
              6 刷新 OAuth 并登录
            </Button>
            <Button
              onClick={() => {
                void handleCompleteRegisterPhoneVerification()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning || !selectedDebugAccount}>
              7 手机号验证
            </Button>
          </Space>
        </div>
      }
    />
  )
}
