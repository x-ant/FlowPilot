import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  theme,
  Typography
} from "antd"
import zhCN from "antd/locale/zh_CN"
import { useEffect, useMemo, useRef, useState } from "react"

import "antd/dist/reset.css"
import "./sidepanel.css"

import type { BackgroundRequest, BackgroundResponse } from "./background/types"
import {
  createUiLogger,
  getTimeLabel,
  LOG_LEVEL_META,
  type LogItem
} from "./shared/logging"

type Settings = {
  loginUrl?: string
  email?: string
  password?: string
}

type NormalizedSettings = {
  loginUrl: string
  email: string
  password: string
}

type AuthTabSnapshot = {
  id?: number
  url?: string
  updatedAt?: number
}

type LoginStepId =
  | "click-codex-login"
  | "open-auth-link"
  | "fill-auth-email"
  | "fill-auth-code"
  | "confirm-oauth-callback"

type LoginStepConfig = {
  id: LoginStepId
  index: number
  title: string
  requiredFields: Array<keyof Settings>
  missingStatus: string
  missingMessage: string
  workingStatus: string
  debugMessage: string
  needsAuthTab?: boolean
  missingAuthTabStatus?: string
  missingAuthTabMessage?: string
  resetAuthTabBeforeRun?: boolean
  persistResultTab?: boolean
  buildRequest: (args: {
    values: NormalizedSettings
    authTabId: number
  }) => BackgroundRequest
}

const STORAGE_KEY = "codex-login:settings"
const AUTH_TAB_STORAGE_KEY = "codex-login:auth-tab"
const STEP_CLICK_CODEX_LOGIN: LoginStepId = "click-codex-login"
const STEP_OPEN_AUTH_LINK: LoginStepId = "open-auth-link"
const STEP_FILL_AUTH_EMAIL: LoginStepId = "fill-auth-email"
const STEP_FILL_AUTH_CODE: LoginStepId = "fill-auth-code"
const STEP_CONFIRM_OAUTH_CALLBACK: LoginStepId = "confirm-oauth-callback"

const LOGIN_STEPS: LoginStepConfig[] = [
  {
    id: STEP_CLICK_CODEX_LOGIN,
    index: 1,
    title: "点击开始codex登录",
    requiredFields: ["loginUrl"],
    missingStatus: "步骤 1 需要登录地址",
    missingMessage: "Codex 登录地址不能为空",
    workingStatus: "正在打开 Codex 管理页",
    debugMessage: "步骤 1 准备点击“开始codex登录”按钮",
    buildRequest: ({ values }) => ({
      type: "codex-login:start",
      payload: {
        targetUrl: values.loginUrl
      }
    })
  },
  {
    id: STEP_OPEN_AUTH_LINK,
    index: 2,
    title: "打开登录页",
    requiredFields: ["loginUrl"],
    missingStatus: "步骤 2 需要登录地址",
    missingMessage: "Codex 登录地址不能为空",
    workingStatus: "正在清理旧登录信息并打开登录页",
    debugMessage: "步骤 2 准备清理旧登录信息并打开 OpenAI 登录页",
    resetAuthTabBeforeRun: true,
    persistResultTab: true,
    buildRequest: ({ values }) => ({
      type: "codex-login:open-auth-link",
      payload: {
        targetUrl: values.loginUrl
      }
    })
  },
  {
    id: STEP_FILL_AUTH_EMAIL,
    index: 3,
    title: "填写邮箱并继续",
    requiredFields: ["email"],
    missingStatus: "步骤 3 需要先执行步骤 2 并填写邮箱",
    missingMessage: "2925 邮箱不能为空",
    workingStatus: "正在填写邮箱并继续",
    debugMessage: "步骤 3 准备填写邮箱并点击“继续”",
    needsAuthTab: true,
    missingAuthTabStatus: "步骤 3 需要先执行步骤 2",
    missingAuthTabMessage: "请先执行步骤 2 打开 OpenAI 登录页",
    persistResultTab: true,
    buildRequest: ({ values, authTabId }) => ({
      type: "codex-login:fill-auth-email",
      payload: {
        tabId: authTabId,
        email: values.email
      }
    })
  },
  {
    id: STEP_FILL_AUTH_CODE,
    index: 4,
    title: "读取验证码并回填",
    requiredFields: ["email", "password"],
    missingStatus: "步骤 4 需要先执行步骤 2/3 并填写账号密码",
    missingMessage: "2925 邮箱和密码不能为空",
    workingStatus: "正在读取 2925 验证码并回填",
    debugMessage: "步骤 4 准备读取 2925 验证码并回填到邮箱验证码页",
    needsAuthTab: true,
    missingAuthTabStatus: "步骤 4 需要先执行步骤 2 和步骤 3",
    missingAuthTabMessage: "请先执行步骤 2 和步骤 3 打开邮箱验证码页",
    persistResultTab: true,
    buildRequest: ({ values, authTabId }) => ({
      type: "codex-login:fill-auth-code",
      payload: {
        tabId: authTabId,
        email: values.email,
        password: values.password
      }
    })
  },
  {
    id: STEP_CONFIRM_OAUTH_CALLBACK,
    index: 5,
    title: "确认授权并提交回调 URL",
    requiredFields: ["loginUrl"],
    missingStatus: "步骤 5 需要登录地址",
    missingMessage: "Codex 登录地址不能为空",
    workingStatus: "正在确认授权并提交回调 URL",
    debugMessage:
      "步骤 5 准备点击授权页“继续”，并把 localhost 回调提交到管理页",
    needsAuthTab: true,
    missingAuthTabStatus: "步骤 5 需要先执行步骤 2 到步骤 4",
    missingAuthTabMessage: "请先完成验证码回填并停留在授权确认页",
    persistResultTab: true,
    buildRequest: ({ values, authTabId }) => ({
      type: "codex-login:confirm-oauth-callback",
      payload: {
        tabId: authTabId,
        targetUrl: values.loginUrl
      }
    })
  }
]

