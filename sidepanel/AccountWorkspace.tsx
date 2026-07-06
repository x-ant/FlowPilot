import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  Typography
} from "antd"
import { useEffect, type ReactNode } from "react"

import {
  EMPTY_ACCOUNT_FORM,
  getAccountProgressSummary,
  normalizeEmail,
  STATUS_META,
  STEP_COUNT,
  type AccountFormValues,
  type LoginFormValues,
  type ManagedAccount
} from "./shared"

type AccountWorkspaceProps = {
  cpaUrl: string
  cpaManagementKey: string
  accounts: ManagedAccount[]
  editingAccount: ManagedAccount | null
  editingEmail: string
  runningEmail: string
  selectedCount: number
  selectedEmailSet: Set<string>
  isAllAccountsSelected: boolean
  isSomeAccountsSelected: boolean
  completedCount: number
  runningCount: number
  failedCount: number
  disabled: boolean
  stepCount?: number
  accountToolbarActions?: ReactNode
  extraContent?: ReactNode
  debugTitleExtra: ReactNode
  debugContent: ReactNode
  onCpaUrlChange: (cpaUrl: string) => void
  onCpaManagementKeyChange: (cpaManagementKey: string) => void
  onSubmitAccount: (values: AccountFormValues) => void
  onCancelEdit: () => void
  onEditAccount: (account: ManagedAccount) => void
  onRemoveAccount: (email: string) => void
  onToggleAccountSelected: (email: string, checked: boolean) => void
  onToggleAllAccountsSelected: (checked: boolean) => void
  onMoveSelectedAccount: (direction: -1 | 1) => void
  onMarkSelectedAccountsDone: () => void
}

