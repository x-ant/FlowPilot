import { afterEach, describe, expect, it, vi } from "vitest"

import {
  sendRuntimeMessage,
  sendRuntimeMessageResponse
} from "../../platform/chrome/runtime-messaging"
import { RUNTIME_MESSAGE_TYPES } from "../../shared/runtime-messages"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Chrome runtime messaging adapter", () => {
  it("在 Chrome runtime 不可用时返回清晰错误", async () => {
    vi.stubGlobal("chrome", undefined)

    await expect(
      sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerRunStatus
      })
    ).rejects.toThrow("Chrome runtime API 不可用")
  })

  it("发送请求并返回对应响应", async () => {
    const response = {
      ok: true as const,
      lock: null,
      activeInMemory: false,
      stale: false
    }
    const sendMessage = vi.fn(
      (_message: unknown, callback: (value: typeof response) => void) => {
        callback(response)
      }
    )
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        lastError: undefined
      }
    })

    await expect(
      sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerRunStatus
      })
    ).resolves.toEqual(response)
    expect(sendMessage).toHaveBeenCalledWith(
      { type: RUNTIME_MESSAGE_TYPES.registerRunStatus },
      expect.any(Function)
    )
  })

  it("把 chrome.runtime.lastError 转成 Promise 异常", async () => {
    const runtime = {
      lastError: { message: "Receiving end does not exist" },
      sendMessage: vi.fn((_message: unknown, callback: () => void) => {
        callback()
      })
    }
    vi.stubGlobal("chrome", { runtime })

    await expect(
      sendRuntimeMessage({
        type: RUNTIME_MESSAGE_TYPES.registerClearRunLock
      })
    ).rejects.toThrow("Receiving end does not exist")
  })

  it("把监听器响应交给 Chrome sendResponse", () => {
    const sendResponse = vi.fn()

    sendRuntimeMessageResponse(
      sendResponse,
      RUNTIME_MESSAGE_TYPES.registerBatchStop,
      { ok: true, message: "停止请求已接收" }
    )

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      message: "停止请求已接收"
    })
  })
})
