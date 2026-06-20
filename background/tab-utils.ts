type WaitForNewMatchingTabOptions = {
  timeoutMs?: number
  intervalMs?: number
}

/**
 * 把延迟封装成 Promise，方便在 async 流程里等待一小段时间。
 *
 * @param timeoutMs 需要等待的时间，单位毫秒。
 * @return 一个在指定时间后 resolve 的 Promise。
 */
const waitForDelay = (timeoutMs: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

/**
 * 等待指定标签页加载完成。
 *
 * 如果页面一直没有 complete，也会在超时后放行，避免整个登录流程因为
 * 页面加载事件异常而永久卡住。
 *
 * @param tabId 要等待的 Chrome 标签页 id
 * @param timeoutMs 最大等待时间，单位毫秒
 * @return 等待完成后 resolve 的 Promise。
 */
export const waitForTabLoaded = (tabId: number, timeoutMs = 15000) => {
  return new Promise<void>((resolve) => {
    let done = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // 页面加载完成和超时都会走这里；done 用来保证只收尾一次。
    const cleanup = () => {
      if (done) {
        return
      }

      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      chrome.tabs.onRemoved.removeListener(onRemoved)

      // 如果是页面先加载完成，需要取消兜底超时定时器。
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      resolve()
    }

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      // Chrome 里可能有多个标签页同时变化，只响应当前流程打开的 tab。
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup()
      }
    }

    const onRemoved = (removedTabId: number) => {
      // 用户或浏览器关闭目标标签页时，也要释放当前等待流程里的监听器。
      if (removedTabId === tabId) {
        cleanup()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.onRemoved.addListener(onRemoved)
    timeoutId = setTimeout(cleanup, timeoutMs)

    // 处理添加监听前页面已经加载完成的情况；先注册监听再检查，可减少竞态。
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          cleanup()
        }
      })
      .catch(() => {
        cleanup()
      })
  })
}

/**
 * 收集当前已经存在的标签页 id。
 *
 * 常用于点击页面按钮前做快照，之后再判断是否出现了新的目标标签页。
 *
 * @return 当前浏览器所有已有标签页 id。
 */
export const collectCurrentTabIds = async () => {
  const tabs = await chrome.tabs.query({})

  return new Set(
    tabs
      .map((tab) => {
        return tab.id
      })
      .filter((tabId): tabId is number => {
        return typeof tabId === "number"
      })
  )
}

/**
 * 在当前标签页列表中查找一个新出现且符合条件的标签页。
 *
 * @param beforeTabIds 操作前已经存在的标签页 id 集合。
 * @param matcher 业务侧传入的标签页匹配规则。
 * @return 找到时返回标签页，否则返回 undefined。
 */
export const findNewMatchingTab = async (
  beforeTabIds: Set<number>,
  matcher: (tab: chrome.tabs.Tab) => boolean
) => {
  const tabs = await chrome.tabs.query({})

  return tabs.find((tab) => {
    return Boolean(tab.id) && !beforeTabIds.has(tab.id) && matcher(tab)
  })
}

/**
 * 在指定时间内轮询，等待一个新出现且符合条件的标签页。
 *
 * @param beforeTabIds 操作前已经存在的标签页 id 集合。
 * @param matcher 业务侧传入的标签页匹配规则。
 * @param options 等待超时和轮询间隔配置。
 * @return 如果检测到目标新标签页则返回该标签页，否则返回 undefined。
 */
export const waitForNewMatchingTab = async (
  beforeTabIds: Set<number>,
  matcher: (tab: chrome.tabs.Tab) => boolean,
  options: WaitForNewMatchingTabOptions = {}
) => {
  const timeoutMs = options.timeoutMs ?? 3000
  const intervalMs = options.intervalMs ?? 250
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const matchedTab = await findNewMatchingTab(beforeTabIds, matcher)
    if (matchedTab) {
      return matchedTab
    }

    await waitForDelay(intervalMs)
  }

  return undefined
}

/**
 * 生成用于匹配标签页的基础 URL。
 *
 * 这里只使用 origin + pathname，故意忽略 hash。这样 /management.html#/login
 * 和 /management.html#/oauth 会被认为是同一个管理页。
 *
 * @param value 原始 URL 字符串
 * @return 用于匹配标签页的基础 URL。
 */
export const normalizeUrlForTabMatch = (value: string) => {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}

/**
 * 打开或复用 Codex 管理页。
 *
 * 优先复用已经打开的管理页；找不到时才新开标签页。返回的 tabId 会被
 * chrome.scripting.executeScript 用来指定脚本注入目标。
 *
 * @param loginUrl 侧边栏里填写的 Codex 登录地址
 * @return 可以注入脚本的 Chrome 标签页 id。
 */
export const findOrOpenTab = async (loginUrl: string) => {
  const targetBaseUrl = normalizeUrlForTabMatch(loginUrl)
  const tabs = await chrome.tabs.query({})
  const matchedTab = tabs.find((tab) => {
    if (!tab.url) {
      return false
    }

    try {
      return normalizeUrlForTabMatch(tab.url) === targetBaseUrl
    } catch {
      return false
    }
  })

  if (matchedTab?.id) {
    await chrome.tabs.update(matchedTab.id, { active: true, url: loginUrl })
    await waitForTabLoaded(matchedTab.id)
    return matchedTab.id
  }

  const tab = await chrome.tabs.create({ active: true, url: loginUrl })
  if (!tab.id) {
    throw new Error("无法打开 Codex 管理页面")
  }

  await waitForTabLoaded(tab.id)
  return tab.id
}
