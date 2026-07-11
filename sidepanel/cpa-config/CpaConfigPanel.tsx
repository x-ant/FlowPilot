import { Collapse, Form, Input } from "antd"
import { useEffect } from "react"

import type { LoginFormValues } from "../../shared/account-state"

type CpaConfigPanelProps = {
  cpaUrl: string
  cpaManagementKey: string
  disabled: boolean
  onCpaConfigChange: (cpaUrl: string, cpaManagementKey: string) => void
}

export function CpaConfigPanel({
  cpaUrl,
  cpaManagementKey,
  disabled,
  onCpaConfigChange
}: CpaConfigPanelProps) {
  const [form] = Form.useForm<LoginFormValues>()

  /**
   * 同步外部保存的 CPA 配置到表单。
   *
   * @return 外部值和表单值不一致时更新表单。
   */
  useEffect(() => {
    const currentValues = form.getFieldsValue()
    if (
      currentValues.cpaUrl === cpaUrl &&
      currentValues.cpaManagementKey === cpaManagementKey
    ) {
      return
    }

    form.setFieldsValue({ cpaUrl, cpaManagementKey })
  }, [cpaManagementKey, cpaUrl, form])

  return (
    <Collapse
      className="panel-card"
      items={[
        {
          key: "cpa",
          label: "CPA 地址",
          forceRender: true,
          children: (
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onValuesChange={(_, values) => {
                onCpaConfigChange(
                  String(values.cpaUrl || ""),
                  String(values.cpaManagementKey || "")
                )
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
