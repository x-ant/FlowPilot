import type { RegisterAlarmConfig, RegisterRunLock } from "./account-state"

/**
 * 侧边栏与 background 之间使用的消息类型名称。
 *
 * 字符串值属于扩展内部协议；发送方和接收方都从这里引用，避免两端分别维护。
 */
export const RUNTIME_MESSAGE_TYPES = {
  powerKeepAwake: "flowpilot:power-keep-awake",
  registerAlarmSave: "flowpilot:register:alarm-save",
  registerAlarmRunNow: "flowpilot:register:alarm-run-now",
  registerBatchStart: "flowpilot:register:batch-start",
  registerBatchStop: "flowpilot:register:batch-stop",
  registerRunStatus: "flowpilot:register:run-status",
  registerClearRunLock: "flowpilot:register:clear-run-lock"
} as const

export type RuntimeMessageType =
  (typeof RUNTIME_MESSAGE_TYPES)[keyof typeof RUNTIME_MESSAGE_TYPES]

export type RegisterStopStrategy =
  | "none"
  | "immediate"
  | "finish_current_if_phone_success"

export type PowerKeepAwakeMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.powerKeepAwake
  action: "acquire" | "release"
  reason: string
}

export type RegisterAlarmSaveMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerAlarmSave
  config: RegisterAlarmConfig
}

export type RegisterAlarmRunNowMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerAlarmRunNow
}

export type RegisterBatchStartMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerBatchStart
  selectedEmails: string[]
}

export type RegisterBatchStopMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerBatchStop
  strategy: Exclude<RegisterStopStrategy, "none">
}

export type RegisterRunStatusMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerRunStatus
}

export type RegisterClearRunLockMessage = {
  type: typeof RUNTIME_MESSAGE_TYPES.registerClearRunLock
}

export type FlowPilotRuntimeMessage =
  | PowerKeepAwakeMessage
  | RegisterAlarmSaveMessage
  | RegisterAlarmRunNowMessage
  | RegisterBatchStartMessage
  | RegisterBatchStopMessage
  | RegisterRunStatusMessage
  | RegisterClearRunLockMessage

export type BasicRuntimeMessageResponse = {
  ok: boolean
  message: string
}

export type RuntimeMessageResponseMap = {
  [RUNTIME_MESSAGE_TYPES.powerKeepAwake]: {
    ok: boolean
    message?: string
  }
  [RUNTIME_MESSAGE_TYPES.registerAlarmSave]: BasicRuntimeMessageResponse & {
    config: RegisterAlarmConfig
  }
  [RUNTIME_MESSAGE_TYPES.registerAlarmRunNow]: BasicRuntimeMessageResponse
  [RUNTIME_MESSAGE_TYPES.registerBatchStart]: BasicRuntimeMessageResponse
  [RUNTIME_MESSAGE_TYPES.registerBatchStop]: BasicRuntimeMessageResponse
  [RUNTIME_MESSAGE_TYPES.registerRunStatus]: {
    ok: true
    lock: RegisterRunLock | null
    activeInMemory: boolean
    stale: boolean
  }
  [RUNTIME_MESSAGE_TYPES.registerClearRunLock]: BasicRuntimeMessageResponse
}

export type RuntimeMessageFor<TType extends RuntimeMessageType> = Extract<
  FlowPilotRuntimeMessage,
  { type: TType }
>

export type RuntimeMessageResponseFor<TType extends RuntimeMessageType> =
  RuntimeMessageResponseMap[TType]

export type RuntimeMessageResponse<TMessage extends FlowPilotRuntimeMessage> =
  RuntimeMessageResponseFor<TMessage["type"]>

/**
 * 判断未知消息是否属于指定 FlowPilot 消息类型，并为监听器收窄请求字段。
 */
export const isRuntimeMessageOfType = <TType extends RuntimeMessageType>(
  message: unknown,
  type: TType
): message is RuntimeMessageFor<TType> => {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === type
  )
}
