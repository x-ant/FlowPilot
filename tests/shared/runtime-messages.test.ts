import { describe, expect, it } from "vitest"

import {
  isRuntimeMessageOfType,
  RUNTIME_MESSAGE_TYPES
} from "../../shared/runtime-messages"

describe("runtime message contract", () => {
  it("固定现有消息类型名称，避免发送方和接收方协议漂移", () => {
    expect(RUNTIME_MESSAGE_TYPES).toEqual({
      powerKeepAwake: "flowpilot:power-keep-awake",
      registerAlarmSave: "flowpilot:register:alarm-save",
      registerAlarmRunNow: "flowpilot:register:alarm-run-now",
      registerBatchStart: "flowpilot:register:batch-start",
      registerBatchStop: "flowpilot:register:batch-stop",
      registerRunStatus: "flowpilot:register:run-status",
      registerClearRunLock: "flowpilot:register:clear-run-lock"
    })
  })

  it("只按指定 type 收窄未知消息", () => {
    expect(
      isRuntimeMessageOfType(
        {
          type: RUNTIME_MESSAGE_TYPES.registerBatchStart,
          selectedEmails: ["account-id"]
        },
        RUNTIME_MESSAGE_TYPES.registerBatchStart
      )
    ).toBe(true)
    expect(
      isRuntimeMessageOfType(
        { type: RUNTIME_MESSAGE_TYPES.registerRunStatus },
        RUNTIME_MESSAGE_TYPES.registerBatchStart
      )
    ).toBe(false)
    expect(
      isRuntimeMessageOfType(null, RUNTIME_MESSAGE_TYPES.registerRunStatus)
    ).toBe(false)
  })
})
