import { useEffect, useState } from "react"

import {
  fetchHeroSmsCountries,
  fetchHeroSmsOperators,
  type HeroSmsCountryOption,
  type HeroSmsPhoneVerificationOptions
} from "../../background/register/phone-verification"
import type { UiLogger } from "../../shared/logging"

const REGISTER_HERO_SMS_STORAGE_KEY = "flowpilot:register:hero-sms-settings"
const REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY =
  "flowpilot:register:hero-sms-countries-cache"
const REGISTER_HERO_SMS_OPERATORS_CACHE_KEY =
  "flowpilot:register:hero-sms-operators-cache"
const HERO_SMS_COUNTRIES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const HERO_SMS_OPERATORS_CACHE_TTL_MS = 60 * 60 * 1000

const HERO_SMS_DEFAULT_OPERATOR_OPTION = {
  label: "不限（any）",
  value: "any"
} satisfies HeroSmsOperatorOption

export type HeroSmsSettings = {
  apiKey: string
  countryId: string
  operator: string
  mockEnabled: boolean
  maxPrice: string
  fixedPrice: string
}

export type HeroSmsOperatorOption = {
  label: string
  value: string
}

type HeroSmsCountriesCache = {
  updatedAt: number
  options: HeroSmsCountryOption[]
}

type HeroSmsOperatorsCache = {
  updatedAtByCountry: Record<string, number>
  operatorsByCountry: Record<string, string[]>
}

