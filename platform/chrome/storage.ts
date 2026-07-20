/**
 * 获取 Chrome 本地存储对象。
 *
 * 单元测试或普通网页环境可能没有 chrome.storage；调用方可以据此安全跳过持久化。
 */
export const getLocalStorage = (): chrome.storage.StorageArea | null => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  return chrome.storage.local
}

/**
 * 读取一组本地存储 key。
 *
 * 不存在 Chrome Storage 时返回空对象，保持页面纯函数测试可直接运行。
 */
export const readLocalStorage = async (keys: string[]) => {
  const storage = getLocalStorage()
  if (!storage) {
    return {}
  }

  return new Promise<Record<string, unknown>>((resolve) => {
    storage.get(keys, resolve)
  })
}

/**
 * 写入本地存储；不存在 Chrome Storage 时安全跳过。
 */
export const writeLocalStorage = async (items: Record<string, unknown>) => {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  return new Promise<void>((resolve) => {
    storage.set(items, () => {
      resolve()
    })
  })
}

/**
 * 删除指定本地存储 key；不存在 Chrome Storage 时安全跳过。
 */
export const removeLocalStorage = async (keys: string[]) => {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  return new Promise<void>((resolve) => {
    storage.remove(keys, () => {
      resolve()
    })
  })
}
