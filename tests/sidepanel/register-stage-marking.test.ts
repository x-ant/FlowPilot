import { describe, expect, it } from "vitest"

import type { ManagedAccount } from "../../shared/account-state"
import { markSelectedRegisterStage } from "../../sidepanel/register-task/register-stage-marking"

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

describe("register stage marking", () => {
  it("未选择账号时返回原有提示", () => {
    expect(
      markSelectedRegisterStage({
        accounts: [createAccount("account-1")],
        selectedAccountIds: [],
        stage: "start",
        updatedAt: 100
      })
    ).toEqual({
      ok: false,
      reason: "empty_selection",
      statusMessage: "请先选择要标记阶段的账号",
      logMessage: "请先选择要标记阶段的账号"
    })
  })

  it("选择项已不存在时不修改账号", () => {
    expect(
      markSelectedRegisterStage({
        accounts: [createAccount("account-1")],
        selectedAccountIds: ["missing-account"],
        stage: "phone",
        updatedAt: 100
      })
    ).toEqual({
      ok: false,
      reason: "missing_selected_accounts",
      statusMessage: "未找到选中的账号",
      logMessage: "未找到选中的账号，无法标记阶段"
    })
  })

  it("从头开始会把选中账号重置为进度 0 和 idle", () => {
    const selected = createAccount("selected", {
      progress: 7,
      status: "done",
      lastMessage: "原状态",
      updatedAt: 1
    })
    const unselected = createAccount("unselected", {
      progress: 5,
      status: "failed"
    })

    const result = markSelectedRegisterStage({
      accounts: [selected, unselected],
      selectedAccountIds: [selected.id],
      stage: "start",
      updatedAt: 100
    })

    expect(result).toMatchObject({
      ok: true,
      changedCount: 1,
      statusMessage: "已标记 1 个账号阶段",
      logMessage: "已标记 1 个账号：已手动标记为从头开始"
    })
    if (!result.ok) {
      throw new Error("预期标记成功")
    }

    expect(result.accounts[0]).toMatchObject({
      id: selected.id,
      progress: 0,
      status: "idle",
      lastMessage: "已手动标记为从头开始",
      updatedAt: 100
    })
    expect(result.accounts[1]).toBe(unselected)
    expect(selected).toMatchObject({
      progress: 7,
      status: "done",
      lastMessage: "原状态",
      updatedAt: 1
    })
  })

  it("从手机号验证开始会把选中账号设为进度 4 和 idle", () => {
    const selected = createAccount("selected", {
      progress: 6,
      status: "needs_review"
    })

    const result = markSelectedRegisterStage({
      accounts: [selected],
      selectedAccountIds: [selected.id],
      stage: "phone",
      updatedAt: 200
    })

    expect(result).toMatchObject({
      ok: true,
      changedCount: 1,
      logMessage:
        "已标记 1 个账号：已手动标记为从手机号验证开始（下一步从 Step 5 刷新 OAuth 开始）"
    })
    if (!result.ok) {
      throw new Error("预期标记成功")
    }

    expect(result.accounts[0]).toMatchObject({
      progress: 4,
      status: "idle",
      lastMessage:
        "已手动标记为从手机号验证开始（下一步从 Step 5 刷新 OAuth 开始）",
      updatedAt: 200
    })
  })

  it("重复选择同一 ID 不会重复计数", () => {
    const selected = createAccount("selected")
    const result = markSelectedRegisterStage({
      accounts: [selected],
      selectedAccountIds: [selected.id, selected.id],
      stage: "start",
      updatedAt: 100
    })

    expect(result).toMatchObject({ ok: true, changedCount: 1 })
  })
})
