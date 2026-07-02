import { Button, Input, Select, Space, Tag } from "antd"
import { useEffect, useMemo, useState } from "react"

import {
  clickRegisterAndSubmitEmail,
  clickRegisterReadyContinue,
  completeRegisterPhoneVerification,
  fetchAndSubmitRegisterVerificationCode,
  openChatGptRegisterEntry,
  refreshRegisterOAuthAndLogin,
  submitRegisterProfile,
  type HeroSmsPhoneVerificationOptions
} from "../background/codex-register"
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

const HERO_SMS_COUNTRY_OPTIONS = [
  { label: "印度尼西亚 (+62)", value: "6", countryLabel: "Indonesia" },
  { label: "泰国 (+66)", value: "52", countryLabel: "Thailand" },
  { label: "越南 (+84)", value: "10", countryLabel: "Vietnam" },
  { label: "英国 (+44)", value: "16", countryLabel: "United Kingdom" },
  { label: "美国 (+1)", value: "187", countryLabel: "USA" },
  { label: "日本 (+81)", value: "151", countryLabel: "Japan" }
]

const HERO_SMS_OPERATOR_OPTIONS = [
  { label: "any", value: "any" },
  { label: "telkomsel", value: "telkomsel" },
  { label: "indosat", value: "indosat" },
  { label: "xl", value: "xl" },
  { label: "axis", value: "axis" },
  { label: "three", value: "three" },
  { label: "smartfren", value: "smartfren" }
]

type HeroSmsSettings = {
  apiKey: string
  countryId: string
  operator: string
  maxPrice: string
}

const DEFAULT_HERO_SMS_SETTINGS: HeroSmsSettings = {
  apiKey: "",
  countryId: "6",
  operator: "any",
  maxPrice: ""
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
        countryId:
          HERO_SMS_COUNTRY_OPTIONS.find((item) => {
            return item.value === String(stored?.countryId || "")
          })?.value || DEFAULT_HERO_SMS_SETTINGS.countryId,
        operator: String(
          stored?.operator || DEFAULT_HERO_SMS_SETTINGS.operator
        ),
        maxPrice: String(stored?.maxPrice || "")
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

  const buildHeroSmsOptions = (): HeroSmsPhoneVerificationOptions | null => {
    const apiKey = String(heroSmsSettings.apiKey || "").trim()
    if (!apiKey) {
      setStatus("请先填写 HeroSMS 接码 API")
      log.warn("[注册调试] Step 7 缺少 HeroSMS 接码 API")
      return null
    }

    const country = HERO_SMS_COUNTRY_OPTIONS.find((item) => {
      return item.value === heroSmsSettings.countryId
    })

    return {
      apiKey,
      countryId: Number(country?.value || DEFAULT_HERO_SMS_SETTINGS.countryId),
      countryLabel: country?.countryLabel || "Indonesia",
      operator: String(heroSmsSettings.operator || "any").trim() || "any",
      maxPrice: String(heroSmsSettings.maxPrice || "").trim()
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
                value={heroSmsSettings.countryId}
                options={HERO_SMS_COUNTRY_OPTIONS}
                onChange={(value) => {
                  patchHeroSmsSettings({ countryId: value })
                }}
                disabled={isDebugRunning}
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">运营商选项</span>
              <Select
                value={heroSmsSettings.operator}
                options={HERO_SMS_OPERATOR_OPTIONS}
                onChange={(value) => {
                  patchHeroSmsSettings({ operator: value })
                }}
                disabled={isDebugRunning}
              />
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
                disabled={isDebugRunning}
              />
            </div>
            <div className="debug-field">
              <span className="debug-label">价格上限</span>
              <Input
                value={heroSmsSettings.maxPrice}
                placeholder="例如 0.12"
                allowClear
                onChange={(event) => {
                  patchHeroSmsSettings({ maxPrice: event.target.value })
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
