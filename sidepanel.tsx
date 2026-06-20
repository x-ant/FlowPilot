import { useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  theme
} from "antd"
import zhCN from "antd/locale/zh_CN"
import "antd/dist/reset.css"

import "./sidepanel.css"
import {
  LOG_LEVEL_META,
  createUiLogger,
  getTimeLabel,
  type LogItem
} from "./shared/logging"
import type { BackgroundResponse } from "./background/types"

type Settings = {
  loginUrl?: string
  email?: string
  password?: string
}

type AuthTabSnapshot = {
  id?: number
  url?: string
  updatedAt?: number
}

type Stats = {
  total: number
  success: number
  failed: number
}

type CodexLoginMessageType =
  | "codex-login:start"
  | "codex-login:open-auth-link"
  | "codex-login:fill-auth-email"
  | "codex-login:fill-auth-code"

type CodexLoginPayload =
  | {
      targetUrl: string
    }
  | {
      tabId: number
      email: string
    }
  | {
      tabId: number
      email: string
      password: string
    }

const STORAGE_KEY = "codex-login:settings"
const AUTH_TAB_STORAGE_KEY = "codex-login:auth-tab"
const STEP_CLICK_CODEX_LOGIN = "click-codex-login"
const STEP_OPEN_AUTH_LINK = "open-auth-link"
const STEP_FILL_AUTH_EMAIL = "fill-auth-email"
const STEP_FILL_AUTH_CODE = "fill-auth-code"

const initialStats: Stats = {
  total: 0,
  success: 0,
  failed: 0
}

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
 * 对邮箱做简单脱敏，方便在日志里展示但不直接暴露完整账号。
 *
 * @param email 原始邮箱地址。
 * @return 脱敏后的邮箱字符串；如果没有传入邮箱则返回“未填写账号”。
 */
