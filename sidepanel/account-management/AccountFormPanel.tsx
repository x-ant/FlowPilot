import { Button, Collapse, Form, Input, Select, Space } from "antd"
import { useEffect, useState } from "react"

import {
  EMPTY_ACCOUNT_FORM,
  EMPTY_ACCOUNT_FORM_DRAFT,
  getStorage,
  normalizeAccountFormDraft,
  normalizeEmailGenerator,
  normalizeMailProvider,
  type AccountFormDraftValues,
  type AccountFormValues,
  type EmailGenerator,
  type MailProvider
} from "../../shared/account-state"
import type {
  DuckEmailResult,
  FetchDuckEmailOptions
} from "../../background/integrations/duck-email"
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
  allowEmailGenerator?: boolean
  draftStorageKey?: string
  preserveDraftEmail?: boolean
  onFetchDuckEmail?: (
    options: FetchDuckEmailOptions
  ) => Promise<DuckEmailResult>
}

const ACCOUNT_PANEL_KEY = "account"

/**
 * 账号编辑表单。
 *
 * 表单只维护账号列表里的既有注册信息。
 *
 * @param props 组件属性。
 * @param props.accountPage 账号页共享状态和操作方法。
 * @param props.disabled 是否禁止编辑表单。
 * @param props.allowEmailGenerator 是否展示注册页专用的邮箱生成控件。
 * @param props.draftStorageKey 可选的表单草稿存储 key，用于保存当前页面常用输入。
 * @param props.preserveDraftEmail 是否把注册邮箱也保存到表单草稿。
 * @param props.onFetchDuckEmail 点击获取 Duck 邮箱时调用的生成方法。
 * @return 账号管理表单组件。
 */
