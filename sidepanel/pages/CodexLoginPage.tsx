import { Button, Dropdown, Space } from "antd"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  getLoginBatchRunnableCount,
  runLoginBatch
} from "../../background/login/batch-runner"
import {
  confirmCodexOAuthConsent,
  fetchAndSubmitCodexVerificationCode,
  openCodexAuthLink,
  submitCodexLoginEmailAndWait,
  submitCodexLoginPasswordAndWait,
  submitCodexOAuthCallback
} from "../../background/login/steps"
import { sendRuntimeMessage } from "../../platform/chrome/runtime-messaging"
import {
  getFlowStepLabel,
  getFlowStepName,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  matchesManagedAccountVisibilityFilter,
  STEP_COUNT,
  type AccountVisibilityFilter,
  type BatchRunMode,
  type DebugStep,
  type ManagedAccount
} from "../../shared/account-state"
import { RUNTIME_MESSAGE_TYPES } from "../../shared/runtime-messages"
import {
  LOGIN_ACCOUNT_FORM_DRAFT_STORAGE_KEY,
  LOGIN_STORAGE_KEYS
} from "../../shared/storage-keys"
import {
  createOAuthIntegrationConfig,
  hasRequiredOAuthIntegrationConfig,
  type OAuthBinding
} from "../../shared/oauth-integration"
import {
  AccountFormPanel,
  AccountListPanel,
  useAccountPageState
} from "../account-management"
import { OAuthConfigPanel, useOAuthTargetConfig } from "../oauth-config"
import { LoginDebugPanel } from "../login-debug"
import type { PageProps } from "./types"

const setPowerKeepAwake = async (action: "acquire" | "release") => {
  try {
    await sendRuntimeMessage({
      type: RUNTIME_MESSAGE_TYPES.powerKeepAwake,
      action,
      reason: "login-batch"
    })
  } catch {
    // 保持唤醒只是辅助能力，消息失败不影响登录主流程。
  }
}

