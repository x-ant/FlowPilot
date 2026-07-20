import { Button, Collapse, Segmented, Select, Space, Tag } from "antd"

import type { AccountVisibilityFilter } from "../../shared/account-state"
import { DebugTabControl } from "../components/DebugTabControl"
import {
  isRegisterDebugStepDisabled,
  REGISTER_DEBUG_STEP_ITEMS,
  type RegisterDebugStep
} from "./register-debug-steps"

type RegisterDebugAccountOption = {
  label: string
  value: string
}

type RegisterDebugPanelProps = {
  disabled: boolean
  accountFilter: AccountVisibilityFilter
  onAccountFilterChange: (filter: AccountVisibilityFilter) => void
  accountOptions: RegisterDebugAccountOption[]
  selectedAccountId: string
  onSelectedAccountChange: (accountId: string) => void
  tabId: string
  onTabIdChange: (tabId: string) => void
  onUseActiveTab: () => void
  onClear: () => void
  progress: number
  isRunning: boolean
  runningStep: number
  hasSelectedAccount: boolean
  hasOAuthConfig: boolean
  canSubmitCallback: boolean
  onRunStep: (step: RegisterDebugStep) => void
}

/** 注册流程的手动调试控制台，只负责状态展示和事件转发。 */
export function RegisterDebugPanel({
  disabled,
  accountFilter,
  onAccountFilterChange,
  accountOptions,
  selectedAccountId,
  onSelectedAccountChange,
  tabId,
  onTabIdChange,
  onUseActiveTab,
  onClear,
  progress,
  isRunning,
  runningStep,
  hasSelectedAccount,
  hasOAuthConfig,
  canSubmitCallback,
  onRunStep
}: RegisterDebugPanelProps) {
  const availability = {
    disabled,
    hasSelectedAccount,
    hasOAuthConfig,
    canSubmitCallback
  }

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "debug",
          label: "调试控制台",
          extra: (
            <Tag color="default">
              {`当前进度 ${progress}/${REGISTER_DEBUG_STEP_ITEMS.length}`}
            </Tag>
          ),
          children: (
            <div className="debug-panel">
              <div className="debug-field debug-field--inline">
                <span className="debug-label">账号范围</span>
                <Segmented<AccountVisibilityFilter>
                  size="small"
                  value={accountFilter}
                  options={[
                    { label: "未完成", value: "pending" },
                    { label: "已完成", value: "done" },
                    { label: "失效", value: "invalid" },
                    { label: "全部", value: "all" }
                  ]}
                  onChange={onAccountFilterChange}
                  disabled={disabled}
                />
              </div>
              <DebugTabControl
                disabled={disabled}
                label="注册 tab"
                leadingContent={
                  <div className="debug-field">
                    <span className="debug-label">账号</span>
                    <Select
                      value={selectedAccountId || undefined}
                      placeholder="选择账号"
                      options={accountOptions}
                      onChange={onSelectedAccountChange}
                      disabled={disabled || accountOptions.length === 0}
                    />
                  </div>
                }
                value={tabId}
                onChange={onTabIdChange}
                onUseActiveTab={onUseActiveTab}
                onClear={onClear}
              />

              <Space size={8} wrap>
                {REGISTER_DEBUG_STEP_ITEMS.map(({ step, label }) => {
                  return (
                    <Button
                      key={step}
                      type={step <= progress ? "primary" : "default"}
                      onClick={() => {
                        onRunStep(step)
                      }}
                      loading={isRunning && runningStep === step}
                      disabled={isRegisterDebugStepDisabled(
                        step,
                        availability
                      )}>
                      {label}
                    </Button>
                  )
                })}
              </Space>
            </div>
          )
        }
      ]}
    />
  )
}
