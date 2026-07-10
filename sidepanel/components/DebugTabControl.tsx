import { Button, Input, Space } from "antd"
import type { ReactNode } from "react"

type DebugTabControlProps = {
  disabled: boolean
  label: string
  leadingContent?: ReactNode
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onUseActiveTab: () => void
}

export function DebugTabControl({
  disabled,
  label,
  leadingContent,
  value,
  onChange,
  onClear,
  onUseActiveTab
}: DebugTabControlProps) {
  return (
    <>
      <div className={`debug-row ${leadingContent ? "" : "debug-row--single"}`}>
        {leadingContent}
        <div className="debug-field">
          <span className="debug-label">{label}</span>
          <Input
            value={value}
            placeholder="tabId"
            inputMode="numeric"
            onChange={(event) => {
              onChange(event.target.value.replace(/[^\d]/g, ""))
            }}
            disabled={disabled}
          />
        </div>
      </div>

      <Space size={8} wrap>
        <Button
          onClick={() => {
            void onUseActiveTab()
          }}
          disabled={disabled}>
          使用当前标签页
        </Button>
        <Button onClick={onClear} disabled={disabled}>
          清空调试状态
        </Button>
      </Space>
    </>
  )
}
