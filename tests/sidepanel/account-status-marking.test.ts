import { describe, expect, it } from "vitest"

import type { ManagedAccount } from "../../shared/account-state"
import { markSelectedAccountStatus } from "../../sidepanel/account-management/account-status-marking"

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

describe("account status marking", () => {
  it("只把选中的账号标记为完成并更新到当前页面最后一步", () => {
    const selected = createAccount("selected", {
      progress: 2,
      status: "failed",
      lastMessage: "原状态"
    })
    const unselected = createAccount("unselected", {
      progress: 3,
      status: "running"
    })

    const result = markSelectedAccountStatus({
      accounts: [selected, unselected],
      selectedAccountIds: [selected.id],
      target: "done",
      stepCount: 6,
      updatedAt: 100
    })

    expect(result.changedCount).toBe(1)
    expect(result.accounts[0]).toMatchObject({
      id: selected.id,
      progress: 6,
      status: "done",
      lastMessage: "已手动标为已完成",
      updatedAt: 100
    })
    expect(result.accounts[1]).toBe(unselected)
    expect(selected).toMatchObject({
      progress: 2,
      status: "failed",
      lastMessage: "原状态",
      updatedAt: 1
    })
  })

  it.each([
    { stepCount: -1, expectedProgress: 0 },
    { stepCount: 7, expectedProgress: 7 },
    { stepCount: 99, expectedProgress: 7 }
  ])(
    "完成进度会把步骤数 $stepCount 限制为 $expectedProgress",
    ({ stepCount, expectedProgress }) => {
      const account = createAccount("selected")
      const result = markSelectedAccountStatus({
        accounts: [account],
        selectedAccountIds: [account.id],
        target: "done",
        stepCount,
        updatedAt: 100
      })

      expect(result.accounts[0].progress).toBe(expectedProgress)
    }
  )

  it("标记失效会保留当前步骤进度", () => {
    const account = createAccount("selected", {
      progress: 5,
      status: "needs_review"
    })
    const result = markSelectedAccountStatus({
      accounts: [account],
      selectedAccountIds: [account.id],
      target: "invalid",
      stepCount: 7,
      updatedAt: 200
    })

    expect(result).toMatchObject({ changedCount: 1 })
    expect(result.accounts[0]).toMatchObject({
      progress: 5,
      status: "invalid",
      lastMessage: "已手动标为失效",
      updatedAt: 200
    })
  })

  it("选择项不存在时返回零变更", () => {
    const account = createAccount("account-1")
    const result = markSelectedAccountStatus({
      accounts: [account],
      selectedAccountIds: ["missing-account"],
      target: "done",
      stepCount: 6,
      updatedAt: 100
    })

    expect(result.changedCount).toBe(0)
    expect(result.accounts[0]).toBe(account)
  })

  it("重复选择同一账号 ID 不会重复计数", () => {
    const account = createAccount("account-1")
    const result = markSelectedAccountStatus({
      accounts: [account],
      selectedAccountIds: [account.id, account.id],
      target: "invalid",
      stepCount: 6,
      updatedAt: 100
    })

    expect(result.changedCount).toBe(1)
  })
})
