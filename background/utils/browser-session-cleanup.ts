import { raceWithAbort, throwIfAborted } from "./abort"
import { waitForTabLoaded } from "./tab-utils"

type ClearSiteStorageOptions = {
  timeoutMs?: number
  abortSignal?: AbortSignal
}

const DEFAULT_CLEAR_SITE_STORAGE_TIMEOUT_MS = 30000

/**
 * 从 URL 中提取 hostname。
 * 例如 https://chatgpt.com/ 提取出来就是 chatgpt.com。
 * hostname 只包含域名，不包含 https:// 这样的协议，也不包含 /login 这样的路径。
 *
 * @param rawUrl 原始 URL。
 * @return hostname；URL 无法解析时返回空字符串。
 */
const normalizeHostname = (rawUrl?: string) => {
  try {
    return new URL(String(rawUrl || "")).hostname.toLowerCase()
  } catch {
    return ""
  }
}

/**
 * 把一组 URL 转成去重后的 hostname 列表。
 * 例如 ["https://chatgpt.com/", "https://chatgpt.com/login"] 会得到 ["chatgpt.com"]。
 * 这样同一个网站的不同路径只会清理一次。
 *
 * @param urls 需要参与清理匹配的 URL 列表。
 * @return 去重后的 hostname 列表。
 */
const normalizeUrlListHostnames = (urls: string[]) => {
  return Array.from(
    new Set(
      urls
        .map((url) => normalizeHostname(url))
        .filter((hostname) => Boolean(hostname))
    )
  )
}

/**
 * 从 URL 列表推导 cookie 清理域名。
 *
 * cookie 通常挂在根域上，例如 auth.openai.com 的 cookie domain 可能是
 * .openai.com，所以这里会把多级子域收敛到后两段域名。
 * 例如 https://auth.openai.com/ 会推导出 openai.com；
 * https://chatgpt.com/ 仍然是 chatgpt.com。
 *
 * @param urls 需要参与清理匹配的 URL 列表。
 * @return 去重后的 cookie 域名列表。
 */
const getCookieDomainsFromUrls = (urls: string[]) => {
  return Array.from(
    new Set(
      normalizeUrlListHostnames(urls).map((hostname) => {
        const parts = hostname.split(".").filter(Boolean)
        return parts.length > 2 ? parts.slice(-2).join(".") : hostname
      })
    )
  )
}

/**
 * 判断指定 tab URL 是否属于需要清理 storage 的 URL 列表。
 *
 * localStorage/sessionStorage 是按 origin 隔离的。origin 可以理解成
 * “协议 + 域名 + 端口”，例如 https://chatgpt.com/chat 的 origin 是
 * https://chatgpt.com；https://auth.openai.com/ 的 origin 是
 * https://auth.openai.com。
 *
 * 因为 auth.openai.com 和 openai.com 是不同 origin，清 openai.com 页面
 * 不会清掉 auth.openai.com 的 storage，所以这里按完整 hostname 匹配，
 * 不像 cookie 那样向根域 openai.com 收敛。
 *
 * @param rawUrl tab 当前 URL。
 * @param urls 需要清理 storage 的 URL 列表。
 * @return 如果 hostname 命中则返回 true。
 */
const isSiteStorageUrl = (rawUrl: string | undefined, urls: string[]) => {
  const hostname = normalizeHostname(rawUrl)
  return Boolean(hostname) && normalizeUrlListHostnames(urls).includes(hostname)
}

/**
 * 规范化 cookie domain，去掉前导点并转小写。
 * 例如 .OpenAI.com 会变成 openai.com。
 *
 * @param domain Chrome cookie domain。
 * @return 规范化后的 domain。
 */
