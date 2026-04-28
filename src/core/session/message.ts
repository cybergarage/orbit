// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const MessageType = {
  Assistant: 'Assistant',
  Tool: 'Tool',
  User: 'User',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export type MessagePayload = unknown

export interface Message {
  id: string
  parentid: null | string
  payload?: MessagePayload
  timestamp: string
  type: MessageType
}

export function isMessageType(type: string): type is MessageType {
  return Object.values(MessageType).includes(type as MessageType)
}
