import { Alert, Button, Modal } from "antd"

import type { RegisterRunLock } from "../../shared/account-state"
import type { RegisterStopStrategy } from "../../shared/runtime-messages"
import { getRegisterRunLockDisplay } from "./task-status-display"

type RegisterStopStrategyModalProps = {
  open: boolean
  isStopping: boolean
  onChoose: (strategy: Exclude<RegisterStopStrategy, "none">) => void
}

type RegisterOrphanRunLockAlertProps = {
  visible: boolean
  registerRunLock: RegisterRunLock | null
  isClearing: boolean
  onClear: () => void | Promise<void>
}

/** 手机号已进入验证阶段时使用的停止策略选择框。 */
export function RegisterStopStrategyModal({
  open,
  isStopping,
  onChoose
}: RegisterStopStrategyModalProps) {
  return (
    <Modal
      title="当前手机号已进入验证流程"
      open={open}
      closable={false}
      mask={{ closable: false }}
      footer={[
        <Button
          key="immediate"
          danger
          disabled={isStopping}
          loading={isStopping}
          onClick={() => {
            onChoose("immediate")
          }}>
          直接停止
        </Button>,
        <Button
          key="finish"
          type="primary"
          disabled={isStopping}
          onClick={() => {
            onChoose("finish_current_if_phone_success")
          }}>
          成功则完成回填
        </Button>
      ]}>
      <div>
        <p>
          当前手机号已经获取并可能已经提交到
          OpenAI。直接停止会把当前手机号后续处理交给你人工负责。
        </p>
        <p>
          推荐选择“成功则完成回填”：如果当前手机号失败就停止，不再换号；如果验证成功，就向当前管理端提交
          OAuth callback 后停止。
        </p>
      </div>
    </Modal>
  )
}

/** 已失去 background 内存任务的残留锁提示。 */
export function RegisterOrphanRunLockAlert({
  visible,
  registerRunLock,
  isClearing,
  onClear
}: RegisterOrphanRunLockAlertProps) {
  if (!visible) {
    return null
  }

  const display = getRegisterRunLockDisplay(registerRunLock)
  const startedLabel = display.startedAt
    ? new Date(display.startedAt).toLocaleString()
    : "未知"

  return (
    <Alert
      type="warning"
      showIcon
      title="检测到残留注册任务锁"
      description={`开始时间：${startedLabel}；当前账号：${display.currentAccount}；最后状态：${display.lastMessage}`}
      action={
        <Button
          size="small"
          loading={isClearing}
          onClick={() => {
            void onClear()
          }}>
          清除残留锁
        </Button>
      }
    />
  )
}
