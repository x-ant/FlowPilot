import { Button, Space, Tag } from "antd"
import { useEffect, useState } from "react"

import { openChatGptAndClickRegister } from "../background/codex-register"
import { AccountWorkspace } from "./AccountWorkspace"
import { REGISTER_STORAGE_KEYS, type PageProps } from "./shared"
import { useAccountPageState } from "./useAccountPageState"

export function CodexRegisterPage({ log, setStatus, onBusyChange }: PageProps) {
  const accountPage = useAccountPageState({
    storageKeys: REGISTER_STORAGE_KEYS,
    log,
    setStatus
  })
  const [isDebugRunning, setIsDebugRunning] = useState(false)

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
    setStatus("正在打开 GPT 注册入口")
    log.info("[注册调试] 开始打开 GPT 页面并点击注册")

    try {
      const result = await openChatGptAndClickRegister()
      if (!result.ok) {
        setStatus("打开 GPT 注册入口失败")
        log.warn(`[注册调试] ${result.message}`)
        return
      }

      setStatus("已打开 GPT 注册入口")
      log.info(
        `[注册调试] ${result.message}；tab=${result.targetTab?.id || "unknown"}；url=${
          result.targetTab?.url || "unknown"
        }`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "打开 GPT 注册入口异常"
      setStatus("打开 GPT 注册入口异常")
      log.warn(`[注册调试] ${message}`)
    } finally {
      setIsDebugRunning(false)
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
      debugTitleExtra={<Tag color="default">注册入口</Tag>}
      debugContent={
        <div className="debug-panel">
          <Space size={8} wrap>
            <Button
              type="primary"
              onClick={() => {
                void handleOpenRegisterEntry()
              }}
              loading={isDebugRunning}
              disabled={isDebugRunning}>
              打开 GPT 并点击注册
            </Button>
          </Space>
        </div>
      }
    />
  )
}
