import { Button, Collapse, Form, Input, Space } from "antd"
import { useEffect, useState } from "react"

import {
  EMPTY_ACCOUNT_FORM,
  type AccountFormValues
} from "../../shared/account-state"
import type { AccountPageState } from "./useAccountPageState"

type AccountFormPanelAccountPage = Pick<
  AccountPageState,
  | "editingAccount"
  | "editingEmail"
  | "handleSubmitAccount"
  | "handleCancelEdit"
>

type AccountFormPanelProps = {
  accountPage: AccountFormPanelAccountPage
  disabled: boolean
}

const ACCOUNT_PANEL_KEY = "account"

export function AccountFormPanel({
  accountPage,
  disabled
}: AccountFormPanelProps) {
  const {
    editingAccount,
    editingEmail,
    handleSubmitAccount,
    handleCancelEdit: cancelEdit
  } = accountPage
  const [form] = Form.useForm<AccountFormValues>()
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  useEffect(() => {
    if (!editingAccount) {
      return
    }

    form.setFieldsValue({
      email: editingAccount.email,
      password: editingAccount.password
    })
    setActiveKeys([ACCOUNT_PANEL_KEY])
  }, [form, editingAccount])

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const handleCancelEdit = () => {
    cancelEdit()
    form.resetFields()
    form.setFieldsValue(EMPTY_ACCOUNT_FORM)
  }

  return (
    <Collapse
      className="panel-card"
      activeKey={activeKeys}
      onChange={handleCollapseChange}
      items={[
        {
          key: ACCOUNT_PANEL_KEY,
          label: "账号管理",
          forceRender: true,
          children: (
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={handleSubmitAccount}>
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入邮箱" },
                  { type: "email", message: "邮箱格式不正确" }
                ]}>
                <Input
                  placeholder="name@example.com"
                  allowClear
                  disabled={disabled}
                />
              </Form.Item>

              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}>
                <Input.Password placeholder="请输入密码" disabled={disabled} />
              </Form.Item>

              <Space size={8} wrap>
                <Button type="primary" htmlType="submit" disabled={disabled}>
                  {editingEmail ? "更新账号" : "添加账号"}
                </Button>
                <Button
                  onClick={handleCancelEdit}
                  disabled={disabled || !editingEmail}>
                  取消编辑
                </Button>
              </Space>
            </Form>
          )
        }
      ]}
    />
  )
}

