import { Button, Select, Space, Tag } from "antd"
import { useEffect, useMemo, useState } from "react"

import {
  clickRegisterAndSubmitEmail,
  openChatGptRegisterEntry
} from "../background/codex-register"
import { AccountWorkspace } from "./AccountWorkspace"
import { DebugTabControl } from "./DebugTabControl"
import { normalizeEmail, REGISTER_STORAGE_KEYS, type PageProps } from "./shared"
import { useAccountPageState } from "./useAccountPageState"

const REGISTER_STEP_COUNT = 2

export function CodexRegisterPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: REGISTER_STORAGE_KEYS,
    log,
    setStatus
  })
  const { accounts, patchAccountState, setRunningEmail } = accountPage
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [debugEmail, setDebugEmail] = useState("")
  const [debugRegisterTabId, setDebugRegisterTabId] = useState("")
  const [debugProgress, setDebugProgress] = useState(0)

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
    setStatus("注册调试状态已清空")
  }

  const handleSubmitRegisterEmail = async () => {
    if (isDebugRunning || !selectedDebugAccount) {
      return
    }

    const parsedTabId = Number.parseInt(debugRegisterTabId, 10)
    if (!Number.isFinite(parsedTabId) || parsedTabId <= 0) {
      setStatus("请先执行 Step 1 打开 GPT 页面")
      log.warn("[注册调试] Step 2 缺少 GPT 页面 tabId，请先执行 Step 1")
      return
    }

    setIsDebugRunning(true)
    setRunningEmail(selectedDebugAccount.email)
    setStatus(`正在提交注册邮箱 ${selectedDebugAccount.email}`)
    log.info(`[注册调试][${selectedDebugAccount.email}] Step 2 开始`)
    patchAccountState(selectedDebugAccount.email, {
      progress: 1,
      status: "running",
      lastMessage: "正在点击注册并提交邮箱"
    })

    try {
      const result = await clickRegisterAndSubmitEmail(
        selectedDebugAccount.email,
        parsedTabId
      )

      if (!result.ok) {
        setStatus("提交注册邮箱失败")
        log.warn(`[注册调试][${selectedDebugAccount.email}] ${result.message}`)
        patchAccountState(selectedDebugAccount.email, {
          status: "failed",
          lastMessage: result.message
        })
        return
      }

      setDebugRegisterTabId(String(result.targetTab?.id || ""))
      setDebugProgress(REGISTER_STEP_COUNT)
      setStatus("已提交注册邮箱")
      log.info(
        `[注册调试][${selectedDebugAccount.email}] Step 2 ${result.message}；tab=${
          result.targetTab?.id || "unknown"
        }；url=${result.targetTab?.url || "unknown"}`
      )
      patchAccountState(selectedDebugAccount.email, {
        progress: 2,
        status: "done",
        lastMessage: result.message
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "提交注册邮箱异常"
      setStatus("提交注册邮箱异常")
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

  return (
    <AccountWorkspace
      {...accountPage}
      disabled={isDebugRunning}
      onCpaUrlChange={accountPage.handleCpaUrlChange}
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
          </Space>
        </div>
      }
    />
  )
}
