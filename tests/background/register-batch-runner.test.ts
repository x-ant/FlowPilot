import { describe, expect, it, vi } from "vitest"

import {
  runRegisterBatch,
  type RegisterFlowRunner
} from "../../background/register/batch-runner"
import type { HeroSmsPhoneVerificationOptions } from "../../background/register/phone-verification"
import type { ManagedAccount } from "../../shared/account-state"
import type { OAuthIntegrationConfig } from "../../shared/oauth-integration"

const integration: OAuthIntegrationConfig = {
  source: "cpa",
  cpaUrl: "http://127.0.0.1:8317",
  cpaManagementKey: ""
}

const heroSmsOptions: HeroSmsPhoneVerificationOptions = {
  apiKey: "",
  countryId: 1,
  countryLabel: "Test Country",
  operator: "any",
  mockEnabled: true,
  maxPrice: "0.1",
  fixedPrice: "0.1"
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
  overrides: Partial<RegisterFlowRunner> = {}
): RegisterFlowRunner => {
  const callbackUrl = "http://localhost:1455/auth/callback?code=test-register"

  return {
    openChatGptRegisterEntry: vi.fn(async () => ({
      ok: true,
      message: "step 1",
      targetTab: { id: 10, url: "https://chatgpt.com/" }
    })),
    prepareRegisterAccountEmail: vi.fn(async (account) => ({
      ok: true,
      message: "prepared",
      account
    })),
    clickRegisterAndSubmitEmail: vi.fn(async () => ({
      ok: true,
      message: "step 2",
      verificationRequestedAt: 20
    })),
    fetchAndSubmitRegisterVerificationCode: vi.fn(async () => ({
      ok: true,
      message: "step 3"
    })),
    submitRegisterProfile: vi.fn(async () => ({
      ok: true,
      message: "profile"
    })),
    clickRegisterReadyContinue: vi.fn(async () => ({
      ok: true,
      message: "step 4"
    })),
    refreshRegisterOAuthAndLogin: vi.fn(async () => ({
      ok: true,
      message: "refresh OAuth",
      oauthStartedAt: 100,
      oauthBinding: {
        source: "cpa" as const,
        oauthState: "state-test"
      },
      targetTab: { id: 20, url: "https://auth.openai.com/add-phone" }
    })),
    completeRegisterOAuthLogin: vi.fn(async () => ({
      ok: true,
      message: "step 5",
      oauthStartedAt: 100,
      oauthBinding: {
        source: "cpa" as const,
        oauthState: "state-test"
      },
      targetTab: { id: 20, url: "https://auth.openai.com/add-phone" }
    })),
    completeRegisterPhoneVerification: vi.fn(async () => ({
      ok: true,
      message: "step 6",
      callbackUrl,
      targetTab: { id: 20, url: callbackUrl }
    })),
    submitRegisterOAuthCallback: vi.fn(async () => ({
      ok: true,
      message: "step 7"
    })),
    ...overrides
  } as RegisterFlowRunner
}

