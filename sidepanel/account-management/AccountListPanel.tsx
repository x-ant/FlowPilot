import {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Space,
  Tag,
  Typography
} from "antd"
import type { MenuProps } from "antd"
import type { ReactNode } from "react"

import {
  getAccountProgressSummary,
  normalizeEmail,
  STATUS_META,
  STEP_COUNT,
  type AccountProgressStepMeta
} from "../shared"
import type { AccountPageState } from "./useAccountPageState"

type AccountListPanelAccountPage = Pick<
  AccountPageState,
  | "accounts"
  | "runningEmail"
  | "selectedCount"
  | "selectedEmailSet"
  | "isAllAccountsSelected"
  | "isSomeAccountsSelected"
  | "handleEditAccount"
  | "handleRemoveAccount"
  | "handleToggleAccountSelected"
  | "handleToggleAllAccountsSelected"
  | "handleMoveSelectedAccount"
  | "handleMarkSelectedAccountsDone"
>

type AccountListPanelProps = {
  accountPage: AccountListPanelAccountPage
  disabled: boolean
  stepCount?: number
  stepLabels?: Partial<Record<number, AccountProgressStepMeta>>
  toolbarActions?: ReactNode
  extraMoreItems?: MenuProps["items"]
  onExtraMoreClick?: (key: string) => boolean
}

export function AccountListPanel({
  accountPage,
  disabled,
  stepCount = STEP_COUNT,
  stepLabels,
  toolbarActions,
  extraMoreItems = [],
  onExtraMoreClick
}: AccountListPanelProps) {
  const {
    accounts,
    runningEmail,
    selectedCount,
    selectedEmailSet,
    isAllAccountsSelected,
    isSomeAccountsSelected,
    handleEditAccount,
    handleRemoveAccount,
    handleToggleAccountSelected,
    handleToggleAllAccountsSelected,
    handleMoveSelectedAccount,
    handleMarkSelectedAccountsDone
  } = accountPage

  return (
    <Card className="panel-card" title="账号列表">
      {accounts.length > 0 ? (
        <div className="account-toolbar">
          <div className="account-toolbar-main">
            <Checkbox
              checked={isAllAccountsSelected}
              indeterminate={isSomeAccountsSelected}
              disabled={disabled || accounts.length === 0}
              onChange={(event) => {
                handleToggleAllAccountsSelected(event.target.checked)
              }}>
              全选
            </Checkbox>
            <Tag color="default">{`已选 ${selectedCount}`}</Tag>
          </div>
          <div className="account-toolbar-secondary">
            {toolbarActions}
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
                  ...extraMoreItems,
                  ...(extraMoreItems.length > 0
                    ? [
                        {
                          type: "divider" as const
                        }
                      ]
                    : []),
                  {
                    key: "mark-done",
                    label: "标为已完成"
                  }
                ],
                onClick: ({ key }) => {
                  if (onExtraMoreClick?.(String(key))) {
                    return
                  }

                  if (key === "mark-done") {
                    handleMarkSelectedAccountsDone()
                    return
                  }

                  handleMoveSelectedAccount(key === "move-up" ? -1 : 1)
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
                      handleToggleAccountSelected(
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
                    {getAccountProgressSummary(account, {
                      stepCount,
                      stepLabels
                    })}
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
                        handleEditAccount(account)
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
                        handleRemoveAccount(account.email)
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
                          handleEditAccount(account)
                          return
                        }

                        if (key === "remove") {
                          handleRemoveAccount(account.email)
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
  )
}