/**
 * 获取 Chrome 扩展的本地存储对象。
 *
 * 这里先做环境判断，避免在非扩展环境下直接访问 chrome.storage 导致报错。
 *
 * @return Chrome 扩展本地存储对象；如果当前环境不是扩展环境则返回 null。
 */
const getStorage = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  return chrome.storage.local
}

/**
 * 读取指定标签页，失败时返回 null，避免已关闭 tab 让流程直接抛异常。
 *
 * @param tabId 要读取的标签页 id。
 * @return 存在时返回标签页信息，否则返回 null。
 */
const getChromeTab = (tabId: number) => {
  return new Promise<chrome.tabs.Tab | null>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.get) {
      resolve(null)
      return
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve(null)
        return
      }

      resolve(tab)
    })
  })
}

/**
 * 统一清理表单值，避免各步骤重复 trim 和类型转换。
 *
 * @param values 表单原始值。
 * @return 可直接传给后台消息的规范化表单值。
 */
const normalizeSettings = (values: Settings): NormalizedSettings => {
  return {
    loginUrl: String(values.loginUrl || "").trim(),
    email: String(values.email || "").trim(),
    password: String(values.password || "")
  }
}

/**
 * 向后台发送 Codex 登录控制请求。
 *
 * @param request 要发送给 background 的强类型请求。
 * @return 后台返回的执行结果；如果消息通道异常，会直接 reject。
 */
const sendBackgroundRequest = (request: BackgroundRequest) => {
  return new Promise<BackgroundResponse>((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("当前环境无法调用 Chrome 扩展后台脚本"))
      return
    }

    chrome.runtime.sendMessage(request, (response?: BackgroundResponse) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message || "后台脚本未响应"))
        return
      }

      if (!response) {
        reject(new Error("后台脚本未返回执行结果"))
        return
      }

      resolve(response)
    })
  })
}

/**
 * 侧边栏主组件，负责展示表单、执行步骤、统计信息和日志。
 *
 * @return React 侧边栏视图组件。
 */
