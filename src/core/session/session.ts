// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'

import {SessionHeader} from './header.js'
import {createMessage} from './message-factory.js'

export class Session {
  private readonly messages: Message[] = []

  constructor() {
    this.messages.push(new SessionHeader())
  }

  appendMessages(messages: Message[]): Message[] {
    const parentId = this.getLastMessageId()
    const appendedMessages = messages.map((message) => {
      const appendedMessage = createMessage(message.type, {
        contents: message.contents,
        parentid: parentId,
        ...(message.payload === undefined ? {} : {payload: message.payload}),
        role: message.role,
      })
      this.messages.push(appendedMessage)
      return appendedMessage
    })
    return appendedMessages
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