const maskEmail = (email?: string) => {
  if (!email) {
    return "未填写账号"
  }

  const [name, domain] = email.split("@")
  if (!domain) {
    return email
  }

  const visibleName = name.slice(0, 3)
  return `${visibleName}${name.length > 3 ? "***" : "*"}@${domain}`
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
 * 向后台发送通用的 Codex 登录控制消息。
 *
 * 这个方法把侧边栏和 background 的消息协议统一封装起来，避免重复写 sendMessage。
 *
 * @param type 要发送的消息类型。
 * @param targetUrl 当前要操作的页面地址。
 * @return 后台返回的执行结果；如果消息通道异常，会直接 reject。
 */
const sendCodexLoginMessage = (
  type: CodexLoginMessageType,
  payload: CodexLoginPayload
) => {
  return new Promise<BackgroundResponse>((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("当前环境无法调用 Chrome 扩展后台脚本"))
      return
    }

    chrome.runtime.sendMessage(
      {
        type,
        payload
      },
      (response?: BackgroundResponse) => {
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
      }
    )
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
  const [stats, setStats] = useState(initialStats)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [authTabId, setAuthTabId] = useState<number | null>(null)
  const [runningStep, setRunningStep] = useState<string | null>(null)
  const logListRef = useRef<HTMLDivElement | null>(null)

  const storage = useMemo(getStorage, [])
  const log = createUiLogger((level, message) => {
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
    const nextTabId =
      typeof targetTab?.id === "number" ? targetTab.id : null

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
   * 执行步骤 1：点击“开始 codex 登录”按钮。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleClickCodexLoginStep = async () => {
    try {
      setRunningStep(STEP_CLICK_CODEX_LOGIN)
      const values = await form.validateFields(["loginUrl"]).catch((error) => {
        setStatus("步骤 1 需要登录地址")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn(
          `步骤 1 参数异常：${
            error instanceof Error ? error.message : "Codex 登录地址不能为空"
          }`
        )
        return null
      })

      if (!values) {
        return
      }

      const loginUrl = values.loginUrl?.trim()

      if (!loginUrl) {
        setStatus("步骤 1 需要登录地址")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 1 参数异常：Codex 登录地址不能为空")
        return
      }

      setStatus("正在打开 Codex 管理页")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      log.debug("步骤 1 准备点击“开始codex登录”按钮")

      let result: BackgroundResponse
      try {
        result = await sendCodexLoginMessage("codex-login:start", {
          targetUrl: loginUrl
        })
      } catch (error) {
        setStatus("步骤 1 执行异常")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.error(
          `步骤 1 异常：${
            error instanceof Error ? error.message : "后台脚本未响应"
          }`
        )
        return
      }

      if (!result.ok) {
        setStatus("步骤 1 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.warn(`步骤 1 ${result.message}`)
        return
      }

      setStatus("步骤 1 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      log.info(`步骤 1 ${result.message}`)
    } catch (error) {
      setStatus("步骤 1 执行异常")
      setStats((current) => {
        return {
          ...current,
          failed: current.failed + 1
        }
      })
      log.error(`步骤 1 异常：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setRunningStep(null)
    }
  }

  /**
   * 执行步骤 2：先清理旧 cookie，再打开 OpenAI 登录页。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleOpenAuthLinkStep = async () => {
    try {
      setRunningStep(STEP_OPEN_AUTH_LINK)
      persistAuthTab()
      const values = await form.validateFields(["loginUrl"]).catch((error) => {
        setStatus("步骤 2 需要登录地址")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn(
          `步骤 2 参数异常：${
            error instanceof Error ? error.message : "Codex 登录地址不能为空"
          }`
        )
        return null
      })

      if (!values) {
        return
      }

      const loginUrl = values.loginUrl?.trim()

      if (!loginUrl) {
        setStatus("步骤 2 需要登录地址")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 2 参数异常：Codex 登录地址不能为空")
        return
      }

      setStatus("正在清理旧登录信息并打开登录页")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      log.debug("步骤 2 准备清理旧登录信息并打开 OpenAI 登录页")

      let result: BackgroundResponse
      try {
        result = await sendCodexLoginMessage("codex-login:open-auth-link", {
          targetUrl: loginUrl
        })
      } catch (error) {
        setStatus("步骤 2 执行异常")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.error(
          `步骤 2 异常：${
            error instanceof Error ? error.message : "后台脚本未响应"
          }`
        )
        return
      }

      if (!result.ok) {
        setStatus("步骤 2 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.warn(`步骤 2 ${result.message}`)
        return
      }

      setStatus("步骤 2 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      persistAuthTab(result.targetTab)
      log.info(`步骤 2 ${result.message}`)
    } catch (error) {
      setStatus("步骤 2 执行异常")
      setStats((current) => {
        return {
          ...current,
          failed: current.failed + 1
        }
      })
      log.error(`步骤 2 异常：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setRunningStep(null)
    }
  }

  /**
   * 执行步骤 3：填写邮箱并点击继续。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleFillAuthEmailStep = async () => {
    try {
      setRunningStep(STEP_FILL_AUTH_EMAIL)
      const values = await form.validateFields(["email"]).catch((error) => {
        setStatus("步骤 3 需要先执行步骤 2 并填写邮箱")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn(
          `步骤 3 参数异常：${
            error instanceof Error ? error.message : "2925 邮箱不能为空"
          }`
        )
        return null
      })

      if (!values) {
        return
      }

      const email = values.email?.trim()

      const targetAuthTabId = await resolveAuthTabId()
      if (!targetAuthTabId) {
        setStatus("步骤 3 需要先执行步骤 2")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 3 参数异常：请先执行步骤 2 打开 OpenAI 登录页")
        return
      }

      if (!email) {
        setStatus("步骤 3 需要先执行步骤 2 并填写邮箱")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 3 参数异常：2925 邮箱不能为空")
        return
      }

      setStatus("正在填写邮箱并继续")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      log.debug("步骤 3 准备填写邮箱并点击“继续”")

      let result: BackgroundResponse
      try {
        result = await sendCodexLoginMessage("codex-login:fill-auth-email", {
          tabId: targetAuthTabId,
          email
        })
      } catch (error) {
        setStatus("步骤 3 执行异常")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.error(
          `步骤 3 异常：${
            error instanceof Error ? error.message : "后台脚本未响应"
          }`
        )
        return
      }

      if (!result.ok) {
        setStatus("步骤 3 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.warn(`步骤 3 ${result.message}`)
        return
      }

      setStatus("步骤 3 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      persistAuthTab(result.targetTab)
      log.info(`步骤 3 ${result.message}`)
    } catch (error) {
      setStatus("步骤 3 执行异常")
      setStats((current) => {
        return {
          ...current,
          failed: current.failed + 1
        }
      })
      log.error(`步骤 3 异常：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setRunningStep(null)
    }
  }

  /**
   * 执行步骤 4：读取 2925 验证码并回填到当前验证码页。
   *
   * @return 无，执行结果通过状态、统计和日志反馈。
   */
  const handleFillAuthCodeStep = async () => {
    try {
      setRunningStep(STEP_FILL_AUTH_CODE)
      const values = await form.validateFields(["email", "password"]).catch((error) => {
        setStatus("步骤 4 需要先执行步骤 2/3 并填写账号密码")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn(
          `步骤 4 参数异常：${
            error instanceof Error ? error.message : "2925 邮箱和密码不能为空"
          }`
        )
        return null
      })

      if (!values) {
        return
      }

      const targetAuthTabId = await resolveAuthTabId()
      if (!targetAuthTabId) {
        setStatus("步骤 4 需要先执行步骤 2 和步骤 3")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 4 参数异常：请先执行步骤 2 和步骤 3 打开邮箱验证码页")
        return
      }

      const email = values.email?.trim()
      const password = String(values.password || "")

      if (!email || !password) {
        setStatus("步骤 4 需要先执行步骤 2/3 并填写账号密码")
        setStats((current) => {
          return {
            ...current,
            total: current.total + 1,
            failed: current.failed + 1
          }
        })
        log.warn("步骤 4 参数异常：2925 邮箱和密码不能为空")
        return
      }

      setStatus("正在读取 2925 验证码并回填")
      setStats((current) => {
        return {
          ...current,
          total: current.total + 1
        }
      })
      log.debug("步骤 4 准备读取 2925 验证码并回填到邮箱验证码页")

      let result: BackgroundResponse
      try {
        result = await sendCodexLoginMessage("codex-login:fill-auth-code", {
          tabId: targetAuthTabId,
          email,
          password
        })
      } catch (error) {
        setStatus("步骤 4 执行异常")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.error(
          `步骤 4 异常：${
            error instanceof Error ? error.message : "后台脚本未响应"
          }`
        )
        return
      }

      if (!result.ok) {
        setStatus("步骤 4 执行失败")
        setStats((current) => {
          return {
            ...current,
            failed: current.failed + 1
          }
        })
        log.warn(`步骤 4 ${result.message}`)
        return
      }

      setStatus("步骤 4 已完成")
      setStats((current) => {
        return {
          ...current,
          success: current.success + 1
        }
      })
      persistAuthTab(result.targetTab)
      log.info(`步骤 4 ${result.message}`)
    } catch (error) {
      setStatus("步骤 4 执行异常")
      setStats((current) => {
        return {
          ...current,
          failed: current.failed + 1
        }
      })
      log.error(`步骤 4 异常：${error instanceof Error ? error.message : "未知错误"}`)
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
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 1</span>
                  <span className="step-title">点击开始codex登录</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_CLICK_CODEX_LOGIN}
                  onClick={handleClickCodexLoginStep}>
                  执行
                </Button>
              </div>
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 2</span>
                  <span className="step-title">打开登录页</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_OPEN_AUTH_LINK}
                  onClick={handleOpenAuthLinkStep}>
                  执行
                </Button>
              </div>
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 3</span>
                  <span className="step-title">填写邮箱并继续</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_FILL_AUTH_EMAIL}
                  onClick={handleFillAuthEmailStep}>
                  执行
                </Button>
              </div>
              <div className="step-row">
                <div className="step-copy">
                  <span className="step-index">步骤 4</span>
                  <span className="step-title">读取验证码并回填</span>
                </div>
                <Button
                  type="primary"
                  loading={runningStep === STEP_FILL_AUTH_CODE}
                  onClick={handleFillAuthCodeStep}>
                  执行
                </Button>
              </div>
            </div>
          </Card>

          <Card className="panel-card" title="执行统计">
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">执行次数</span>
                <span className="stat-value">{stats.total}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">成功</span>
                <span className="stat-value">{stats.success}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">失败</span>
                <span className="stat-value">{stats.failed}</span>
              </div>
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
