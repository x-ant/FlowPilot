import { describe, expect, it, vi } from "vitest"

import {
  getLoginBatchRunnableCount,
  runLoginBatch,
  runManagedLoginFlow,
  type LoginFlowRunner
} from "../../background/login/batch-runner"
import type { ManagedAccount } from "../../shared/account-state"
import type { OAuthIntegrationConfig } from "../../shared/oauth-integration"

const integration: OAuthIntegrationConfig = {
  source: "cpa",
  cpaUrl: "http://127.0.0.1:8317",
  cpaManagementKey: ""
}

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

const createRunner = (
  overrides: Partial<LoginFlowRunner> = {}
): LoginFlowRunner => {
  return {
    openCodexAuthLink: vi.fn(async () => ({
      ok: true,
      message: "step 1",
      oauthBinding: {
        source: "cpa" as const,
        oauthState: "state-test"
      },
      targetTab: { id: 10, url: "https://auth.openai.com/" }
    })),
    submitCodexLoginEmailAndWait: vi.fn(async () => ({
      ok: true,
      message: "step 2",
      verificationRequestedAt: 20
    })),
    submitCodexLoginPasswordAndWait: vi.fn(async () => ({
      ok: true,
      message: "step 3",
      verificationRequestedAt: 30
    })),
    fetchAndSubmitCodexVerificationCode: vi.fn(async () => ({
      ok: true,
      message: "step 4"
    })),
    confirmCodexOAuthConsent: vi.fn(async () => ({
      ok: true,
      message: "step 5",
      callbackUrl: "http://localhost:1455/auth/callback?code=test"
    })),
    submitCodexOAuthCallback: vi.fn(async () => ({
      ok: true,
      message: "step 6"
    })),
    ...overrides
  } as LoginFlowRunner
}

describe("login batch runner", () => {
  it("单账号流程按六个步骤执行并汇总消息", async () => {
    const runner = createRunner()
    const stages: Array<{ progress: number; message: string }> = []

    const result = await runManagedLoginFlow(
      integration,
      createAccount("account-1"),
      runner,
      (progress, message) => {
        stages.push({ progress, message })
      }
    )

    expect(result).toEqual({
      ok: true,
      message: "step 1；step 2；step 3；step 4；step 5；step 6"
    })
    expect(stages).toEqual([
      { progress: 1, message: "step 1" },
      { progress: 2, message: "step 2" },
      { progress: 3, message: "step 3" },
      { progress: 4, message: "step 4" },
      { progress: 5, message: "step 5" },
      { progress: 6, message: "step 6" }
    ])
    expect(runner.fetchAndSubmitCodexVerificationCode).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ id: "account-1" }),
      30
    )
  })

  it("步骤失败后停止当前账号的后续步骤", async () => {
    const runner = createRunner({
      submitCodexLoginPasswordAndWait: vi.fn(async () => ({
        ok: false,
        message: "密码提交失败"
      }))
    })

    const result = await runManagedLoginFlow(
      integration,
      createAccount("account-1"),
      runner,
      () => undefined
    )

    expect(result).toEqual({ ok: false, message: "密码提交失败" })
    expect(runner.fetchAndSubmitCodexVerificationCode).not.toHaveBeenCalled()
  })

  it("验证码页确认账号不可用时标记账号失效", async () => {
    const account = createAccount("deactivated")
    const runner = createRunner({
      fetchAndSubmitCodexVerificationCode: vi.fn(async () => ({
        ok: false,
        accountInvalid: true,
        message:
          "已填写邮箱验证码并继续；OpenAI 提示账号已被删除、停用或不可用，错误代码：account_deactivated"
      }))
    })

    const result = await runLoginBatch({
      integration,
      accounts: [account],
      selectedAccountIds: [account.id],
      mode: "pending",
      runner
    })

    expect(result.accounts[0]).toMatchObject({
      status: "invalid",
      progress: 3,
      lastMessage: "错误代码：account_deactivated"
    })
  })

  it("待执行模式排除完成账号，全部模式保留完成账号", () => {
    const pending = createAccount("pending", { status: "failed", progress: 3 })
    const done = createAccount("done", { status: "done", progress: 6 })
    const selectedIds = [pending.id, done.id]

    expect(
      getLoginBatchRunnableCount([pending, done], selectedIds, "pending")
    ).toBe(1)
    expect(
      getLoginBatchRunnableCount([pending, done], selectedIds, "all")
    ).toBe(2)
  })

  it("待执行模式只重置并执行未完成账号", async () => {
    const pending = createAccount("pending", { status: "failed", progress: 3 })
    const done = createAccount("done", { status: "done", progress: 6 })
    const runner = createRunner()
    const accountSnapshots: ManagedAccount[][] = []

    const result = await runLoginBatch({
      integration,
      accounts: [pending, done],
      selectedAccountIds: [pending.id, done.id],
      mode: "pending",
      runner,
      onAccountsChange: (accounts) => {
        accountSnapshots.push(accounts)
      }
    })

    expect(result).toMatchObject({
      cancelled: false,
      processedCount: 1,
      runnableCount: 1,
      message: "选中的未完成账号执行已结束"
    })
    expect(result.accounts[0]).toMatchObject({ progress: 6, status: "done" })
    expect(result.accounts[1]).toBe(done)
    expect(accountSnapshots[0][0]).toMatchObject({
      progress: 0,
      status: "idle"
    })
    expect(runner.submitCodexLoginEmailAndWait).toHaveBeenCalledTimes(1)
  })

  it("单个账号失败后继续执行下一个账号", async () => {
    const first = createAccount("first")
    const second = createAccount("second")
    const runner = createRunner({
      submitCodexLoginEmailAndWait: vi.fn(async (_tabId, email) => {
        return email === first.email
          ? { ok: false, message: "邮箱提交失败" }
          : { ok: true, message: "step 2", verificationRequestedAt: 20 }
      })
    })

    const result = await runLoginBatch({
      integration,
      accounts: [first, second],
      selectedAccountIds: [first.id, second.id],
      mode: "pending",
      runner
    })

    expect(result).toMatchObject({ processedCount: 2, runnableCount: 2 })
    expect(result.accounts[0]).toMatchObject({
      progress: 1,
      status: "failed",
      lastMessage: "邮箱提交失败"
    })
    expect(result.accounts[1]).toMatchObject({ progress: 6, status: "done" })
  })

  it("开始下一个账号前收到停止请求时结束批次", async () => {
    const first = createAccount("first")
    const second = createAccount("second")
    let shouldCancel = false
    const statuses: string[] = []
    const runner = createRunner({
      submitCodexOAuthCallback: vi.fn(async () => {
        shouldCancel = true
        return { ok: true, message: "step 6" }
      })
    })

    const result = await runLoginBatch({
      integration,
      accounts: [first, second],
      selectedAccountIds: [first.id, second.id],
      mode: "pending",
      runner,
      shouldCancel: () => shouldCancel,
      onStatus: (message) => {
        statuses.push(message)
      }
    })

    expect(result).toMatchObject({
      cancelled: true,
      processedCount: 1,
      runnableCount: 2,
      message: "已停止批量执行"
    })
    expect(result.accounts[0]).toMatchObject({ status: "failed" })
    expect(result.accounts[1]).toMatchObject({ status: "idle", progress: 0 })
    expect(statuses).toContain("已停止当前流程")
    expect(statuses.at(-1)).toBe("已停止批量执行")
  })
})
