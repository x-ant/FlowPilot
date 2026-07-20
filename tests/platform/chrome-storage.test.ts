import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getLocalStorage,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage
} from "../../platform/chrome/storage"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Chrome local storage adapter", () => {
  it("在普通测试环境中安全跳过存储操作", async () => {
    vi.stubGlobal("chrome", undefined)

    expect(getLocalStorage()).toBeNull()
    await expect(readLocalStorage(["missing"])).resolves.toEqual({})
    await expect(writeLocalStorage({ key: "value" })).resolves.toBeUndefined()
    await expect(removeLocalStorage(["key"])).resolves.toBeUndefined()
  })

  it("把读取、写入和删除交给 chrome.storage.local", async () => {
    const get = vi.fn(
      (_keys: string[], callback: (items: Record<string, unknown>) => void) => {
        callback({ key: "stored-value" })
      }
    )
    const set = vi.fn(
      (_items: Record<string, unknown>, callback: () => void) => {
        callback()
      }
    )
    const remove = vi.fn((_keys: string[], callback: () => void) => {
      callback()
    })
    const local = { get, set, remove }
    vi.stubGlobal("chrome", {
      storage: { local }
    })

    expect(getLocalStorage()).toBe(local)
    await expect(readLocalStorage(["key"])).resolves.toEqual({
      key: "stored-value"
    })
    await writeLocalStorage({ key: "next-value" })
    await removeLocalStorage(["key"])

    expect(get).toHaveBeenCalledWith(["key"], expect.any(Function))
    expect(set).toHaveBeenCalledWith(
      { key: "next-value" },
      expect.any(Function)
    )
    expect(remove).toHaveBeenCalledWith(["key"], expect.any(Function))
  })
})
