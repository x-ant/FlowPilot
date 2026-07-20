import { Button, Collapse, Segmented, Select, Space, Tag } from "antd"

import {
  getFlowStepLabel,
  STEP_COUNT,
  type AccountVisibilityFilter,
  type DebugStep
} from "../../shared/account-state"
import { DebugTabControl } from "../components/DebugTabControl"

type LoginDebugAccountOption = {
  label: string
  value: string
}

type LoginDebugPanelProps = {
  disabled: boolean
  accountFilter: AccountVisibilityFilter
  onAccountFilterChange: (filter: AccountVisibilityFilter) => void
  accountOptions: LoginDebugAccountOption[]
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
  hasAuthTab: boolean
  hasCallbackUrl: boolean
  onRunNextStep: () => void
  onRunStep: (step: DebugStep) => void
}

const LOGIN_DEBUG_STEPS: DebugStep[] = [1, 2, 3, 4, 5, 6]

/** 登录流程的手动调试控制台，只负责状态展示和事件转发。 */
export function LoginDebugPanel({
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
  hasAuthTab,
  hasCallbackUrl,
  onRunNextStep,
  onRunStep
}: LoginDebugPanelProps) {
  const isStepDisabled = (step: DebugStep) => {
    if (disabled || !hasSelectedAccount) {
      return true
    }

    if (step === 1) {
      return !hasOAuthConfig
    }

    if (!hasAuthTab) {
      return true
    }

    return step === 6 && (!hasCallbackUrl || !hasOAuthConfig)
  }

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "debug",
          label: "调试控制台",
          extra: (
            <Tag color="default">{`当前进度 ${progress}/${STEP_COUNT}`}</Tag>
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
                label="Auth tab"
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
                <Button
                  type="primary"
                  onClick={onRunNextStep}
                  loading={isRunning}
                  disabled={disabled || !hasSelectedAccount || !hasOAuthConfig}>
                  下一步
                </Button>
              </Space>

              <Space size={8} wrap>
                {LOGIN_DEBUG_STEPS.map((step) => {
                  return (
                    <Button
                      key={step}
                      type={step <= progress ? "primary" : "default"}
                      onClick={() => {
                        onRunStep(step)
                      }}
                      loading={isRunning && runningStep === step}
                      disabled={isStepDisabled(step)}>
                      {getFlowStepLabel(step)}
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