function SidePanel() {
  const [form] = Form.useForm<Settings>()
  const [status, setStatus] = useState("准备就绪")
  const [logs, setLogs] = useState<LogItem[]>([])
  const [authTabId, setAuthTabId] = useState<number | null>(null)
  const [runningStep, setRunningStep] = useState<LoginStepId | null>(null)
  const logListRef = useRef<HTMLDivElement | null>(null)

  const storage = useMemo(getStorage, [])
  const log = useMemo(() => {
    return createUiLogger((level, message) => {
      setLogs((current) => {
        return [
          ...current,
          {
            id: `${Date.now()}-${current.length}`,
            time: getTimeLabel(),
            level,
            message
          }
        ]
      })
    })
  }, [])

  useEffect(() => {
    const element = logListRef.current
    if (!element) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [logs])

  useEffect(() => {
    // 页面初始化时尝试读取本地保存的登录配置。
    storage?.get([STORAGE_KEY, AUTH_TAB_STORAGE_KEY], (result) => {
      const saved = result?.[STORAGE_KEY] as Settings | undefined
      if (saved) {
        form.setFieldsValue(saved)
        setStatus("已加载本地配置")
      }

      const savedAuthTab = result?.[AUTH_TAB_STORAGE_KEY] as
        | AuthTabSnapshot
        | undefined
      if (typeof savedAuthTab?.id === "number") {
        setAuthTabId(savedAuthTab.id)
      }
    })
  }, [form, storage])

  /**
   * 监听表单变化并即时保存到本地。
   *
   * @param _ 当前字段变更摘要，保留给 antd Form 使用。
   * @param values 当前表单完整值。
   * @return 无。
   */
  const handleValuesChange = (_: Partial<Settings>, values: Settings) => {
    storage?.set({ [STORAGE_KEY]: values })
  }

  /**
   * 保存或清理当前 OpenAI 登录页 tab 上下文。
   *
   * @param targetTab 后台步骤返回的目标 tab 信息；为空时表示清理。
   * @return 无。
   */
  const persistAuthTab = (targetTab?: BackgroundResponse["targetTab"]) => {
    const nextTabId = typeof targetTab?.id === "number" ? targetTab.id : null

    setAuthTabId(nextTabId)

    if (!storage) {
      return
    }

    if (!nextTabId) {
      storage.remove(AUTH_TAB_STORAGE_KEY)
      return
    }

    storage.set({
      [AUTH_TAB_STORAGE_KEY]: {
        id: nextTabId,
        url: targetTab?.url,
        updatedAt: Date.now()
      } satisfies AuthTabSnapshot
    })
  }

  /**
   * 从本地存储恢复 OpenAI 登录页 tab 上下文。
   *
   * @return 保存过的 tab 信息；不存在时返回 null。
   */
  const readPersistedAuthTab = () => {
    return new Promise<AuthTabSnapshot | null>((resolve) => {
      if (!storage) {
        resolve(null)
        return
      }

      storage.get(AUTH_TAB_STORAGE_KEY, (result) => {
        const saved = result?.[AUTH_TAB_STORAGE_KEY] as
          | AuthTabSnapshot
          | undefined
        resolve(saved || null)
      })
    })
  }

  /**
   * 获取可继续操作的登录页 tabId。
   *
   * 内存状态丢失时，会从 chrome.storage.local 恢复；如果 tab 已关闭，
   * 会同步清掉旧记录，避免后续步骤误用。
   *
   * @return 可用的登录页 tabId；没有可用 tab 时返回 null。
   */
  const resolveAuthTabId = async () => {
    if (authTabId) {
      const tab = await getChromeTab(authTabId)
      if (tab) {
        return authTabId
      }
    }

    const savedAuthTab = await readPersistedAuthTab()
    const savedTabId = savedAuthTab?.id
    if (typeof savedTabId !== "number") {
      return null
    }

    const tab = await getChromeTab(savedTabId)
    if (!tab) {
      persistAuthTab()
      return null
    }

    setAuthTabId(savedTabId)
    return savedTabId
  }

  /**
   * 记录参数类失败。参数失败也算一次执行尝试，所以 total 和 failed 一起增加。
   *
   * @param step 当前步骤配置。
   * @param status 要展示到顶部状态栏的文案。
   * @param message 要写入日志的失败原因。
   * @return 无。
   */
  const recordStepParameterFailure = (
    step: LoginStepConfig,
    status: string,
    message: string
  ) => {
    setStatus(status)
    log.warn(`步骤 ${step.index} 参数异常：${message}`)
  }

  /**
   * 统一执行一个登录步骤。
   *
   * 每个步骤只在 LOGIN_STEPS 中描述差异；这里负责通用的校验、统计、日志、
   * 后台请求发送和登录页 tab 持久化。
   *
   * @param step 当前要执行的步骤配置。
   * @return 无。
   */
  const executeLoginStep = async (step: LoginStepConfig) => {
    try {
      setRunningStep(step.id)

      if (step.resetAuthTabBeforeRun) {
        persistAuthTab()
      }

      const validatedValues = await form
        .validateFields(step.requiredFields)
        .catch((error) => {
          recordStepParameterFailure(
            step,
            step.missingStatus,
            error instanceof Error ? error.message : step.missingMessage
          )
          return null
        })

      if (!validatedValues) {
        return
      }

      const values = normalizeSettings({
        ...form.getFieldsValue(),
        ...validatedValues
      })
      const missingRequiredField = step.requiredFields.some((field) => {
        return !values[field]
      })

      if (missingRequiredField) {
        recordStepParameterFailure(
          step,
          step.missingStatus,
          step.missingMessage
        )
        return
      }

      let targetAuthTabId = 0
      if (step.needsAuthTab) {
        const resolvedAuthTabId = await resolveAuthTabId()
        if (!resolvedAuthTabId) {
          recordStepParameterFailure(
            step,
            step.missingAuthTabStatus || step.missingStatus,
            step.missingAuthTabMessage || "请先打开 OpenAI 登录页"
          )
          return
        }

        targetAuthTabId = resolvedAuthTabId
      }

      setStatus(step.workingStatus)
      log.debug(step.debugMessage)

      let result: BackgroundResponse
      try {
        result = await sendBackgroundRequest(
          step.buildRequest({
            values,
            authTabId: targetAuthTabId
          })
        )
      } catch (error) {
        setStatus(`步骤 ${step.index} 执行异常`)
        log.error(
          `步骤 ${step.index} 异常：${
            error instanceof Error ? error.message : "后台脚本未响应"
          }`
        )
        return
      }

      if (!result.ok) {
        setStatus(`步骤 ${step.index} 执行失败`)
        log.warn(`步骤 ${step.index} ${result.message}`)
        return
      }

      setStatus(`步骤 ${step.index} 已完成`)
      if (step.persistResultTab) {
        persistAuthTab(result.targetTab)
      }
      log.info(`步骤 ${step.index} ${result.message}`)
    } catch (error) {
      setStatus(`步骤 ${step.index} 执行异常`)
      log.error(
        `步骤 ${step.index} 异常：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
    } finally {
      setRunningStep(null)
    }
  }

  /**
   * 清空当前会话的日志列表。
   *
   * @return 无。
   */
  const handleClearLogs = () => {
    setLogs([])
    setStatus("日志已清空")
  }

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 8,
          colorPrimary: "#1677ff",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}>
      <main className="sidepanel-shell">
        <header className="panel-header">
          <div className="brand-block">
            <h1 className="brand-title">codex-login</h1>
            <p className="brand-subtitle">单账号登录助手</p>
          </div>
          <Tag color="processing">{status}</Tag>
        </header>

        <section className="panel-stack">
          <Card className="panel-card" title="登录信息">
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onValuesChange={handleValuesChange}>
              <Form.Item
                label="Codex 登录地址"
                name="loginUrl"
                rules={[{ required: true, message: "请输入 Codex 登录地址" }]}>
                <Input placeholder="https://..." allowClear />
              </Form.Item>

              <Form.Item
                label="2925 邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入 2925 邮箱" },
                  { type: "email", message: "邮箱格式不正确" }
                ]}>
                <Input placeholder="name@example.com" allowClear />
              </Form.Item>

              <Form.Item
                label="邮箱密码"
                name="password"
                rules={[{ required: true, message: "请输入邮箱密码" }]}>
                <Input.Password placeholder="请输入密码" />
              </Form.Item>
            </Form>
          </Card>

          <Card className="panel-card" title="执行步骤">
            <div className="step-list">
              {LOGIN_STEPS.map((step) => {
                return (
                  <div className="step-row" key={step.id}>
                    <div className="step-copy">
                      <span className="step-index">步骤 {step.index}</span>
                      <span className="step-title">{step.title}</span>
                    </div>
                    <Button
                      type="primary"
                      loading={runningStep === step.id}
                      onClick={() => {
                        void executeLoginStep(step)
                      }}>
                      执行
                    </Button>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card
            className="panel-card"
            title="执行日志"
            extra={
              <Button size="small" onClick={handleClearLogs}>
                清空
              </Button>
            }>
            {logs.length > 0 ? (
              <div className="log-list" ref={logListRef}>
                {logs.map((log) => {
                  const levelMeta = LOG_LEVEL_META[log.level]
                  return (
                    <div className="log-row" key={log.id}>
                      <span className="log-time">{log.time}</span>
                      <span className="log-content">
                        <Tag
                          className="log-level-tag"
                          color={levelMeta.color}
                          bordered={false}>
                          {levelMeta.label}
                        </Tag>
                        <span className="log-message">{log.message}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Typography.Text type="secondary">暂无日志</Typography.Text>
                }
              />
            )}
          </Card>

          <Space size={8} wrap>
            <Tag>本地保存</Tag>
            <Tag>单账号</Tag>
            <Tag>界面优先</Tag>
          </Space>
        </section>
      </main>
    </ConfigProvider>
  )
}

export default SidePanel