const normalizeCookieDomainForMatch = (domain?: string) => {
  return String(domain || "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase()
}

/**
 * 判断 cookie 是否属于待清理 URL 推导出来的域名。
 * 例如 cleanupUrls 包含 https://chatgpt.com/ 时，chatgpt.com 和
 * www.chatgpt.com 下的 cookie 都会命中。
 *
 * @param cookie Chrome cookie 对象。
 * @param urls 需要清理 cookie 的 URL 列表。
 * @return 命中清理范围时返回 true。
 */
const shouldClearSessionCookie = (
  cookie: chrome.cookies.Cookie,
  urls: string[]
) => {
  const domain = normalizeCookieDomainForMatch(cookie?.domain)

  if (!domain) {
    return false
  }

  return getCookieDomainsFromUrls(urls).some((targetDomain) => {
    return domain === targetDomain || domain.endsWith(`.${targetDomain}`)
  })
}

/**
 * 构造删除 cookie 时需要传给 chrome.cookies.remove 的 URL。
 *
 * Chrome 删除 cookie 时要求提供能访问该 cookie 的 URL，所以需要由
 * cookie domain 和 path 反推一个 https URL。
 * 例如 domain=.chatgpt.com、path=/ 会反推出 https://chatgpt.com/。
 *
 * @param cookie Chrome cookie 对象。
 * @return 用于删除 cookie 的 URL。
 */
const buildCookieRemovalUrl = (cookie: chrome.cookies.Cookie) => {
  const host = normalizeCookieDomainForMatch(cookie?.domain)
  const path = String(cookie?.path || "/").startsWith("/")
    ? String(cookie?.path || "/")
    : `/${String(cookie?.path || "")}`

  return `https://${host}${path}`
}

/**
 * 给 best-effort 清理动作加超时保护。
 *
 * storage 清理只是注册/登录前的辅助动作，页面处于半加载或休眠恢复异常时，
 * 不能让它无限阻塞主流程。
 *
 * @param promise 待保护的异步动作。
 * @param timeoutMs 超时时间，单位毫秒。
 * @param timeoutMessage 超时错误文案。
 * @return 原动作结果。
 */
const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * 收集所有 cookie store 中命中指定 URL 范围的 cookie。
 *
 * Chrome 可能有多个 cookie store，同一个 cookie 也可能从不同查询路径出现，
 * 所以这里按 store/domain/path/name 去重。
 * 例如传入 https://chatgpt.com/，会收集 chatgpt.com 及其子域下的 cookie。
 *
 * @param urls 需要清理 cookie 的 URL 列表。
 * @return 命中的 cookie 列表。
 */
const collectSessionCookiesForUrls = async (urls: string[]) => {
  if (!chrome.cookies?.getAll) {
    return []
  }

  const stores = chrome.cookies.getAllCookieStores
    ? await chrome.cookies.getAllCookieStores()
    : [{ id: undefined }]
  const cookies: chrome.cookies.Cookie[] = []
  const seen = new Set<string>()

  for (const store of stores) {
    const storeId = store?.id
    const batch = await chrome.cookies.getAll(storeId ? { storeId } : {})

    for (const cookie of batch || []) {
      if (!shouldClearSessionCookie(cookie, urls)) {
        continue
      }

      const key = [
        cookie.storeId || storeId || "",
        cookie.domain || "",
        cookie.path || "",
        cookie.name || "",
        JSON.stringify(
          (cookie as { partitionKey?: unknown }).partitionKey || ""
        )
      ].join("|")

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      cookies.push(cookie)
    }
  }

  return cookies
}

/**
 * 删除单个 cookie。
 * 例如删除名为 session、domain 为 .chatgpt.com 的 cookie。
 *
 * @param cookie 要删除的 Chrome cookie。
 * @return 删除成功返回 true；浏览器不支持或删除失败时返回 false。
 */
const removeSessionCookie = async (cookie: chrome.cookies.Cookie) => {
  // 没有remove这个api就直接返回
  if (!chrome.cookies?.remove) {
    return false
  }

  // 这个对象的类型是交叉类型，同时满足两者
  const details: chrome.cookies.Details & { partitionKey?: unknown } = {
    url: buildCookieRemovalUrl(cookie),
    name: cookie.name
  }

  if (cookie.storeId) {
    details.storeId = cookie.storeId
  }

  // 如果有就把这个也加上
  const partitionKey = (cookie as { partitionKey?: unknown }).partitionKey
  if (partitionKey) {
    details.partitionKey = partitionKey
  }

  try {
    return Boolean(await chrome.cookies.remove(details))
  } catch {
    return false
  }
}

/**
 * 清理一组 URL 对应域名下的 session cookie。
 * 例如传入 ["https://chatgpt.com/"] 会清理 chatgpt.com 及其子域 cookie。
 *
 * @param urls 需要清理 cookie 的 URL 列表。
 * @return 清理结果和可直接展示的提示信息。
 */
export const clearSessionCookiesForUrls = async (urls: string[]) => {
  if (!chrome.cookies?.getAll || !chrome.cookies?.remove) {
    return {
      ok: false,
      removedCount: 0,
      message: "当前浏览器不支持 cookies API，已跳过旧登录信息清理"
    }
  }

  const cookies = await collectSessionCookiesForUrls(urls)
  let removedCount = 0

  for (const cookie of cookies) {
    if (await removeSessionCookie(cookie)) {
      removedCount += 1
    }
  }

  return {
    ok: true,
    removedCount,
    message:
      removedCount > 0
        ? `已清理 ${removedCount} 个旧登录 cookie`
        : "未发现可清理的旧登录 cookie"
  }
}

/**
 * 清理指定 tab 当前 origin 的站点存储。
 *
 * localStorage、sessionStorage、IndexedDB、Cache Storage 必须要打开界面
 * 注入清理逻辑才能执行；cookies 则不需要，所以没有 clearCookiesInTab。
 *
 * chrome.scripting.executeScript 需要页面可注入，所以这里会先等待页面 loaded。
 * 例如 tab 当前打开 https://chatgpt.com/，这里清的就是
 * https://chatgpt.com 这个 origin 下的站点存储。
 *
 * @param tabId 需要清理 storage 的 tab id。
 * @return 清理前 localStorage/sessionStorage/IndexedDB/Cache Storage 的数量。
 */
const clearSiteStorageInTabUnsafe = async (tabId: number) => {
  await waitForTabLoaded(tabId)
  const [storageInjectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const localCount = window.localStorage?.length || 0
      const sessionCount = window.sessionStorage?.length || 0
      let indexedDbCount = 0
      let cacheCount = 0

      try {
        window.localStorage?.clear()
      } catch {
        // Best effort only.
      }

      try {
        window.sessionStorage?.clear()
      } catch {
        // Best effort only.
      }

      try {
        const indexedDbFactory = window.indexedDB as IDBFactory & {
          databases?: () => Promise<Array<{ name?: string }>>
        }
        const databases = indexedDbFactory.databases
          ? await indexedDbFactory.databases()
          : []
        const databaseNames = databases
          .map((database) => database.name || "")
          .filter(Boolean)

        for (const databaseName of databaseNames) {
          const deleted = await new Promise<boolean>((resolve) => {
            const request = indexedDbFactory.deleteDatabase(databaseName)

            request.onsuccess = () => resolve(true)
            request.onerror = () => resolve(false)
            request.onblocked = () => resolve(false)
          })

          if (deleted) {
            indexedDbCount += 1
          }
        }
      } catch {
        // Best effort only.
      }

      try {
        if (window.caches) {
          const cacheKeys = await window.caches.keys()
          cacheCount = cacheKeys.length
          await Promise.all(
            cacheKeys.map((cacheKey) => {
              return window.caches.delete(cacheKey).catch(() => false)
            })
          )
        }
      } catch {
        // Best effort only.
      }

      return {
        localCount,
        sessionCount,
        indexedDbCount,
        cacheCount
      }
    }
  })

  const value = storageInjectionResult?.result as
    | {
        localCount?: number
        sessionCount?: number
        indexedDbCount?: number
        cacheCount?: number
      }
    | undefined

  return {
    localCount: Number(value?.localCount || 0),
    sessionCount: Number(value?.sessionCount || 0),
    indexedDbCount: Number(value?.indexedDbCount || 0),
    cacheCount: Number(value?.cacheCount || 0)
  }
}

