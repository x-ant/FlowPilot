import {
  Button,
  Collapse,
  Input,
  InputNumber,
  Radio,
  Space,
  Switch,
  Tag
} from "antd"

import type { RegisterAlarmConfig } from "../../shared/account-state"
import { getRegisterAlarmSummary } from "./automation-summary"

type RegisterAutomationPanelProps = {
  config: RegisterAlarmConfig
  appliedConfig: RegisterAlarmConfig
  disabled: boolean
  isSaving: boolean
  isTesting: boolean
  hasOrphanRunLock: boolean
  onConfigChange: (config: RegisterAlarmConfig) => void
  onSave: () => void | Promise<void>
  onRunNow: () => void | Promise<void>
}

/**
 * 注册自动触发表单。
 *
 * 组件只负责展示受控配置和转发用户操作；存储及 background 消息由
 * useRegisterTaskControl 处理。
 */
export function RegisterAutomationPanel({
  config,
  appliedConfig,
  disabled,
  isSaving,
  isTesting,
  hasOrphanRunLock,
  onConfigChange,
  onSave,
  onRunNow
}: RegisterAutomationPanelProps) {
  const controlsDisabled = disabled || isSaving
  const lastTriggeredLabel = appliedConfig.lastTriggeredAt
    ? new Date(appliedConfig.lastTriggeredAt).toLocaleString()
    : "尚未触发"

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "register-alarm",
          label: "自动触发",
          extra: (
            <Tag color={appliedConfig.enabled ? "processing" : "default"}>
              {appliedConfig.enabled
                ? getRegisterAlarmSummary(appliedConfig)
                : "未启用"}
            </Tag>
          ),
          children: (
            <div className="debug-panel">
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                <Space size={12} wrap>
                  <Switch
                    checked={config.enabled}
                    disabled={controlsDisabled}
                    onChange={(enabled) => {
                      onConfigChange({
                        ...config,
                        enabled
                      })
                    }}
                  />
                  <Radio.Group
                    value={config.mode}
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      onConfigChange({
                        ...config,
                        mode:
                          event.target.value === "daily" ? "daily" : "interval"
                      })
                    }}>
                    <Radio.Button value="interval">间隔</Radio.Button>
                    <Radio.Button value="daily">每天</Radio.Button>
                  </Radio.Group>
                </Space>

                {config.mode === "interval" ? (
                  <Space size={8} wrap>
                    <span className="debug-label">间隔分钟</span>
                    <InputNumber
                      min={1}
                      precision={0}
                      value={config.intervalMinutes}
                      disabled={controlsDisabled}
                      onChange={(value) => {
                        onConfigChange({
                          ...config,
                          intervalMinutes: Math.max(1, Number(value || 1))
                        })
                      }}
                    />
                  </Space>
                ) : (
                  <Space size={8} wrap>
                    <span className="debug-label">每天时间</span>
                    <Input
                      type="time"
                      value={config.dailyTime}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        onConfigChange({
                          ...config,
                          dailyTime: event.target.value || "02:00"
                        })
                      }}
                    />
                  </Space>
                )}

                <Space size={8} wrap>
                  <span className="debug-label">账号间隔范围</span>
                  <Space.Compact>
                    <InputNumber
                      min={0}
                      precision={0}
                      value={config.accountIntervalMinSeconds}
                      disabled={controlsDisabled}
                      onChange={(value) => {
                        const nextMinSeconds = Math.max(0, Number(value || 0))
                        onConfigChange({
                          ...config,
                          accountIntervalMinSeconds: nextMinSeconds,
                          accountIntervalMaxSeconds: Math.max(
                            nextMinSeconds,
                            config.accountIntervalMaxSeconds
                          )
                        })
                      }}
                    />
                    <Button tabIndex={-1} style={{ pointerEvents: "none" }}>
                      秒
                    </Button>
                  </Space.Compact>
                  <span className="debug-label">至</span>
                  <Space.Compact>
                    <InputNumber
                      min={0}
                      precision={0}
                      value={config.accountIntervalMaxSeconds}
                      disabled={controlsDisabled}
                      onChange={(value) => {
                        onConfigChange({
                          ...config,
                          accountIntervalMaxSeconds: Math.max(
                            config.accountIntervalMinSeconds,
                            Number(value || 0)
                          )
                        })
                      }}
                    />
                    <Button tabIndex={-1} style={{ pointerEvents: "none" }}>
                      秒
                    </Button>
                  </Space.Compact>
                </Space>

                <Space size={8} wrap>
                  <Tag color="default">{`上次 ${lastTriggeredLabel}`}</Tag>
                </Space>

                {appliedConfig.lastMessage ? (
                  <div className="debug-label">{appliedConfig.lastMessage}</div>
                ) : null}

                <Space size={8} wrap>
                  <Button
                    type="primary"
                    loading={isSaving}
                    disabled={controlsDisabled}
                    onClick={() => {
                      void onSave()
                    }}>
                    应用定时设置
                  </Button>
                  <Button
                    loading={isTesting}
                    disabled={disabled || isTesting || hasOrphanRunLock}
                    onClick={() => {
                      void onRunNow()
                    }}>
                    单次触发
                  </Button>
                </Space>
              </Space>
            </div>
          )
        }
      ]}
    />
  )
}
