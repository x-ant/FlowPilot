export type StartCodexLoginMessage = {
  type: "codex-login:start"
  payload: {
    loginUrl: string
  }
}

export type StartCodexLoginResponse = {
  ok: boolean
  message: string
  tabId?: number
  url?: string
}

export type ClickCodexLoginButtonResult = {
  ok: boolean
  message: string
  buttonText?: string
}

