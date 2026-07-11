import { useEffect, useMemo, useState } from "react"

import type { UiLogger } from "../../shared/logging"
import { useRef } from "react"
import {
  createManagedAccount,
  EMPTY_PAGE_STATE,
  getManagedAccountKey,
  getManagedAccountLabel,
  getManagedAccountProviderLabel,
  loadAccountPageState,
  normalizeEmail,
  normalizeEmailGenerator,
  normalizeMailProvider,
  normalizeStoredAccount,
  resetManagedAccountState,
  saveAccountPageState,
  STEP_COUNT,
  upsertManagedAccount,
  type AccountFormValues,
  type AccountPageStorageKeys,
  type ManagedAccount,
  type ManagedAccountProgress
} from "../../shared/account-state"

type UseAccountPageStateOptions = {
  storageKeys: AccountPageStorageKeys
  log: UiLogger
  setStatus: (status: string) => void
}

/**
 * 管理一个功能页的账号、CPA 配置和账号选择状态。
 *
 * 登录页和注册页都复用这个 hook；差异只通过 storageKeys 分开保存，
 * 避免两套页面各自维护一份相同的账号列表逻辑。
 *
 * @param options 页面状态初始化选项。
 * @param options.storageKeys 当前功能页使用的本地存储 key。
 * @param options.log 写入侧边栏执行日志的对象。
 * @param options.setStatus 更新顶部状态标签的函数。
 * @return 页面组件需要读取和调用的账号状态与操作方法。
 */
