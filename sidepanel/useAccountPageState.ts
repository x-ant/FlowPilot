import { useEffect, useMemo, useState } from "react"

import type { UiLogger } from "../shared/logging"
import {
  createManagedAccount,
  EMPTY_PAGE_STATE,
  isManagedAccountDone,
  loadAccountPageState,
  normalizeEmail,
  resetManagedAccountState,
  saveAccountPageState,
  STEP_COUNT,
  upsertManagedAccount,
  type AccountFormValues,
  type AccountPageStorageKeys,
  type ManagedAccount,
  type ManagedAccountProgress
} from "./shared"

type UseAccountPageStateOptions = {
  storageKeys: AccountPageStorageKeys
  log: UiLogger
  setStatus: (status: string) => void
}

export const useAccountPageState = ({
  storageKeys,
  log,
  setStatus
}: UseAccountPageStateOptions) => {
  const [cpaUrl, setCpaUrlState] = useState("")
  const [accounts, setAccountsState] = useState<ManagedAccount[]>([])
  const [editingEmail, setEditingEmail] = useState("")
  const [runningEmail, setRunningEmail] = useState("")
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])

  const persistState = (nextCpaUrl = cpaUrl, nextAccounts = accounts) => {
    saveAccountPageState(storageKeys, {
      cpaUrl: nextCpaUrl,
      accounts: nextAccounts
    })
  }

  const syncAccounts = (
    nextAccounts: ManagedAccount[],
    nextCpaUrl = cpaUrl
  ) => {
    setAccountsState(nextAccounts)
    persistState(nextCpaUrl, nextAccounts)
  }

  const setCpaUrl = (nextCpaUrl: string) => {
    setCpaUrlState(nextCpaUrl)
    persistState(nextCpaUrl, accounts)
  }

  const setAccounts = (
    nextValue:
      | ManagedAccount[]
      | ((currentAccounts: ManagedAccount[]) => ManagedAccount[])
  ) => {
    setAccountsState((currentAccounts) => {
      const nextAccounts =
        typeof nextValue === "function" ? nextValue(currentAccounts) : nextValue
      persistState(cpaUrl, nextAccounts)
      return nextAccounts
    })
  }

  const selectedEmailSet = useMemo(() => {
    return new Set(selectedEmails.map((email) => normalizeEmail(email)))
  }, [selectedEmails])

  const selectedCount = selectedEmails.length
  const isAllAccountsSelected =
    accounts.length > 0 && selectedCount === accounts.length
  const isSomeAccountsSelected =
    selectedCount > 0 && selectedCount < accounts.length
  const completedCount = accounts.filter((account) =>
    isManagedAccountDone(account)
  ).length
  const runningCount = accounts.filter(
    (account) => account.status === "running"
  ).length
  const failedCount = accounts.filter(
    (account) => account.status === "failed"
  ).length
  const editingAccount =
    accounts.find((account) => {
      return normalizeEmail(account.email) === normalizeEmail(editingEmail)
    }) || null

  useEffect(() => {
    void (async () => {
      const state = await loadAccountPageState(storageKeys)
      setCpaUrlState(state.cpaUrl)
      setAccountsState(state.accounts)
      setStatus(state.accounts.length > 0 ? "已加载本地账号" : "已加载本地配置")
    })()
  }, [setStatus, storageKeys])

  useEffect(() => {
    const existingEmails = new Set(
      accounts.map((account) => normalizeEmail(account.email))
    )
    setSelectedEmails((currentSelectedEmails) => {
      return currentSelectedEmails.filter((email) => {
        return existingEmails.has(normalizeEmail(email))
      })
    })
  }, [accounts])

  const handleCpaUrlChange = (nextCpaUrl: string) => {
    setCpaUrl(nextCpaUrl)
  }

  const handleSubmitAccount = (values: AccountFormValues) => {
    const email = normalizeEmail(String(values.email || ""))
    const password = String(values.password || "")

    if (!email || !password) {
      setStatus("请输入账号邮箱和密码")
      log.warn("账号邮箱和密码不能为空")
      return
    }

    const nextAccount = createManagedAccount(email, password)
    const nextAccounts = upsertManagedAccount(
      accounts,
      nextAccount,
      editingEmail || undefined
    )

    syncAccounts(nextAccounts)
    setEditingEmail("")
    setStatus(`已保存账号 ${email}`)
    log.info(`已保存账号 ${email}`)
  }

  const handleEditAccount = (account: ManagedAccount) => {
    setEditingEmail(account.email)
    setStatus(`正在编辑 ${account.email}`)
  }

  const handleCancelEdit = () => {
    setEditingEmail("")
    setStatus("已取消编辑")
  }

  const handleRemoveAccount = (email: string) => {
    const nextEmail = normalizeEmail(email)
    const nextAccounts = accounts.filter((account) => {
      return normalizeEmail(account.email) !== nextEmail
    })

    if (editingEmail && normalizeEmail(editingEmail) === nextEmail) {
      setEditingEmail("")
    }

    syncAccounts(nextAccounts)
    setStatus(`已删除账号 ${email}`)
    log.warn(`已删除账号 ${email}`)
  }

  const handleToggleAccountSelected = (email: string, checked: boolean) => {
    const normalizedEmail = normalizeEmail(email)
    setSelectedEmails((currentSelectedEmails) => {
      const currentSet = new Set(
        currentSelectedEmails.map((item) => normalizeEmail(item))
      )

      if (checked) {
        currentSet.add(normalizedEmail)
      } else {
        currentSet.delete(normalizedEmail)
      }

      return accounts
        .map((account) => normalizeEmail(account.email))
        .filter((accountEmail) => currentSet.has(accountEmail))
    })
  }

  const handleToggleAllAccountsSelected = (checked: boolean) => {
    setSelectedEmails(
      checked ? accounts.map((account) => normalizeEmail(account.email)) : []
    )
  }

  const handleMoveSelectedAccount = (direction: -1 | 1) => {
    if (selectedEmails.length !== 1) {
      setStatus("上移或下移时只能选择一条账号")
      log.warn("上移或下移时只能选择一条账号")
      return
    }

    const selectedEmail = normalizeEmail(selectedEmails[0])
    const selectedIndex = accounts.findIndex((account) => {
      return normalizeEmail(account.email) === selectedEmail
    })

    if (selectedIndex < 0) {
      setStatus("未找到选中的账号")
      log.warn("未找到选中的账号，无法移动")
      return
    }

    const nextIndex = selectedIndex + direction
    if (nextIndex < 0 || nextIndex >= accounts.length) {
      setStatus(direction < 0 ? "选中账号已经在最上方" : "选中账号已经在最下方")
      return
    }

    const nextAccounts = [...accounts]
    const [movedAccount] = nextAccounts.splice(selectedIndex, 1)
    nextAccounts.splice(nextIndex, 0, movedAccount)
    syncAccounts(nextAccounts)
  }

  const handleMarkSelectedAccountsDone = () => {
    if (selectedEmails.length === 0) {
      setStatus("请先选择要标记的账号")
      log.warn("请先选择要标记的账号")
      return
    }

    const selectedSet = new Set(
      selectedEmails.map((email) => normalizeEmail(email))
    )
    let changedCount = 0
    const now = Date.now()
    const nextAccounts: ManagedAccount[] = accounts.map((account) => {
      if (!selectedSet.has(normalizeEmail(account.email))) {
        return account
      }

      changedCount += 1
      return {
        ...account,
        progress: STEP_COUNT as ManagedAccountProgress,
        status: "done" as const,
        lastMessage: "已手动标为已完成",
        updatedAt: now
      }
    })

    if (changedCount === 0) {
      setStatus("未找到选中的账号")
      log.warn("未找到选中的账号，无法标记")
      return
    }

    syncAccounts(nextAccounts)
    setStatus(`已标记 ${changedCount} 个账号为已完成`)
    log.info(`已标记 ${changedCount} 个账号为已完成`)
  }

  const patchAccountState = (email: string, patch: Partial<ManagedAccount>) => {
    const targetEmail = normalizeEmail(email)
    setAccounts((currentAccounts) => {
      return currentAccounts.map((account) => {
        if (normalizeEmail(account.email) !== targetEmail) {
          return account
        }

        return {
          ...account,
          ...patch,
          updatedAt: Date.now()
        }
      })
    })
  }

  return {
    cpaUrl,
    accounts,
    editingEmail,
    editingAccount,
    runningEmail,
    selectedEmails,
    selectedEmailSet,
    selectedCount,
    isAllAccountsSelected,
    isSomeAccountsSelected,
    completedCount,
    runningCount,
    failedCount,
    setCpaUrl,
    setAccounts,
    syncAccounts,
    setRunningEmail,
    setSelectedEmails,
    setEditingEmail,
    resetManagedAccountState,
    isManagedAccountDone,
    handleCpaUrlChange,
    handleSubmitAccount,
    handleEditAccount,
    handleCancelEdit,
    handleRemoveAccount,
    handleToggleAccountSelected,
    handleToggleAllAccountsSelected,
    handleMoveSelectedAccount,
    handleMarkSelectedAccountsDone,
    patchAccountState,
    resetState: () => {
      setCpaUrlState(EMPTY_PAGE_STATE.cpaUrl)
      setAccountsState(EMPTY_PAGE_STATE.accounts)
    }
  }
}
