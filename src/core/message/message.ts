// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import {Role} from '../models/role.js'

export const MessageType = {
  Assistant: 'assistant',
  Session: 'session',
  Tool: 'tool',
  User: 'user',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export type MessagePayload = unknown

export interface MessageOptions {
  content?: string
  contents?: string[]
  parentid?: null | string
  payload?: MessagePayload
  previousMessage?: Message
  role?: Role
}

export class Message {
  public readonly contents: string[]
  public readonly id: string
  public readonly parentid: null | string
  public readonly payload?: MessagePayload
  public readonly role: Role
  public readonly timestamp: string
  public readonly type: MessageType

  constructor(type: MessageType, options: MessageOptions = {}) {
    if (!isMessageType(type)) {
      throw new Error(`Unsupported message type: ${type}`)
    }

    this.contents = options.contents ?? (options.content === undefined ? [] : [options.content])
    this.id = uuidv7()
    this.parentid = options.parentid ?? options.previousMessage?.id ?? null
    this.role = options.role ?? defaultRoleForMessageType(type)
    this.timestamp = new Date().toISOString()
    this.type = type

    if ('payload' in options) {
      this.payload = options.payload
    }
  }

  get content(): string {
    return this.contents[0] ?? ''
  }
}

export function isMessageType(type: string): type is MessageType {
  return Object.values(MessageType).includes(type as MessageType)
}

export function defaultRoleForMessageType(type: MessageType): Role {
  if (type === MessageType.User) return Role.User
  if (type === MessageType.Session) return Role.System
  return Role.Assistant
}