export const useAccountPageState = ({
  storageKeys,
  log,
  setStatus
}: UseAccountPageStateOptions) => {
  const setStatusRef = useRef(setStatus)
  const [cpaUrl, setCpaUrlState] = useState("")
  const [cpaManagementKey, setCpaManagementKeyState] = useState("")
  const [accounts, setAccountsState] = useState<ManagedAccount[]>([])
  const [editingEmail, setEditingEmail] = useState("")
  const [runningEmail, setRunningEmail] = useState("")
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])

  /**
   * 按当前页面的存储 key 保存完整页面状态。
   *
   * @param nextCpaUrl 要保存的 CPA 地址，默认使用当前状态。
   * @param nextAccounts 要保存的账号列表，默认使用当前状态。
   * @param nextCpaManagementKey 要保存的 CPA 管理密钥，默认使用当前状态。
   */
  const persistState = (
    nextCpaUrl = cpaUrl,
    nextAccounts = accounts,
    nextCpaManagementKey = cpaManagementKey
  ) => {
    saveAccountPageState(storageKeys, {
      cpaUrl: nextCpaUrl,
      cpaManagementKey: nextCpaManagementKey,
      accounts: nextAccounts
    })
  }

  /**
   * 同步账号列表到 React 状态和浏览器本地存储。
   *
   * @param nextAccounts 下一份账号列表。
   * @param nextCpaUrl 可选的新 CPA 地址。
   * @param nextCpaManagementKey 可选的新 CPA 管理密钥。
   */
  const syncAccounts = (
    nextAccounts: ManagedAccount[],
    nextCpaUrl = cpaUrl,
    nextCpaManagementKey = cpaManagementKey
  ) => {
    setAccountsState(nextAccounts)
    persistState(nextCpaUrl, nextAccounts, nextCpaManagementKey)
  }

  const setCpaUrl = (nextCpaUrl: string) => {
    if (nextCpaUrl === cpaUrl) {
      return
    }

    setCpaUrlState(nextCpaUrl)
    persistState(nextCpaUrl, accounts, cpaManagementKey)
  }

  const setCpaManagementKey = (nextCpaManagementKey: string) => {
    if (nextCpaManagementKey === cpaManagementKey) {
      return
    }

    setCpaManagementKeyState(nextCpaManagementKey)
    persistState(cpaUrl, accounts, nextCpaManagementKey)
  }

  const setCpaConfig = (
    nextCpaUrl: string,
    nextCpaManagementKey: string
  ) => {
    if (nextCpaUrl === cpaUrl && nextCpaManagementKey === cpaManagementKey) {
      return
    }

    setCpaUrlState(nextCpaUrl)
    setCpaManagementKeyState(nextCpaManagementKey)
    persistState(nextCpaUrl, accounts, nextCpaManagementKey)
  }

  const setAccounts = (
    nextValue:
      | ManagedAccount[]
      | ((currentAccounts: ManagedAccount[]) => ManagedAccount[])
  ) => {
    setAccountsState((currentAccounts) => {
      const nextAccounts =
        typeof nextValue === "function" ? nextValue(currentAccounts) : nextValue
      persistState(cpaUrl, nextAccounts, cpaManagementKey)
      return nextAccounts
    })
  }

  const selectedEmailSet = useMemo(() => {
    return new Set(selectedEmails)
  }, [selectedEmails])

  const selectedCount = selectedEmails.length
  const isAllAccountsSelected =
    accounts.length > 0 && selectedCount === accounts.length
  const isSomeAccountsSelected =
    selectedCount > 0 && selectedCount < accounts.length
  const editingAccount =
    accounts.find((account) => {
      return getManagedAccountKey(account) === editingEmail
    }) || null

  useEffect(() => {
    setStatusRef.current = setStatus
  }, [setStatus])

  useEffect(() => {
    void (async () => {
      const state = await loadAccountPageState(storageKeys)
      setCpaUrlState(state.cpaUrl)
      setCpaManagementKeyState(state.cpaManagementKey)
      setAccountsState(state.accounts)
      setStatusRef.current(
        state.accounts.length > 0 ? "已加载本地账号" : "已加载本地配置"
      )
    })()
  }, [storageKeys.accounts, storageKeys.cpaManagementKey, storageKeys.cpaUrl])

  useEffect(() => {
    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") {
        return
      }

      if (changes[storageKeys.cpaUrl]) {
        setCpaUrlState(String(changes[storageKeys.cpaUrl].newValue || ""))
      }

      if (changes[storageKeys.cpaManagementKey]) {
        setCpaManagementKeyState(
          String(changes[storageKeys.cpaManagementKey].newValue || "")
        )
      }

      if (changes[storageKeys.accounts]) {
        const rawAccounts = Array.isArray(
          changes[storageKeys.accounts].newValue
        )
          ? (changes[storageKeys.accounts].newValue as unknown[])
          : []
        setAccountsState(
          rawAccounts
            .map((account) => normalizeStoredAccount(account))
            .filter((account): account is ManagedAccount => Boolean(account))
        )
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChanged)
    }
  }, [storageKeys.accounts, storageKeys.cpaManagementKey, storageKeys.cpaUrl])

  useEffect(() => {
    const existingEmails = new Set(
      accounts.map((account) => getManagedAccountKey(account))
    )
    setSelectedEmails((currentSelectedEmails) => {
      const nextSelectedEmails = currentSelectedEmails.filter((accountId) => {
        return existingEmails.has(accountId)
      })
      const isUnchanged =
        nextSelectedEmails.length === currentSelectedEmails.length &&
        nextSelectedEmails.every((accountId, index) => {
          return accountId === currentSelectedEmails[index]
        })

      return isUnchanged ? currentSelectedEmails : nextSelectedEmails
    })
  }, [accounts])

  const handleCpaUrlChange = (nextCpaUrl: string) => {
    setCpaUrl(nextCpaUrl)
  }

  const handleCpaManagementKeyChange = (nextCpaManagementKey: string) => {
    setCpaManagementKey(nextCpaManagementKey)
  }

  const handleCpaConfigChange = (
    nextCpaUrl: string,
    nextCpaManagementKey: string
  ) => {
    setCpaConfig(nextCpaUrl, nextCpaManagementKey)
  }

  /**
   * 保存账号表单。
   *
   * 新增时创建带稳定 ID 的账号；编辑时按账号 ID 保留执行进度，
   * 同步更新邮箱服务、可选邮箱生成方式、注册邮箱和注册密码。
   *
   * @param values 表单提交的账号配置。
   * @param values.mailProvider 邮箱服务，决定验证码读取方式。
   * @param values.emailGenerator 邮箱生成方式，仅注册页 163 邮箱需要。
   * @param values.email 注册邮箱。
   * @param values.password 注册密码。
   */
  const handleSubmitAccount = (values: AccountFormValues) => {
    const mailProvider = normalizeMailProvider(values.mailProvider)
    const emailGenerator =
      mailProvider === "163"
        ? normalizeEmailGenerator(values.emailGenerator)
        : undefined
    const email = normalizeEmail(String(values.email || ""))
    const mailboxEmail = mailProvider === "2925" ? email : ""
    const password = String(values.password || "")

    if (!password) {
      setStatus("请输入注册密码")
      log.warn("注册密码不能为空")
      return
    }

    if (!email) {
      setStatus("请输入注册邮箱")
      log.warn("当前邮箱服务需要填写注册邮箱")
      return
    }

    if (mailProvider === "163" && !emailGenerator) {
      setStatus("请选择邮箱生成方式")
      log.warn("163 邮箱账号需要选择邮箱生成方式")
      return
    }

    const previousEditingId = editingEmail
    const existingAccount =
      accounts.find((account) => {
        return getManagedAccountKey(account) === previousEditingId
      }) || null
    const shouldPreserveAccountState = Boolean(existingAccount)
    const nextAccount = shouldPreserveAccountState
      ? {
          ...existingAccount,
          mailProvider,
          emailGenerator,
          email,
          mailboxEmail,
          password,
          updatedAt: Date.now()
        }
      : createManagedAccount({
          ...values,
          mailProvider,
          emailGenerator,
          email,
          mailboxEmail,
          password
        })
    const nextAccounts = upsertManagedAccount(
      accounts,
      nextAccount,
      editingEmail || undefined
    )

    syncAccounts(nextAccounts)
    setEditingEmail("")
    const accountLabel =
      getManagedAccountLabel(nextAccount) ||
      getManagedAccountProviderLabel(nextAccount)
    setStatus(`已保存账号 ${accountLabel}`)
    log.info(`已保存账号 ${accountLabel}`)
  }

  /**
   * 进入账号编辑状态。
   *
   * @param account 要编辑的账号。
   */
  const handleEditAccount = (account: ManagedAccount) => {
    setEditingEmail(getManagedAccountKey(account))
    setStatus(
      `正在编辑 ${
        getManagedAccountLabel(account) || getManagedAccountProviderLabel(account)
      }`
    )
  }

  const handleCancelEdit = () => {
    setEditingEmail("")
    setStatus("已取消编辑")
  }

  /**
   * 删除指定账号。
   *
   * @param accountId 要删除的账号 ID。
   */
  const handleRemoveAccount = (accountId: string) => {
    const nextAccounts = accounts.filter((account) => {
      return getManagedAccountKey(account) !== accountId
    })

    if (editingEmail && editingEmail === accountId) {
      setEditingEmail("")
    }

    syncAccounts(nextAccounts)
    setStatus("已删除账号")
    log.warn("已删除账号")
  }

  /**
   * 勾选或取消勾选单个账号。
   *
   * @param accountId 要切换选择状态的账号 ID。
   * @param checked 是否选中。
   */
  const handleToggleAccountSelected = (accountId: string, checked: boolean) => {
    setSelectedEmails((currentSelectedEmails) => {
      const currentSet = new Set(currentSelectedEmails)

      if (checked) {
        currentSet.add(accountId)
      } else {
        currentSet.delete(accountId)
      }

      return accounts
        .map((account) => getManagedAccountKey(account))
        .filter((nextAccountId) => currentSet.has(nextAccountId))
    })
  }

  const handleToggleAllAccountsSelected = (checked: boolean) => {
    setSelectedEmails(
      checked ? accounts.map((account) => getManagedAccountKey(account)) : []
    )
  }

  /**
   * 移动当前唯一选中的账号。
   *
   * @param direction -1 表示上移，1 表示下移。
   */
  const handleMoveSelectedAccount = (direction: -1 | 1) => {
    if (selectedEmails.length !== 1) {
      setStatus("上移或下移时只能选择一条账号")
      log.warn("上移或下移时只能选择一条账号")
      return
    }

    const selectedAccountId = selectedEmails[0]
    const selectedIndex = accounts.findIndex((account) => {
      return getManagedAccountKey(account) === selectedAccountId
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

  /**
   * 把选中的账号手动标记为已完成。
   */
  const handleMarkSelectedAccountsDone = () => {
    if (selectedEmails.length === 0) {
      setStatus("请先选择要标记的账号")
      log.warn("请先选择要标记的账号")
      return
    }

    const selectedSet = new Set(
      selectedEmails
    )
    let changedCount = 0
    const now = Date.now()
    const nextAccounts: ManagedAccount[] = accounts.map((account) => {
      if (!selectedSet.has(getManagedAccountKey(account))) {
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

  /**
   * 更新单个账号的执行状态。
   *
   * @param accountId 要更新的账号 ID。
   * @param patch 要合并到账号上的局部状态。
   */
  const patchAccountState = (accountId: string, patch: Partial<ManagedAccount>) => {
    setAccounts((currentAccounts) => {
      return currentAccounts.map((account) => {
        if (getManagedAccountKey(account) !== accountId) {
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
    cpaManagementKey,
    accounts,
    editingEmail,
    editingAccount,
    runningEmail,
    selectedEmails,
    selectedEmailSet,
    selectedCount,
    isAllAccountsSelected,
    isSomeAccountsSelected,
    setCpaUrl,
    setCpaManagementKey,
    setCpaConfig,
    setAccounts,
    syncAccounts,
    setRunningEmail,
    setSelectedEmails,
    setEditingEmail,
    resetManagedAccountState,
    handleCpaUrlChange,
    handleCpaManagementKeyChange,
    handleCpaConfigChange,
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
      setCpaManagementKeyState(EMPTY_PAGE_STATE.cpaManagementKey)
      setAccountsState(EMPTY_PAGE_STATE.accounts)
    }
  }
}

export type AccountPageState = ReturnType<typeof useAccountPageState>
