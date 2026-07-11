import { Button, Collapse, Dropdown, Select, Space, Tag } from "antd"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  confirmCodexOAuthConsent,
  createCodexLoginRunner,
  fetchAndSubmitCodexVerificationCode,
  openCodexAuthLink,
  submitCodexLoginEmailAndWait,
  submitCodexLoginPasswordAndWait,
  submitCodexOAuthCallbackToCpa
} from "../../background/login/steps"
import {
  AccountFormPanel,
  AccountListPanel,
  useAccountPageState
} from "../account-management"
import { CpaConfigPanel } from "../cpa-config"
import { DebugTabControl } from "../components/DebugTabControl"
import type { PageProps } from "./types"
import {
  getFlowStepLabel,
  getFlowStepName,
  getManagedAccountDisplayLabel,
  getManagedAccountKey,
  isManagedAccountDone,
  LOGIN_STORAGE_KEYS,
  resetManagedAccountState,
  STEP_COUNT,
  type AccountRunResult,
  type BatchRunMode,
  type DebugStep,
  type ManagedAccount,
  type ManagedAccountStatus
} from "../../shared/account-state"

const runManagedAccountFlow = async (
  cpaUrl: string,
  cpaManagementKey: string,
  account: ManagedAccount,
  runner: ReturnType<typeof createCodexLoginRunner>,
  onStage: (progress: DebugStep, message: string) => void
): Promise<AccountRunResult> => {
  const step1Result = await runner.openCodexAuthLink(cpaUrl, {
    managementKey: cpaManagementKey
  })
  if (!step1Result.ok || !step1Result.targetTab?.id) {
    return {
      ok: false,
      message: step1Result.message || "步骤 1 执行失败"
    }
  }

  onStage(1, step1Result.message)

  const authTabId = step1Result.targetTab.id
  const step2Result = await runner.submitCodexLoginEmailAndWait(
    authTabId,
    account.email
  )
  if (!step2Result.ok) {
    return {
      ok: false,
      message: step2Result.message || "步骤 2 执行失败"
    }
  }

  onStage(2, step2Result.message)

  let verificationRequestedAt = step2Result.verificationRequestedAt || 0
  const step3Result = await runner.submitCodexLoginPasswordAndWait(
    authTabId,
    account.password
  )
  if (!step3Result.ok) {
    return {
      ok: false,
      message: step3Result.message || "步骤 3 执行失败"
    }
  }
  verificationRequestedAt =
    step3Result.verificationRequestedAt || verificationRequestedAt

  onStage(3, step3Result.message)

  const step4Result = await runner.fetchAndSubmitCodexVerificationCode(
    authTabId,
    account,
    verificationRequestedAt
  )
  if (!step4Result.ok) {
    return {
      ok: false,
      message: step4Result.message || "步骤 4 执行失败"
    }
  }

  onStage(4, step4Result.message)

  const step5Result = await runner.confirmCodexOAuthConsent(authTabId)
  if (!step5Result.ok || !step5Result.callbackUrl) {
    return {
      ok: false,
      message: step5Result.message || "步骤 5 执行失败"
    }
  }

  onStage(5, step5Result.message)

  const step6Result = await runner.submitCodexOAuthCallbackToCpa(
    cpaUrl,
    cpaManagementKey,
    step5Result.callbackUrl,
    authTabId,
    step1Result.cpaOAuthState
  )
  if (!step6Result.ok) {
    return {
      ok: false,
      message: step6Result.message || "步骤 6 执行失败"
    }
  }

  onStage(6, step6Result.message)

  return {
    ok: true,
    message: [
      step1Result.message,
      step2Result.message,
      step3Result.message,
      step4Result.message,
      step5Result.message,
      step6Result.message
    ]
      .filter(Boolean)
      .join("；")
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
    selectedEmailSet,
    selectedCount,
    setAccounts,
    syncAccounts,
    setRunningEmail,
    patchAccountState
  } = accountPage
  const [debugEmail, setDebugEmail] = useState("")
  const [debugAuthTabId, setDebugAuthTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState<0 | DebugStep>(0)
  const [debugVerificationRequestedAt, setDebugVerificationRequestedAt] =
    useState(0)
  const [debugCallbackUrl, setDebugCallbackUrl] = useState("")
  const [debugCpaOAuthState, setDebugCpaOAuthState] = useState("")
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchStopping, setIsBatchStopping] = useState(false)
  const batchCancelRef = useRef(false)
  const batchAbortControllerRef = useRef<AbortController | null>(null)

  const selectedDebugAccount = useMemo(() => {
    return (
      accounts.find((account) => {
        return getManagedAccountKey(account) === debugEmail
      }) || null
    )
  }, [accounts, debugEmail])
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
    if (accounts.length === 0) {
      setDebugEmail("")
      return
    }

    const currentDebugAccountId = debugEmail
    const hasCurrentDebugAccount = accounts.some((account) => {
      return getManagedAccountKey(account) === currentDebugAccountId
    })

    if (!hasCurrentDebugAccount) {
      setDebugEmail(getManagedAccountKey(accounts[0]))
    }
  }, [accounts, debugEmail])

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
    setDebugVerificationRequestedAt(0)
    setDebugCallbackUrl("")
    setDebugCpaOAuthState("")
    setStatus("调试状态已清空")
  }

  const handleRunDebugStep = async (step: DebugStep) => {
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    const account = selectedDebugAccount

    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("调试步骤无法执行：未填写 CPA 地址")
      return
    }

    if (!cpaManagementKey.trim()) {
      setStatus("请先填写 CPA 管理密钥")
      log.warn("调试步骤无法执行：未填写 CPA 管理密钥")
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
    setRunningEmail(accountKey)
    setStatus(`正在调试 ${accountLabel}：${getFlowStepLabel(step)}`)
    log.info(`[调试][${accountLabel}] 开始执行 ${getFlowStepLabel(step)}`)

    try {
      if (step === 1) {
        setDebugVerificationRequestedAt(0)
        setDebugCallbackUrl("")
        setDebugCpaOAuthState("")
        patchAccountState(accountKey, {
          progress: 0,
          status: "running",
          lastMessage: getFlowStepLabel(step)
        })

        const result = await openCodexAuthLink(normalizedCpaUrl, {
          managementKey: cpaManagementKey
        })
        if (!result.ok || !result.targetTab?.id) {
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
        setDebugCpaOAuthState(result.cpaOAuthState || "")
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

      const result = await submitCodexOAuthCallbackToCpa(
        normalizedCpaUrl,
        cpaManagementKey,
        debugCallbackUrl,
        parsedDebugAuthTabId,
        debugCpaOAuthState
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
    const normalizedCpaUrl = String(cpaUrl || "").trim()
    if (!normalizedCpaUrl) {
      setStatus("请先填写 CPA 地址")
      log.warn("未填写 CPA 地址")
      return
    }

    if (!cpaManagementKey.trim()) {
      setStatus("请先填写 CPA 管理密钥")
      log.warn("未填写 CPA 管理密钥")
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

    const isTargetAccount = (account: ManagedAccount) => {
      const accountKey = getManagedAccountKey(account)
      if (mode === "all") {
        return selectedEmailSet.has(accountKey)
      }

      return (
        selectedEmailSet.has(accountKey) &&
        !isManagedAccountDone(account)
      )
    }
    const runnableCount = accounts.filter(isTargetAccount).length
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
    const codexLoginRunner = createCodexLoginRunner({
      abortSignal: batchAbortController.signal
    })
    setIsBatchRunning(true)
    setRunningEmail("")

    let workingAccounts = accounts.map((account) => {
      return !isTargetAccount(account)
        ? account
        : resetManagedAccountState(account)
    })
    syncAccounts(workingAccounts, normalizedCpaUrl)

    const batchLabel = mode === "all" ? "选中账号" : "选中的未完成账号"
    setStatus(`开始执行 ${runnableCount} 个${batchLabel}`)
    log.info(`开始执行 ${runnableCount} 个${batchLabel}`)

    let currentRunnableIndex = 0
    for (let index = 0; index < workingAccounts.length; index += 1) {
      if (batchCancelRef.current) {
        setStatus("已停止批量执行")
        log.warn("批量执行已停止")
        break
      }

      const currentAccount = workingAccounts[index]
      const currentAccountKey = getManagedAccountKey(currentAccount)
      const currentAccountLabel = getManagedAccountDisplayLabel(currentAccount)
      if (!isTargetAccount(currentAccount)) {
        continue
      }

      currentRunnableIndex += 1
      setRunningEmail(currentAccountKey)
      setStatus(
        `正在处理 ${currentAccountLabel}（${currentRunnableIndex}/${runnableCount}）`
      )
      log.info(`开始处理账号 ${currentAccountLabel}`)

      const updateCurrentAccount = (
        patch: Partial<ManagedAccount>
      ): ManagedAccount[] => {
        const nextAccounts = [...workingAccounts]
        nextAccounts[index] = {
          ...nextAccounts[index],
          ...patch,
          updatedAt: Date.now()
        }
        workingAccounts = nextAccounts
        setAccounts(nextAccounts)
        syncAccounts(nextAccounts, normalizedCpaUrl)
        return nextAccounts
      }

      updateCurrentAccount({
        status: "running",
        lastMessage: "正在打开登录页"
      })

      let runResult: AccountRunResult
      try {
        runResult = await runManagedAccountFlow(
          normalizedCpaUrl,
          cpaManagementKey,
          currentAccount,
          codexLoginRunner,
          (progress, message) => {
            const nextStatus: ManagedAccountStatus =
              progress === STEP_COUNT ? "done" : "running"
            updateCurrentAccount({
              progress,
              status: nextStatus,
              lastMessage: message
            })
            setStatus(
              `账号 ${currentAccountLabel} 已完成「${getFlowStepLabel(progress)}」`
            )
            log.info(`[${currentAccountLabel}] ${message}`)
          }
        )
      } catch (error) {
        runResult = {
          ok: false,
          message:
            error instanceof Error ? error.message : "账号自动执行时发生异常"
        }
      }

      if (batchCancelRef.current) {
        updateCurrentAccount({
          status: "failed",
          lastMessage: runResult.message || "已停止当前流程"
        })
        setStatus("已停止当前流程")
        log.warn(
          `[${currentAccountLabel}] ${runResult.message || "已停止当前流程"}`
        )
        break
      }

      if (runResult.ok) {
        updateCurrentAccount({
          progress: STEP_COUNT,
          status: "done",
          lastMessage: runResult.message
        })
        log.info(`[${currentAccountLabel}] ${runResult.message}`)
        continue
      }

      const currentState = workingAccounts[index]
      updateCurrentAccount({
        progress: currentState.progress,
        status: "failed",
        lastMessage: runResult.message
      })
      setStatus(`账号 ${currentAccountLabel} 执行失败`)
      log.warn(`[${currentAccountLabel}] ${runResult.message}`)
    }

    setRunningEmail("")
    setIsBatchRunning(false)
    setIsBatchStopping(false)
    batchAbortControllerRef.current = null
    setStatus(
      batchCancelRef.current ? "已停止批量执行" : `${batchLabel}执行已结束`
    )
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
  const hasCpaApiConfig = Boolean(cpaUrl.trim() && cpaManagementKey.trim())

  return (
    <>
      <AccountListPanel
        accountPage={accountPage}
        disabled={disabled}
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

      <CpaConfigPanel
        cpaUrl={cpaUrl}
        cpaManagementKey={cpaManagementKey}
        disabled={disabled}
        onCpaConfigChange={accountPage.handleCpaConfigChange}
      />

      <AccountFormPanel accountPage={accountPage} disabled={disabled} />

      <Collapse
        className="panel-card"
        items={[
          {
            key: "debug",
            label: "调试控制台",
            extra: (
              <Tag color="default">{`当前进度 ${debugProgress}/${STEP_COUNT}`}</Tag>
            ),
            children: (
              <div className="debug-panel">
                <DebugTabControl
                  disabled={disabled}
                  label="Auth tab"
                  leadingContent={
                    <div className="debug-field">
                      <span className="debug-label">账号</span>
                      <Select
                        value={debugEmail || undefined}
                        placeholder="选择账号"
                        options={accounts.map((account) => {
                          return {
                            label: getManagedAccountDisplayLabel(account),
                            value: getManagedAccountKey(account)
                          }
                        })}
                        onChange={(value) => {
                          setDebugEmail(value)
                          setDebugProgress(0)
                          setDebugVerificationRequestedAt(0)
                          setDebugCallbackUrl("")
                          setDebugCpaOAuthState("")
                        }}
                        disabled={disabled || accounts.length === 0}
                      />
                    </div>
                  }
                  value={debugAuthTabId}
                  onChange={setDebugAuthTabId}
                  onUseActiveTab={handleUseActiveTabAsDebugAuthTab}
                  onClear={handleClearDebugState}
                />

                <Space size={8} wrap>
                  <Button
                    type="primary"
                    onClick={handleRunNextDebugStep}
                    loading={isDebugRunning}
                    disabled={
                      disabled || !selectedDebugAccount || !hasCpaApiConfig
                    }>
                    下一步
                  </Button>
                </Space>

                <Space size={8} wrap>
                  <Button
                    type="primary"
                    onClick={() => {
                      void handleRunDebugStep(1)
                    }}
                    loading={isDebugRunning && debugProgress === 0}
                    disabled={
                      disabled || !selectedDebugAccount || !hasCpaApiConfig
                    }>
                    {getFlowStepLabel(1)}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleRunDebugStep(2)
                    }}
                    disabled={
                      disabled || !selectedDebugAccount || !hasDebugAuthTabId
                    }>
                    {getFlowStepLabel(2)}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleRunDebugStep(3)
                    }}
                    disabled={
                      disabled || !selectedDebugAccount || !hasDebugAuthTabId
                    }>
                    {getFlowStepLabel(3)}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleRunDebugStep(4)
                    }}
                    disabled={
                      disabled || !selectedDebugAccount || !hasDebugAuthTabId
                    }>
                    {getFlowStepLabel(4)}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleRunDebugStep(5)
                    }}
                    disabled={
                      disabled || !selectedDebugAccount || !hasDebugAuthTabId
                    }>
                    {getFlowStepLabel(5)}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleRunDebugStep(6)
                    }}
                    disabled={
                      disabled ||
                      !selectedDebugAccount ||
                      !hasDebugAuthTabId ||
                      !debugCallbackUrl ||
                      !hasCpaApiConfig
                    }>
                    {getFlowStepLabel(6)}
                  </Button>
                </Space>
              </div>
            )
          }
        ]}
      />
    </>
  )
}
