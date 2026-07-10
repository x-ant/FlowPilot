import { Collapse, Form, Input } from "antd"
import { useEffect } from "react"

import type { LoginFormValues } from "../../shared/account-state"

type CpaConfigPanelProps = {
  cpaUrl: string
  cpaManagementKey: string
  disabled: boolean
  onCpaUrlChange: (cpaUrl: string) => void
  onCpaManagementKeyChange: (cpaManagementKey: string) => void
}

export function CpaConfigPanel({
  cpaUrl,
  cpaManagementKey,
  disabled,
  onCpaUrlChange,
  onCpaManagementKeyChange
}: CpaConfigPanelProps) {
  const [form] = Form.useForm<LoginFormValues>()

  useEffect(() => {
    form.setFieldsValue({ cpaUrl, cpaManagementKey })
  }, [cpaManagementKey, cpaUrl, form])

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "cpa",
          label: "CPA 地址",
          children: (
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onValuesChange={(_, values) => {
                onCpaUrlChange(String(values.cpaUrl || ""))
                onCpaManagementKeyChange(String(values.cpaManagementKey || ""))
              }}>
              <Form.Item
                label="CPA 地址"
                name="cpaUrl"
                rules={[{ required: true, message: "请输入 CPA 地址" }]}>
                <Input
                  placeholder="https://..."
                  allowClear
                  disabled={disabled}
                />
              </Form.Item>
              <Form.Item
                label="CPA 管理密钥"
                name="cpaManagementKey"
                rules={[{ required: true, message: "请输入 CPA 管理密钥" }]}>
                <Input.Password
                  placeholder="用于 CPA 管理接口"
                  allowClear
                  disabled={disabled}
                />
              </Form.Item>
            </Form>
          )
        }
      ]}
    />
  )
}