type UseHeroSmsConfigOptions = {
  log: UiLogger
  setStatus: (status: string) => void
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

export const useHeroSmsConfig = ({
  log,
  setStatus
}: UseHeroSmsConfigOptions) => {
  const [settings, setSettings] = useState<HeroSmsSettings>(
    DEFAULT_HERO_SMS_SETTINGS
  )
  const [countryOptions, setCountryOptions] = useState<HeroSmsCountryOption[]>(
    []
  )
  const [operatorOptions, setOperatorOptions] = useState<
    HeroSmsOperatorOption[]
  >([])
  const [isCountriesLoading, setIsCountriesLoading] = useState(false)
  const [isOperatorsLoading, setIsOperatorsLoading] = useState(false)

  useEffect(() => {
    void chrome.storage.local.get([REGISTER_HERO_SMS_STORAGE_KEY], (result) => {
      const stored = result?.[REGISTER_HERO_SMS_STORAGE_KEY] as
        | Partial<HeroSmsSettings>
        | undefined
      setSettings({
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

  const patchSettings = (patch: Partial<HeroSmsSettings>) => {
    setSettings((current) => {
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
  const loadCountryOptions = async () => {
    if (!settings.mockEnabled && !settings.apiKey.trim()) {
      setCountryOptions([])
      return
    }

    setIsCountriesLoading(true)
    try {
      if (settings.mockEnabled) {
        const options = await fetchHeroSmsCountries("", true)
        setCountryOptions(options)
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
        setCountryOptions(cached.options)
        return
      }

      const options = await fetchHeroSmsCountries(
        settings.apiKey,
        settings.mockEnabled
      )
      setCountryOptions(options)
      await writeLocalStorage({
        [REGISTER_HERO_SMS_COUNTRIES_CACHE_KEY]: {
          updatedAt: Date.now(),
          options
        } satisfies HeroSmsCountriesCache
      })
    } catch (error) {
      setCountryOptions([])
      log.warn(
        `[注册调试] HeroSMS 国家列表加载失败：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
    } finally {
      setIsCountriesLoading(false)
    }
  }

  /**
   * 加载当前国家可选运营商。
   *
   * HeroSMS getOperators 返回按国家分组的运营商；这里按国家做 1 小时缓存。
   *
   * @param countryId 当前选择的 HeroSMS 国家 ID。
   */
  const loadOperatorOptions = async (countryId: string) => {
    const normalizedCountryId = normalizeHeroSmsCountryIdValue(countryId)
    if (
      normalizedCountryId === "" ||
      (!settings.mockEnabled && !settings.apiKey.trim())
    ) {
      setOperatorOptions([])
      return
    }

    setIsOperatorsLoading(true)
    try {
      if (settings.mockEnabled) {
        const operatorsByCountry = await fetchHeroSmsOperators(
          normalizedCountryId,
          "",
          true
        )
        const operators = operatorsByCountry[normalizedCountryId] || []
        setOperatorOptions(
          buildHeroSmsOperatorOptions(operators, settings.operator)
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
        setOperatorOptions(
          buildHeroSmsOperatorOptions(cachedOperators, settings.operator)
        )
        return
      }

      const operatorsByCountry = await fetchHeroSmsOperators(
        normalizedCountryId,
        settings.apiKey,
        settings.mockEnabled
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
      setOperatorOptions(
        buildHeroSmsOperatorOptions(operators, settings.operator)
      )
      await writeLocalStorage({
        [REGISTER_HERO_SMS_OPERATORS_CACHE_KEY]: nextCache
      })
    } catch (error) {
      setOperatorOptions([])
      log.warn(
        `[注册调试] HeroSMS 运营商列表加载失败：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
    } finally {
      setIsOperatorsLoading(false)
    }
  }

  useEffect(() => {
    void loadCountryOptions()
  }, [])

  useEffect(() => {
    if (!settings.mockEnabled && !settings.apiKey.trim()) {
      setCountryOptions([])
      setOperatorOptions([])
      return
    }

    const timer = window.setTimeout(() => {
      void loadCountryOptions()
      void loadOperatorOptions(settings.countryId)
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [settings.apiKey, settings.mockEnabled])

  useEffect(() => {
    void loadOperatorOptions(settings.countryId)
  }, [settings.countryId, settings.operator])

  /**
   * 组装 Step 6 使用的 HeroSMS 参数，并在发起扣费请求前做第一层价格校验。
   *
   * @return 参数合法时返回 HeroSMS 配置；缺少 API Key、价格上限或固定档位非法时返回 null。
   */
  const buildOptions = (
    logPrefix = "注册调试",
    onPhoneVerificationPhase?: HeroSmsPhoneVerificationOptions["onPhoneVerificationPhase"]
  ): HeroSmsPhoneVerificationOptions | null => {
    const apiKey = String(settings.apiKey || "").trim()
    if (!settings.mockEnabled && !apiKey) {
      setStatus("请先填写 HeroSMS 接码 API")
      log.warn(`[${logPrefix}] Step 6 缺少 HeroSMS 接码 API`)
      return null
    }

    const maxPrice = String(settings.maxPrice || "").trim()
    if (
      !maxPrice ||
      !Number.isFinite(Number(maxPrice)) ||
      Number(maxPrice) <= 0
    ) {
      setStatus("请先填写有效的 HeroSMS 价格上限")
      log.warn(`[${logPrefix}] Step 6 缺少有效 HeroSMS 价格上限`)
      return null
    }

    const country = countryOptions.find((item) => {
      return item.value === settings.countryId
    })
    const countryId = normalizeHeroSmsCountryIdValue(country?.value)
    if (countryId === "") {
      setStatus("请先选择有效的 HeroSMS 国家")
      log.warn(`[${logPrefix}] Step 6 HeroSMS 国家选项无效`)
      return null
    }
    const fixedPrice = String(settings.fixedPrice || "").trim()

    if (
      fixedPrice &&
      (!Number.isFinite(Number(fixedPrice)) || Number(fixedPrice) <= 0)
    ) {
      setStatus("请填写有效的 HeroSMS 固定价格档位")
      log.warn(`[${logPrefix}] Step 6 HeroSMS 固定价格档位无效`)
      return null
    }

    if (fixedPrice && Number(fixedPrice) > Number(maxPrice)) {
      setStatus("HeroSMS 固定价格档位不能高于价格上限")
      log.warn(`[${logPrefix}] Step 6 HeroSMS 固定价格档位高于价格上限`)
      return null
    }

    return {
      apiKey: settings.mockEnabled ? apiKey || "mock-api-key" : apiKey,
      countryId: Number(countryId),
      countryLabel: country?.countryLabel || `Country #${countryId}`,
      operator: String(settings.operator || "any").trim() || "any",
      mockEnabled: settings.mockEnabled,
      maxPrice,
      fixedPrice,
      onLog: (level, message, options) => {
        log[level](`[${logPrefix}] Step 6 ${message}`, options)
      },
      onPhoneVerificationPhase
    }
  }

  const hasRequiredConfig = Boolean(
    (settings.mockEnabled || settings.apiKey.trim()) &&
      settings.maxPrice.trim() &&
      settings.countryId
  )

  return {
    settings,
    countryOptions,
    operatorOptions,
    isCountriesLoading,
    isOperatorsLoading,
    patchSettings,
    buildOptions,
    hasRequiredConfig
  }
}

export type HeroSmsConfigState = ReturnType<typeof useHeroSmsConfig>