export function CodexLoginPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: LOGIN_STORAGE_KEYS,
    log,
    setStatus
  })
  const {
    cpaUrl,
    cpaManagementKey,
    accounts,
    selectedEmails,
    selectedCount,
    syncAccounts,
    setRunningEmail,
    patchAccountState
  } = accountPage
  const oauthTarget = useOAuthTargetConfig("login")
  const integration = useMemo(() => {
    return createOAuthIntegrationConfig(
      oauthTarget.settings,
      cpaUrl,
      cpaManagementKey
    )
  }, [cpaManagementKey, cpaUrl, oauthTarget.settings])
  const [debugEmail, setDebugEmail] = useState("")
  const [debugAccountFilter, setDebugAccountFilter] =
    useState<AccountVisibilityFilter>("pending")
  const [debugAuthTabId, setDebugAuthTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState<0 | DebugStep>(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const [debugOAuthBinding, setDebugOAuthBinding] =
    useState<OAuthBinding | null>(null)
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [debugRunningStep, setDebugRunningStep] = useState<0 | DebugStep>(0)
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchStopping, setIsBatchStopping] = useState(false)
  const batchCancelRef = useRef(false)
  const batchAbortControllerRef = useRef<AbortController | null>(null)

  const filteredDebugAccounts = useMemo(() => {
    return accounts.filter((account) => {
      return matchesManagedAccountVisibilityFilter(
        account,
        debugAccountFilter,
        STEP_COUNT
      )
    })
  }, [accounts, debugAccountFilter])

  const selectedDebugAccount = useMemo(() => {
    return (
      filteredDebugAccounts.find((account) => {
        return getManagedAccountKey(account) === debugEmail
      }) || null
    )
  }, [debugEmail, filteredDebugAccounts])
  const parsedDebugAuthTabId = Number.parseInt(debugAuthTabId, 10)
  const hasDebugAuthTabId =
    Number.isFinite(parsedDebugAuthTabId) && parsedDebugAuthTabId > 0

  useEffect(() => {
    onBusyChange?.(isBatchRunning || isDebugRunning)
    return () => {
      onBusyChange?.(false)
    }
  }, [isBatchRunning, isDebugRunning, onBusyChange])

  useEffect(() => {
    if (filteredDebugAccounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugAccountId = debugEmail
    const hasCurrentDebugAccount = filteredDebugAccounts.some((account) => {
      return getManagedAccountKey(account) === currentDebugAccountId
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(getManagedAccountKey(filteredDebugAccounts[0]))
    }
  }, [debugEmail, filteredDebugAccounts])

  const handleUseActiveTabAsDebugAuthTab = async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (!activeTab?.id) {
      setStatus("未找到当前激活标签页")
      log.warn("未找到当前激活标签页，无法设置 auth tab")
      return
    }

    setDebugAuthTabId(String(activeTab.id))
    setStatus(`已使用当前标签页作为 auth tab：${activeTab.id}`)
    log.debug(
      `调试 auth tab 已设置为 ${activeTab.id}（${activeTab.url || "unknown"}）`
    )
  }

  const handleClearDebugState = () => {
    setDebugAuthTabId("")
    setDebugProgress(0)
    setDebugRunningStep(0)
    setDebugVerificationRequestedAt(0)
    setDebugCallbackUrl("")
    setDebugOAuthBinding(null)
    setStatus("调试状态已清空")
  }

  const handleDebugAccountChange = (accountId: string) => {
    setDebugEmail(accountId)
    setDebugProgress(0)
    setDebugRunningStep(0)
    setDebugVerificationRequestedAt(0)
    setDebugCallbackUrl("")
    setDebugOAuthBinding(null)
  }

  const handleRunDebugStep = async (step: DebugStep) => {
    const account = selectedDebugAccount

    if (!hasRequiredOAuthIntegrationConfig(integration)) {
      setStatus("请先完善 OAuth 接入配置")
      log.warn("调试步骤无法执行：OAuth 接入配置不完整")
      return
    }

    if (!account) {
      setStatus("请先选择调试账号")
      log.warn("调试步骤无法执行：未选择账号")
      return
    }

    if (isBatchRunning || isDebugRunning) {
      return
    }

    if (step !== 1 && !hasDebugAuthTabId) {
      setStatus(`请先执行「${getFlowStepLabel(1)}」或手动设置 auth tab`)
      log.warn(
        `「${getFlowStepLabel(step)}」需要 auth tab，请先执行「${getFlowStepLabel(1)}」或点击“使用当前标签页”`
      )
      return
    }

    const accountKey = getManagedAccountKey(account)
    const accountLabel = getManagedAccountDisplayLabel(account)
    setIsDebugRunning(true)
    setDebugRunningStep(step)
    setDebugProgress((current) => {
      return Math.max(current, step - 1) as 0 | DebugStep
    })
    setRunningEmail(accountKey)
    setStatus(`正在调试 ${accountLabel}：${getFlowStepLabel(step)}`)
    log.info(`[调试][${accountLabel}] 开始执行 ${getFlowStepLabel(step)}`)

    try {
      if (step === 1) {
        setDebugVerificationRequestedAt(0)
        setDebugCallbackUrl("")
        setDebugOAuthBinding(null)
        patchAccountState(accountKey, {
          progress: 0,
          status: "running",
          lastMessage: getFlowStepLabel(step)
        })

        const result = await openCodexAuthLink(integration)
        if (!result.ok || !result.targetTab?.id || !result.oauthBinding) {
          patchAccountState(accountKey, {
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(1)}失败`
          })
          setStatus(`${getFlowStepName(1)}失败`)
          log.warn(
            `[调试][${accountLabel}] ${result.message || `${getFlowStepName(1)}失败`}`
          )
          return
        }

        setDebugAuthTabId(String(result.targetTab.id))
        setDebugOAuthBinding(result.oauthBinding)
        setDebugProgress(1)
        patchAccountState(accountKey, {
          progress: 1,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(1)}已完成`)
        log.info(
          `[调试][${accountLabel}] ${result.message}；auth tab=${result.targetTab.id}；url=${
            result.targetTab.url || "unknown"
          }`
        )
        return
      }

      if (step === 2) {
        const result = await submitCodexLoginEmailAndWait(
          parsedDebugAuthTabId,
          account.email
        )
        if (!result.ok) {
          patchAccountState(accountKey, {
            progress: Math.max(debugProgress, 1) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(2)}失败`
          })
          setStatus(`${getFlowStepName(2)}失败`)
          log.warn(
            `[调试][${accountLabel}] ${result.message || `${getFlowStepName(2)}失败`}`
          )
          return
        }

        if (result.verificationRequestedAt) {
          setDebugVerificationRequestedAt(result.verificationRequestedAt)
        }
        setDebugProgress(2)
        patchAccountState(accountKey, {
          progress: 2,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(2)}已完成`)
        log.info(`[调试][${accountLabel}] ${result.message}`)
        return
      }

      if (step === 3) {
        const result = await submitCodexLoginPasswordAndWait(
          parsedDebugAuthTabId,
          account.password
        )
        if (!result.ok) {
          patchAccountState(accountKey, {
            progress: Math.max(debugProgress, 2) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(3)}失败`
          })
          setStatus(`${getFlowStepName(3)}失败`)
          log.warn(
            `[调试][${accountLabel}] ${result.message || `${getFlowStepName(3)}失败`}`
          )
          return
        }

        if (result.verificationRequestedAt) {
          setDebugVerificationRequestedAt(result.verificationRequestedAt)
        }
        setDebugProgress(3)
        patchAccountState(accountKey, {
          progress: 3,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(3)}已完成`)
        log.info(`[调试][${accountLabel}] ${result.message}`)
        return
      }

      if (step === 4) {
        const result = await fetchAndSubmitCodexVerificationCode(
          parsedDebugAuthTabId,
          account,
          debugVerificationRequestedAt
        )
        if (!result.ok) {
          patchAccountState(accountKey, {
            progress: Math.max(debugProgress, 3) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(4)}失败`
          })
          setStatus(`${getFlowStepName(4)}失败`)
          log.warn(
            `[调试][${accountLabel}] ${result.message || `${getFlowStepName(4)}失败`}`
          )
          return
        }

        setDebugProgress(4)
        patchAccountState(accountKey, {
          progress: 4,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(4)}已完成`)
        log.info(`[调试][${accountLabel}] ${result.message}`)
        return
      }

      if (step === 5) {
        const result = await confirmCodexOAuthConsent(parsedDebugAuthTabId)
        if (!result.ok || !result.callbackUrl) {
          patchAccountState(accountKey, {
            progress: Math.max(debugProgress, 4) as ManagedAccount["progress"],
            status: "failed",
            lastMessage: result.message || `${getFlowStepName(5)}失败`
          })
          setStatus(`${getFlowStepName(5)}失败`)
          log.warn(
            `[调试][${accountLabel}] ${result.message || `${getFlowStepName(5)}失败`}`
          )
          return
        }

        setDebugCallbackUrl(result.callbackUrl)
        setDebugProgress(5)
        patchAccountState(accountKey, {
          progress: 5,
          status: "running",
          lastMessage: result.message
        })
        setStatus(`${getFlowStepName(5)}已完成`)
        log.info(`[调试][${accountLabel}] ${result.message}`)
        return
      }

      if (!debugCallbackUrl) {
        setStatus(`请先执行「${getFlowStepLabel(5)}」获取 callback URL`)
        log.warn(`「${getFlowStepLabel(6)}」无法执行：缺少 callback URL`)
        return
      }
      if (!debugOAuthBinding) {
        setStatus(`请先执行「${getFlowStepLabel(1)}」获取 OAuth 会话`)
        log.warn(`「${getFlowStepLabel(6)}」无法执行：缺少 OAuth 来源绑定信息`)
        return
      }

      const result = await submitCodexOAuthCallback(
        integration,
        debugOAuthBinding,
        debugCallbackUrl,
        parsedDebugAuthTabId,
        account.email
      )
      if (!result.ok) {
        patchAccountState(accountKey, {
          progress: Math.max(debugProgress, 5) as ManagedAccount["progress"],
          status: "failed",
          lastMessage: result.message || `${getFlowStepName(6)}失败`
        })
        setStatus(`${getFlowStepName(6)}失败`)
        log.warn(
          `[调试][${accountLabel}] ${result.message || `${getFlowStepName(6)}失败`}`
        )
        return
      }

      setDebugProgress(6)
      patchAccountState(accountKey, {
        progress: 6,
        status: "done",
        lastMessage: result.message
      })
      setStatus(`${getFlowStepName(6)}已完成`)
      log.info(`[调试][${accountLabel}] ${result.message}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "调试步骤执行异常"
      patchAccountState(accountKey, {
        status: "failed",
        lastMessage: message
      })
      setStatus("调试步骤执行异常")
      log.warn(`[调试][${accountLabel}] ${message}`)
    } finally {
      setIsDebugRunning(false)
      setDebugRunningStep(0)
      setRunningEmail("")
    }
  }

  const handleRunNextDebugStep = () => {
    const nextStep = Math.min(
      STEP_COUNT,
      Math.max(1, debugProgress + 1)
    ) as DebugStep

    void handleRunDebugStep(nextStep)
  }

  const handleStartBatch = async (mode: BatchRunMode) => {
    if (!hasRequiredOAuthIntegrationConfig(integration)) {
      setStatus("请先完善 OAuth 接入配置")
      log.warn("OAuth 接入配置不完整")
      return
    }

    if (accounts.length === 0) {
      setStatus("请先添加至少一个账号")
      log.warn("账号列表为空")
      return
    }

    if (isBatchRunning) {
      return
    }

    if (selectedEmails.length === 0) {
      setStatus("请先选择要执行的账号")
      log.info("请先选择要执行的账号")
      return
    }

    const runnableCount = getLoginBatchRunnableCount(
      accounts,
      selectedEmails,
      mode
    )
    if (runnableCount === 0) {
      const emptyMessage =
        mode === "pending" ? "选中的账号都已完成" : "没有需要执行的账号"
      setStatus(emptyMessage)
      log.info(emptyMessage)
      return
    }

    batchCancelRef.current = false
    setIsBatchStopping(false)
    const batchAbortController = new AbortController()
    batchAbortControllerRef.current = batchAbortController
    setIsBatchRunning(true)
    setRunningEmail("")
    await setPowerKeepAwake("acquire")

    try {
      await runLoginBatch({
        integration,
        accounts,
        selectedAccountIds: selectedEmails,
        mode,
        abortSignal: batchAbortController.signal,
        shouldCancel: () => batchCancelRef.current,
        onAccountsChange: (nextAccounts) => {
          syncAccounts(nextAccounts, cpaUrl, cpaManagementKey)
        },
        onLog: (level, message) => {
          log[level](message)
        },
        onRunningEmail: setRunningEmail,
        onStatus: setStatus
      })
    } finally {
      await setPowerKeepAwake("release")
      setRunningEmail("")
      setIsBatchRunning(false)
      setIsBatchStopping(false)
      batchAbortControllerRef.current = null
    }
  }

  const handleStopBatch = () => {
    if (isBatchStopping) {
      return
    }

    setIsBatchStopping(true)
    batchCancelRef.current = true
    batchAbortControllerRef.current?.abort()
    setStatus("正在停止当前流程")
    log.warn("收到停止请求，等待当前步骤结束")
  }

  const disabled = isBatchRunning || isDebugRunning
  const hasOAuthConfig = hasRequiredOAuthIntegrationConfig(integration)

  return (
    <>
      <AccountListPanel
        accountPage={accountPage}
        disabled={disabled}
        showEmailGenerator={false}
        toolbarActions={
          isBatchRunning ? (
            <Button
              danger
              disabled={isBatchStopping}
              loading={isBatchStopping}
              onClick={handleStopBatch}>
              {isBatchStopping ? "正在停止" : "停止当前流程"}
            </Button>
          ) : (
            <Space.Compact>
              <Button
                type="primary"
                disabled={selectedCount === 0}
                onClick={() => {
                  void handleStartBatch("pending")
                }}>
                执行未完成
              </Button>
              <Dropdown
                trigger={["click"]}
                disabled={selectedCount === 0}
                menu={{
                  items: [
                    {
                      key: "all",
                      label: "全部执行"
                    }
                  ],
                  onClick: () => {
                    void handleStartBatch("all")
                  }
                }}>
                <Button
                  type="primary"
                  disabled={selectedCount === 0}
                  aria-label="执行选项">
                  ▾
                </Button>
              </Dropdown>
            </Space.Compact>
          )
        }
      />

      <OAuthConfigPanel
        target={oauthTarget}
        cpaUrl={cpaUrl}
        cpaManagementKey={cpaManagementKey}
        disabled={disabled}
        onCpaConfigChange={accountPage.handleCpaConfigChange}
      />

      <AccountFormPanel
        accountPage={accountPage}
        disabled={disabled}
        draftStorageKey={LOGIN_ACCOUNT_FORM_DRAFT_STORAGE_KEY}
        preserveDraftEmail
      />

      <LoginDebugPanel
        disabled={disabled}
        accountFilter={debugAccountFilter}
        onAccountFilterChange={setDebugAccountFilter}
        accountOptions={filteredDebugAccounts.map((account) => {
          return {
            label: getManagedAccountDisplayLabel(account),
            value: getManagedAccountKey(account)
          }
        })}
        selectedAccountId={debugEmail}
        onSelectedAccountChange={handleDebugAccountChange}
        tabId={debugAuthTabId}
        onTabIdChange={setDebugAuthTabId}
        onUseActiveTab={handleUseActiveTabAsDebugAuthTab}
        onClear={handleClearDebugState}
        progress={debugProgress}
        isRunning={isDebugRunning}
        runningStep={debugRunningStep}
        hasSelectedAccount={Boolean(selectedDebugAccount)}
        hasOAuthConfig={hasOAuthConfig}
        hasAuthTab={hasDebugAuthTabId}
        hasCallbackUrl={Boolean(debugCallbackUrl)}
        onRunNextStep={handleRunNextDebugStep}
        onRunStep={(step) => {
          void handleRunDebugStep(step)
        }}
      />
    </>
  )
}
