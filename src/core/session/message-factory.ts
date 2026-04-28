// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import type {Message, MessagePayload, MessageType} from './message.js'

import {isMessageType} from './message.js'

export interface CreateMessageOptions {
  parentid?: null | string
  payload?: MessagePayload
  previousMessage?: Message
}

export function createMessage(type: MessageType, options: CreateMessageOptions = {}): Message {
  if (!isMessageType(type)) {
    throw new Error(`Unsupported message type: ${type}`)
  }

  const message: Message = {
    id: uuidv7(),
    parentid: options.parentid ?? options.previousMessage?.id ?? null,
    timestamp: new Date().toISOString(),
    type,
  }

  if ('payload' in options) {
    message.payload = options.payload
  }

  return message
}
