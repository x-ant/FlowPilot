import type { UiLogger } from "../../shared/logging"

export type FlowPage = "codex-login" | "codex-register"

export type PageProps = {
  log: UiLogger
  setStatus: (status: string) => void
  onBusyChange?: (busy: boolean) => void
}

export const ACTIVE_PAGE_STORAGE_KEY = "codex-login:active-page"

export const FLOW_PAGE_ITEMS: Array<{ key: FlowPage; label: string }> = [
  {
    key: "codex-login",
    label: "codex-login"
  },
  {
    key: "codex-register",
    label: "codex-register"
  }
]