export function AccountWorkspace({
  cpaUrl,
  cpaManagementKey,
  accounts,
  editingAccount,
  editingEmail,
  runningEmail,
  selectedCount,
  selectedEmailSet,
  isAllAccountsSelected,
  isSomeAccountsSelected,
  completedCount,
  runningCount,
  failedCount,
  disabled,
  stepCount = STEP_COUNT,
  accountToolbarActions,
  extraContent,
  debugTitleExtra,
  debugContent,
  onCpaUrlChange,
  onCpaManagementKeyChange,
  onSubmitAccount,
  onCancelEdit,
  onEditAccount,
  onRemoveAccount,
  onToggleAccountSelected,
  onToggleAllAccountsSelected,
  onMoveSelectedAccount,
  onMarkSelectedAccountsDone
}: AccountWorkspaceProps) {
  const [loginForm] = Form.useForm<LoginFormValues>()
  const [accountForm] = Form.useForm<AccountFormValues>()

  useEffect(() => {
    loginForm.setFieldsValue({ cpaUrl, cpaManagementKey })
  }, [cpaManagementKey, cpaUrl, loginForm])

  useEffect(() => {
    if (!editingAccount) {
      return
    }

    accountForm.setFieldsValue({
      email: editingAccount.email,
      password: editingAccount.password
    })
  }, [accountForm, editingAccount])

  const handleCancelEdit = () => {
    onCancelEdit()
    accountForm.resetFields()
    accountForm.setFieldsValue(EMPTY_ACCOUNT_FORM)
  }

  return (
    <>
      <Card className="panel-card" title="账号列表">
        {accounts.length > 0 ? (
          <div className="account-toolbar">
            <div className="account-toolbar-main">
              <Checkbox
                checked={isAllAccountsSelected}
                indeterminate={isSomeAccountsSelected}
                disabled={disabled || accounts.length === 0}
                onChange={(event) => {
                  onToggleAllAccountsSelected(event.target.checked)
                }}>
                全选
              </Checkbox>
              <Tag color="default">{`已选 ${selectedCount}`}</Tag>
            </div>
            <div className="account-toolbar-secondary">
              {accountToolbarActions}
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "move-up",
                      label: "上移"
                    },
                    {
                      key: "move-down",
                      label: "下移"
                    },
                    {
                      type: "divider"
                    },
                    {
                      key: "mark-done",
                      label: "标为已完成"
                    }
                  ],
                  onClick: ({ key }) => {
                    if (key === "mark-done") {
                      onMarkSelectedAccountsDone()
                      return
                    }

                    onMoveSelectedAccount(key === "move-up" ? -1 : 1)
                  }
                }}>
                <Button disabled={disabled || selectedCount === 0}>更多</Button>
              </Dropdown>
            </div>
          </div>
        ) : null}
        {accounts.length > 0 ? (
          <div className="account-list">
            {accounts.map((account) => {
              const statusMeta = STATUS_META[account.status]
              return (
                <div
                  className={`account-row account-row--${account.status} ${
                    runningEmail === account.email ? "account-row--active" : ""
                  }`}
                  key={account.email}>
                  <div className="account-select">
                    <Checkbox
                      checked={selectedEmailSet.has(
                        normalizeEmail(account.email)
                      )}
                      disabled={disabled}
                      onChange={(event) => {
                        onToggleAccountSelected(
                          account.email,
                          event.target.checked
                        )
                      }}
                    />
                  </div>
                  <div className="account-main">
                    <div className="account-head">
                      <span className="account-email" title={account.email}>
                        {account.email}
                      </span>
                      <Space className="account-status-tags" size={6}>
                        <Tag variant="filled">{`${account.progress}/${stepCount}`}</Tag>
                        <Tag variant="filled" color={statusMeta.color}>
                          {statusMeta.label}
                        </Tag>
                      </Space>
                    </div>
                    <div className="account-meta">
                      {getAccountProgressSummary(account)}
                    </div>
                  </div>

                  <div className="account-actions">
                    <div className="account-inline-actions">
                      <Button
                        aria-label="编辑"
                        className="account-icon-button"
                        size="small"
                        title="编辑"
                        onClick={() => {
                          onEditAccount(account)
                        }}
                        disabled={disabled}>
                        <span className="account-action-icon">✎</span>
                        <span className="account-action-text">编辑</span>
                      </Button>
                      <Button
                        aria-label="删除"
                        className="account-icon-button"
                        size="small"
                        title="删除"
                        danger
                        onClick={() => {
                          onRemoveAccount(account.email)
                        }}
                        disabled={disabled}>
                        <span className="account-action-icon">×</span>
                        <span className="account-action-text">删除</span>
                      </Button>
                    </div>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          {
                            key: "edit",
                            label: "编辑",
                            disabled
                          },
                          {
                            type: "divider"
                          },
                          {
                            key: "remove",
                            label: "删除",
                            danger: true,
                            disabled
                          }
                        ],
                        onClick: ({ key }) => {
                          if (key === "edit") {
                            onEditAccount(account)
                            return
                          }

                          if (key === "remove") {
                            onRemoveAccount(account.email)
                          }
                        }
                      }}>
                      <Button
                        className="account-menu-actions"
                        size="small"
                        disabled={disabled}>
                        操作
                      </Button>
                    </Dropdown>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Typography.Text type="secondary">
                还没有账号，先添加一个吧
              </Typography.Text>
            }
          />
        )}
      </Card>

      {extraContent}

      <Collapse
        className="panel-card"
        items={[
          {
            key: "cpa",
            label: "CPA 地址",
            children: (
              <Form
                form={loginForm}
                layout="vertical"
                requiredMark={false}
                onValuesChange={(_, values) => {
                  onCpaUrlChange(String(values.cpaUrl || ""))
                  onCpaManagementKeyChange(
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

      <Collapse
        className="panel-card"
        items={[
          {
            key: "account",
            label: "账号管理",
            extra: (
              <Space size={8}>
                <Tag color="success">已完成 {completedCount}</Tag>
                <Tag color="processing">执行中 {runningCount}</Tag>
                <Tag color="error">失败 {failedCount}</Tag>
              </Space>
            ),
            children: (
              <Form
                form={accountForm}
                layout="vertical"
                requiredMark={false}
                onFinish={onSubmitAccount}>
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
                  <Input.Password
                    placeholder="请输入密码"
                    disabled={disabled}
                  />
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

      <Collapse
        className="panel-card"
        items={[
          {
            key: "debug",
            label: "调试控制台",
            extra: debugTitleExtra,
            children: debugContent
          }
        ]}
      />
    </>
  )
}