export function AccountFormPanel({
  accountPage,
  disabled,
  allowEmailGenerator = false,
  draftStorageKey,
  preserveDraftEmail = false,
  onFetchDuckEmail
}: AccountFormPanelProps) {
  const {
    editingAccount,
    editingEmail,
    handleSubmitAccount,
    handleCancelEdit: cancelEdit
  } = accountPage
  const [form] = Form.useForm<AccountFormValues>()
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [selectedMailProvider, setSelectedMailProvider] =
    useState<MailProvider>("2925")
  const [draftValues, setDraftValues] = useState<AccountFormDraftValues>(
    EMPTY_ACCOUNT_FORM_DRAFT
  )
  const [isFetchingDuckEmail, setIsFetchingDuckEmail] = useState(false)
  const selectedEmailGenerator = Form.useWatch("emailGenerator", form)
  const canUseDuckEmailGenerator =
    allowEmailGenerator && selectedMailProvider === "163"
  const isDuckEmailGeneratorSelected =
    normalizeEmailGenerator(selectedEmailGenerator) === "duckduckgo"

  useEffect(() => {
    if (!editingAccount) {
      return
    }

    form.setFieldsValue({
      mailProvider: editingAccount.mailProvider,
      emailGenerator: editingAccount.emailGenerator,
      email: editingAccount.email,
      password: editingAccount.password
    })
    setSelectedMailProvider(editingAccount.mailProvider)
    setActiveKeys([ACCOUNT_PANEL_KEY])
  }, [form, editingAccount])

  useEffect(() => {
    if (!draftStorageKey) {
      return
    }

    let isUnmounted = false
    const storage = getStorage()
    storage?.get([draftStorageKey], (result) => {
      if (isUnmounted) {
        return
      }

      const nextDraftValues = normalizeAccountFormDraft(
        result?.[draftStorageKey]
      )
      setDraftValues(nextDraftValues)

      if (!editingAccount) {
        form.setFieldsValue({
          ...EMPTY_ACCOUNT_FORM,
          ...nextDraftValues
        })
        setSelectedMailProvider(
          normalizeMailProvider(nextDraftValues.mailProvider)
        )
      }
    })

    return () => {
      isUnmounted = true
    }
  }, [draftStorageKey, editingAccount, form])

  /**
   * 同步账号管理折叠面板的展开状态。
   *
   * @param keys Ant Design Collapse 返回的当前展开 key。
   */
  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  /**
   * 取消编辑并恢复空表单。
   */
  const handleCancelEdit = () => {
    cancelEdit()
    form.resetFields()
    form.setFieldsValue({
      ...EMPTY_ACCOUNT_FORM,
      ...draftValues
    })
    setSelectedMailProvider(normalizeMailProvider(draftValues.mailProvider))
  }

  /**
   * 判断当前表单草稿是否应该保留注册邮箱。
   *
   * 登录页需要连续复用同一邮箱；注册页默认不复用生成邮箱，只为未来的
   * 自定义邮箱选项预留保留逻辑。
   *
   * @param values 当前表单值。
   * @return 需要把注册邮箱写入草稿时返回 true。
   */
  const shouldPreserveDraftEmail = (values: AccountFormValues) => {
    return (
      preserveDraftEmail ||
      normalizeEmailGenerator(values.emailGenerator) === "custom"
    )
  }

  /**
   * 保存账号表单草稿。
   *
   * 登录页保存邮箱服务、注册邮箱和注册密码；注册页保存邮箱服务、
   * 邮箱生成和注册密码，DuckDuckGo 生成邮箱不进入草稿。
   *
   * @param values 当前表单值。
   */
  const persistDraftValues = (values: AccountFormValues) => {
    if (!draftStorageKey || editingEmail) {
      return
    }

    const nextDraftValues = normalizeAccountFormDraft({
      ...values,
      email: shouldPreserveDraftEmail(values) ? values.email : ""
    })
    setDraftValues(nextDraftValues)
    getStorage()?.set({
      [draftStorageKey]: nextDraftValues
    })
  }

  /**
   * 打开当前选择邮箱服务对应的邮箱登录页。
   *
   * 这个按钮只辅助用户手动登录邮箱，后台读取验证码时不会自动登录。
   */
  const handleLoginMailbox = () => {
    const mailProvider = normalizeMailProvider(form.getFieldValue("mailProvider"))
    const url =
      mailProvider === "163"
        ? "https://mail.163.com/"
        : "https://2925.com/#/mailList"
    void chrome.tabs.create({
      active: true,
      url
    })
  }

  /**
   * 切换邮箱服务时清空注册邮箱和注册密码。
   *
   * 2925 和 163 是不同来源的账号配置，切换服务时不复用上一种服务的输入，
   * 避免保存账号时把两个服务的数据串在一起。
   *
   * @param mailProvider 用户新选择的邮箱服务。
   */
  const handleMailProviderChange = (mailProvider: string) => {
    const nextMailProvider = normalizeMailProvider(mailProvider)
    const nextEmailGenerator: EmailGenerator | undefined =
      allowEmailGenerator && nextMailProvider === "163"
        ? "duckduckgo"
        : undefined

    setSelectedMailProvider(nextMailProvider)
    form.setFieldsValue({
      emailGenerator: nextEmailGenerator,
      email: "",
      ...(draftStorageKey ? {} : { password: "" })
    })
    persistDraftValues({
      ...form.getFieldsValue(),
      mailProvider: nextMailProvider,
      emailGenerator: nextEmailGenerator
    })
    clearEmailFieldErrors()
  }

  /**
   * 判断账号保存后是否清空注册邮箱。
   *
   * 这个判断只看“邮箱生成”字段：DuckDuckGo 或未选择生成方式都代表下一次
   * 应该重新准备邮箱；预留的 custom 表示未来手动自定义邮箱时可以继续保留。
   *
   * @param values 刚提交的账号表单值。
   * @return 需要清空注册邮箱时返回 true。
   */
  const shouldClearEmailAfterSubmit = (values: AccountFormValues) => {
    return normalizeEmailGenerator(values.emailGenerator) !== "custom"
  }

  /**
   * 提交账号并按当前页面的草稿规则恢复表单。
   *
   * @param values 表单提交的账号配置。
   */
  const handleFinishAccount = (values: AccountFormValues) => {
    const isCreatingAccount = !editingEmail
    handleSubmitAccount(values)

    if (
      draftStorageKey &&
      !shouldPreserveDraftEmail(values) &&
      isCreatingAccount &&
      shouldClearEmailAfterSubmit(values)
    ) {
      form.setFieldsValue({
        email: ""
      })
    }

    persistDraftValues({
      ...values,
      email: shouldPreserveDraftEmail(values) ? values.email : ""
    })
  }

  /**
   * 从 DuckDuckGo Email Protection 生成邮箱并回填注册邮箱字段。
   *
   * 这个动作只更新表单；真正进入注册流程前仍然需要点击添加/更新账号，
   * 让注册 runner 从账号列表读取已保存的邮箱。
   */
  const handleFetchDuckEmail = async () => {
    if (!onFetchDuckEmail || !canUseDuckEmailGenerator) {
      return
    }

    if (!isDuckEmailGeneratorSelected) {
      form.setFields([
        {
          name: "email",
          errors: ["请先选择 DuckDuckGo 邮箱生成"]
        }
      ])
      return
    }

    setIsFetchingDuckEmail(true)

    try {
      const result = await onFetchDuckEmail({
        previousEmail: form.getFieldValue("email"),
        generateNew: true
      })
      form.setFieldsValue({
        email: result.email
      })
      clearEmailFieldErrors()
    } catch (error) {
      form.setFields([
        {
          name: "email",
          errors: [
            error instanceof Error ? error.message : "Duck 邮箱生成失败"
          ]
        }
      ])
    } finally {
      setIsFetchingDuckEmail(false)
    }
  }

  /**
   * 清除注册邮箱字段上的手动错误。
   *
   * 用户手动修改邮箱后，旧的邮箱校验提示已经不一定代表当前输入状态。
   */
  const clearEmailFieldErrors = () => {
    form.setFields([
      {
        name: "email",
        errors: []
      }
    ])
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
              initialValues={EMPTY_ACCOUNT_FORM}
              requiredMark={false}
              onValuesChange={(_, values) => {
                persistDraftValues(values)
              }}
              onFinish={handleFinishAccount}>
              <Form.Item label="邮箱服务" required>
                <Space.Compact block>
                  <Form.Item
                    noStyle
                    name="mailProvider"
                    rules={[{ required: true, message: "请选择邮箱服务" }]}>
                    <Select
                      disabled={disabled}
                      onChange={handleMailProviderChange}
                      options={[
                        { label: "2925 邮箱", value: "2925" },
                        { label: "163 邮箱", value: "163" }
                      ]}
                    />
                  </Form.Item>
                  <Button onClick={handleLoginMailbox} disabled={disabled}>
                    登录
                  </Button>
                </Space.Compact>
              </Form.Item>

              {canUseDuckEmailGenerator ? (
                <Form.Item
                  label="邮箱生成"
                  name="emailGenerator"
                  rules={[
                    {
                      required: true,
                      message: "请选择邮箱生成方式"
                    }
                  ]}>
                  <Select
                    disabled={disabled || isFetchingDuckEmail}
                    options={[
                      {
                        label: "DuckDuckGo",
                        value: "duckduckgo"
                      }
                    ]}
                  />
                </Form.Item>
              ) : null}

              {canUseDuckEmailGenerator ? (
                <div
                  style={{
                    alignItems: "start",
                    columnGap: 8,
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto"
                  }}>
                  <Form.Item
                    label="注册邮箱"
                    name="email"
                    rules={[
                      { required: true, message: "请输入注册邮箱" },
                      { type: "email", message: "邮箱格式不正确" }
                    ]}>
                    <Input
                      placeholder="name@example.com"
                      allowClear
                      disabled={disabled || isFetchingDuckEmail}
                      onChange={clearEmailFieldErrors}
                    />
                  </Form.Item>
                  <Button
                    loading={isFetchingDuckEmail}
                    disabled={
                      disabled ||
                      isFetchingDuckEmail ||
                      !isDuckEmailGeneratorSelected
                    }
                    style={{ marginTop: 30 }}
                    onClick={() => {
                      void handleFetchDuckEmail()
                    }}>
                    获取
                  </Button>
                </div>
              ) : (
                <Form.Item
                  label="注册邮箱"
                  name="email"
                  rules={[
                    { required: true, message: "请输入注册邮箱" },
                    { type: "email", message: "邮箱格式不正确" }
                  ]}>
                  <Input
                    placeholder="name@example.com"
                    allowClear
                    disabled={disabled}
                    onChange={clearEmailFieldErrors}
                  />
                </Form.Item>
              )}

              <Form.Item
                label="注册密码"
                name="password"
                rules={[{ required: true, message: "请输入注册密码" }]}>
                <Input.Password
                  placeholder="请输入注册密码"
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
  )
}
