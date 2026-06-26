export type RunContext = {
  activateTabs: boolean
  abortSignal?: AbortSignal
}

export const DEFAULT_RUN_CONTEXT: RunContext = {
  activateTabs: true
}
