const FLOW_ABORTED_MESSAGE = "已停止当前流程"

export type AbortableOptions = {
  abortSignal?: AbortSignal
}

export const throwIfAborted = (abortSignal?: AbortSignal) => {
  if (abortSignal?.aborted) {
    throw new Error(FLOW_ABORTED_MESSAGE)
  }
}

export const abortableSleep = (
  milliseconds: number,
  abortSignal?: AbortSignal
) => {
  return new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId)
      }
      abortSignal?.removeEventListener("abort", onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new Error(FLOW_ABORTED_MESSAGE))
    }

    if (abortSignal?.aborted) {
      onAbort()
      return
    }

    timeoutId = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)
    abortSignal?.addEventListener("abort", onAbort, { once: true })
  })
}

export const raceWithAbort = async <T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal,
  onAbort?: () => void
) => {
  if (!abortSignal) {
    return promise
  }

  throwIfAborted(abortSignal)

  let abortListener: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => {
      onAbort?.()
      reject(new Error(FLOW_ABORTED_MESSAGE))
    }
    abortSignal.addEventListener("abort", abortListener, { once: true })
  })

  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (abortListener) {
      abortSignal.removeEventListener("abort", abortListener)
    }
  }
}