describe("register batch runner", () => {
  it("排除已完成、失效和待人工判断账号", async () => {
    const accounts = [
      createAccount("done", { status: "done", progress: 7 }),
      createAccount("invalid", { status: "invalid", progress: 4 }),
      createAccount("review", { status: "needs_review", progress: 6 })
    ]
    const runner = createRunner()

    const result = await runRegisterBatch({
      integration,
      accounts,
      selectedEmails: accounts.map((account) => account.id),
      heroSmsOptions,
      runner
    })

    expect(result).toMatchObject({
      cancelled: false,
      processedCount: 0,
      runnableCount: 0,
      message: "没有可执行的注册账号"
    })
    expect(runner.refreshRegisterOAuthAndLogin).not.toHaveBeenCalled()
  })

  it("仅在用户明确选中时允许重试失效账号", async () => {
    const invalid = createAccount("invalid", {
      status: "invalid",
      progress: 3
    })

    const result = await runRegisterBatch({
      integration,
      accounts: [invalid],
      selectedEmails: [invalid.id],
      heroSmsOptions,
      allowInvalidWhenSelected: true,
      shouldCancel: () => true,
      runner: createRunner()
    })

    expect(result).toMatchObject({
      cancelled: true,
      processedCount: 0,
      runnableCount: 1
    })
    expect(result.accounts[0]).toMatchObject({ status: "idle", progress: 0 })
  })

  it("未选择账号时可按配置执行所有待执行账号", async () => {
    const pending = createAccount("pending")
    const done = createAccount("done", { status: "done", progress: 7 })

    const result = await runRegisterBatch({
      integration,
      accounts: [pending, done],
      heroSmsOptions,
      targetAllWhenNoSelection: true,
      shouldCancel: () => true,
      runner: createRunner()
    })

    expect(result).toMatchObject({
      cancelled: true,
      processedCount: 0,
      runnableCount: 1
    })
  })

  it("进度为四时从 Step 5 继续并完成注册", async () => {
    const account = createAccount("resume", {
      status: "failed",
      progress: 4
    })
    const runner = createRunner()

    const result = await runRegisterBatch({
      integration,
      accounts: [account],
      selectedEmails: [account.id],
      heroSmsOptions,
      runner
    })

    expect(result).toMatchObject({
      cancelled: false,
      processedCount: 1,
      runnableCount: 1
    })
    expect(result.accounts[0]).toMatchObject({ status: "done", progress: 7 })
    expect(runner.openChatGptRegisterEntry).not.toHaveBeenCalled()
    expect(runner.prepareRegisterAccountEmail).not.toHaveBeenCalled()
    expect(runner.refreshRegisterOAuthAndLogin).toHaveBeenCalledTimes(1)
    expect(runner.completeRegisterPhoneVerification).toHaveBeenCalledTimes(1)
    expect(runner.submitRegisterOAuthCallback).toHaveBeenCalledTimes(1)
  })

  it("单个账号失败后继续执行下一个账号", async () => {
    const first = createAccount("first", { progress: 4 })
    const second = createAccount("second", { progress: 4 })
    const runner = createRunner({
      completeRegisterOAuthLogin: vi.fn(async (_tabId, account) => {
        if (account.id === first.id) {
          return { ok: false, message: "OAuth 登录失败" }
        }

        return {
          ok: true,
          message: "step 5",
          oauthStartedAt: 100,
          oauthBinding: {
            source: "cpa" as const,
            oauthState: "state-test"
          },
          targetTab: { id: 20, url: "https://auth.openai.com/add-phone" }
        }
      })
    })

    const result = await runRegisterBatch({
      integration,
      accounts: [first, second],
      selectedEmails: [first.id, second.id],
      heroSmsOptions,
      accountIntervalMinSeconds: 0,
      accountIntervalMaxSeconds: 0,
      runner
    })

    expect(result).toMatchObject({ processedCount: 2, runnableCount: 2 })
    expect(result.accounts[0]).toMatchObject({
      status: "failed",
      progress: 4,
      lastMessage: "refresh OAuth；OAuth 登录失败"
    })
    expect(result.accounts[1]).toMatchObject({ status: "done", progress: 7 })
  })

  it("人工停止手机号阶段时保留待人工判断状态", async () => {
    const account = createAccount("manual-stop", { progress: 4 })
    let shouldCancel = false
    const runner = createRunner({
      completeRegisterPhoneVerification: vi.fn(async () => {
        shouldCancel = true
        return { ok: false, message: "已停止等待手机号验证码" }
      })
    })

    const result = await runRegisterBatch({
      integration,
      accounts: [account],
      selectedEmails: [account.id],
      heroSmsOptions,
      shouldCancel: () => shouldCancel,
      isManualPhoneStop: () => true,
      runner
    })

    expect(result).toMatchObject({
      cancelled: true,
      processedCount: 1,
      runnableCount: 1,
      message: "已停止批量执行"
    })
    expect(result.accounts[0]).toMatchObject({
      status: "needs_review",
      progress: 6,
      lastMessage: "已直接停止，当前手机号验证码由人工负责"
    })
  })
})
