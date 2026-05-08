// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message, MessagePayload, MessageType} from '../message/index.js'

import {SessionHeader} from './header.js'
import {createMessage} from './message-factory.js'

export interface AppendMessageOptions {
  parentid?: null | string
  payload?: MessagePayload
  role?: Message['role']
}

export class Session {
  private readonly messages: Message[] = []

  constructor() {
    this.messages.push(new SessionHeader())
  }

  appendMessage(message: Message): Message
  appendMessage(type: MessageType, options?: AppendMessageOptions): Message
  appendMessage(messageOrType: Message | MessageType, options: AppendMessageOptions = {}): Message {
    const parentId = options.parentid ?? this.getLastMessageId()
    const message =
      typeof messageOrType === 'string'
        ? createMessage(messageOrType, {
            ...options,
            parentid: parentId,
          })
        : createMessage(messageOrType.type, {
            contents: messageOrType.contents,
            parentid: parentId,
            ...(messageOrType.payload === undefined ? {} : {payload: messageOrType.payload}),
            role: messageOrType.role,
          })
    this.messages.push(message)
    return message
  }

  getFirstMessageId(): null | string {
    return this.messages[0]?.id ?? null
  }

  getLastMessageId(): null | string {
    return this.messages.at(-1)?.id ?? null
  }

  getMessages(): Message[] {
    return [...this.messages]
  }
}
