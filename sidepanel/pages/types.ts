import type { UiLogger } from "../../shared/logging"

export type FlowPage = "flowpilot-login" | "flowpilot-register"

export type PageProps = {
  log: UiLogger
  setStatus: (status: string) => void
  onBusyChange?: (busy: boolean) => void
}

export const ACTIVE_PAGE_STORAGE_KEY = "flowpilot:active-page"

export const FLOW_PAGE_ITEMS: Array<{ key: FlowPage; label: string }> = [
  {
    key: "flowpilot-login",
    label: "登录流程"
  },
  {
    key: "flowpilot-register",
    label: "注册流程"
  }
]