/**
 * 清理指定 tab 当前 origin 的站点存储，并避免异常页面无限阻塞。
 *
 * @param tabId 需要清理 storage 的 tab id。
 * @param options 清理控制选项。
 * @param options.timeoutMs 单个 tab 清理最长等待时间。
 * @param options.abortSignal 外部流程停止信号。
 * @return 清理前 localStorage/sessionStorage/IndexedDB/Cache Storage 的数量。
 */
export const clearSiteStorageInTab = async (
  tabId: number,
  options: ClearSiteStorageOptions = {}
) => {
  const timeoutMs = options.timeoutMs || DEFAULT_CLEAR_SITE_STORAGE_TIMEOUT_MS
  return raceWithAbort(
    withTimeout(
      clearSiteStorageInTabUnsafe(tabId),
      timeoutMs,
      `清理当前页面站点存储超时（${Math.round(timeoutMs / 1000)} 秒）`
    ),
    options.abortSignal
  )
}

/**
 * 清理当前已打开 tab 中命中 URL 列表的站点存储。
 *
 * 这个函数只处理已经打开的页面；如果调用方随后新开了目标页面，还应该对
 * 新 tab 再调用一次 clearSiteStorageInTab。
 * 例如传入 ["https://chatgpt.com/"] 时，只会清理当前已经打开且 hostname
 * 是 chatgpt.com 的 tab。
 *
 * @param urls 需要清理 storage 的 URL 列表。
 * @param options 可选流程操作
 * @return 清理结果和可直接展示的提示信息。
 */
export const clearOpenTabSiteStorageForUrls = async (
  urls: string[],
  options: ClearSiteStorageOptions = {}
) => {
  const tabs = await chrome.tabs.query({})
  const targetTabs = tabs.filter((tab) => {
    return Boolean(tab.id) && isSiteStorageUrl(tab.url, urls)
  })

  let clearedTabCount = 0
  let localCount = 0
  let sessionCount = 0
  let indexedDbCount = 0
  let cacheCount = 0

  for (const tab of targetTabs) {
    throwIfAborted(options.abortSignal)

    if (!tab.id) {
      continue
    }

    try {
      const result = await clearSiteStorageInTab(tab.id, options)
      localCount += result.localCount
      sessionCount += result.sessionCount
      indexedDbCount += result.indexedDbCount
      cacheCount += result.cacheCount
      clearedTabCount += 1
    } catch {
      throwIfAborted(options.abortSignal)
      // Best effort only.
    }
  }

  return {
    clearedTabCount,
    localCount,
    sessionCount,
    indexedDbCount,
    cacheCount,
    message:
      clearedTabCount > 0
        ? `已清理 ${clearedTabCount} 个页面的站点存储`
        : "未发现可清理的站点存储"
  }
}
