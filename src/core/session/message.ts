// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

export const MessageType = {
  Assistant: 'assistant',
  Session: 'session',
  Tool: 'tool',
  User: 'user',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export type MessagePayload = unknown

export interface MessageOptions {
  parentid?: null | string
  payload?: MessagePayload
  previousMessage?: Message
}

export class Message {
  public readonly id: string
  public readonly parentid: null | string
  public readonly payload?: MessagePayload
  public readonly timestamp: string
  public readonly type: MessageType

  constructor(type: MessageType, options: MessageOptions = {}) {
    if (!isMessageType(type)) {
      throw new Error(`Unsupported message type: ${type}`)
    }

    this.id = uuidv7()
    this.parentid = options.parentid ?? options.previousMessage?.id ?? null
    this.timestamp = new Date().toISOString()
    this.type = type

    if ('payload' in options) {
      this.payload = options.payload
    }
  }
}

export function isMessageType(type: string): type is MessageType {
  return Object.values(MessageType).includes(type as MessageType)
}
