import { describe, expect, it } from "vitest"

import type {
  ManagedAccount,
  RegisterRunLock
} from "../../shared/account-state"
import { validateRegisterBatchStart } from "../../sidepanel/register-task/register-batch-validation"

const createAccount = (
  id: string,
  patch: Partial<ManagedAccount> = {}
): ManagedAccount => {
  return {
    id,
    mailProvider: "2925",
    email: `${id}@example.test`,
    mailboxEmail: "",
    password: "",
    progress: 0,
    status: "idle",
    lastMessage: "",
    updatedAt: 1,
    ...patch
  }
}

const createRunLock = (): RegisterRunLock => {
  return {
    runId: "run-current",
    source: "manual",
    startedAt: 1,
    currentEmail: "account-1",
    message: "正在处理当前账号"
  }
}

type ValidationOptions = Parameters<typeof validateRegisterBatchStart>[0]

const createOptions = (
  patch: Partial<ValidationOptions> = {}
): ValidationOptions => {
  const account = createAccount("account-1")
  return {
    hasOAuthConfig: true,
    accounts: [account],
    isBatchRunning: false,
    registerRunLock: null,
    isDebugRunning: false,
    selectedAccountIds: [account.id],
    hasHeroSmsConfig: true,
    stepCount: 7,
    ...patch
  }
}

describe("register batch validation", () => {
  it("优先提示 OAuth 配置不完整", () => {
    expect(
      validateRegisterBatchStart(
        createOptions({ hasOAuthConfig: false, accounts: [] })
      )
    ).toMatchObject({
      ok: false,
      reason: "missing_oauth_config",
      statusMessage: "请先完善 OAuth 接入配置",
      log: { level: "warn", message: "OAuth 接入配置不完整" }
    })
  })

  it("账号列表为空时阻止启动", () => {
    expect(
      validateRegisterBatchStart(createOptions({ accounts: [] }))
    ).toMatchObject({
      ok: false,
      reason: "empty_account_list",
      statusMessage: "请先添加至少一个账号"
    })
  })

  it("存在当前任务锁时返回任务锁消息", () => {
    const registerRunLock = createRunLock()
    expect(
      validateRegisterBatchStart(
        createOptions({ isBatchRunning: true, registerRunLock })
      )
    ).toMatchObject({
      ok: false,
      reason: "batch_already_running",
      log: { level: "warn", message: registerRunLock.message }
    })
  })

  it("调试步骤运行中保持静默返回", () => {
    expect(
      validateRegisterBatchStart(createOptions({ isDebugRunning: true }))
    ).toEqual({
      ok: false,
      reason: "debug_running"
    })
  })

  it("未选择账号时保留 info 提示", () => {
    expect(
      validateRegisterBatchStart(createOptions({ selectedAccountIds: [] }))
    ).toMatchObject({
      ok: false,
      reason: "empty_selection",
      log: { level: "info", message: "请先选择要执行的账号" }
    })
  })

  it("HeroSMS 配置不完整时阻止启动", () => {
    expect(
      validateRegisterBatchStart(createOptions({ hasHeroSmsConfig: false }))
    ).toMatchObject({
      ok: false,
      reason: "missing_hero_sms_config",
      statusMessage: "请先填写 HeroSMS 接码配置"
    })
  })

  it("选中项全部不可执行时返回原提示", () => {
    const account = createAccount("account-1", { status: "needs_review" })
    expect(
      validateRegisterBatchStart(
        createOptions({ accounts: [account], selectedAccountIds: [account.id] })
      )
    ).toMatchObject({
      ok: false,
      reason: "empty_runnable_selection",
      log: { level: "info", message: "选中的账号没有可执行项" }
    })
  })

  it("只统计选中且未完成、非待人工判断的账号", () => {
    const accounts = [
      createAccount("runnable"),
      createAccount("done-status", { status: "done" }),
      createAccount("done-progress", { progress: 7 }),
      createAccount("review", { status: "needs_review" }),
      createAccount("not-selected")
    ]
    const result = validateRegisterBatchStart(
      createOptions({
        accounts,
        selectedAccountIds: [
          "runnable",
          "done-status",
          "done-progress",
          "review"
        ]
      })
    )

    expect(result).toEqual({
      ok: true,
      runnableCount: 1
    })
  })
})
