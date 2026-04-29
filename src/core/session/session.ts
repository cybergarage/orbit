// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Memory} from '../memory/index.js'
import type {Message, MessagePayload, MessageType} from '../message/index.js'

import {PromptMemory} from '../memory/index.js'
import {SessionHeader} from './header.js'
import {createMessage} from './message-factory.js'

export interface SessionOptions {
  memory?: Memory
}

export interface AppendMessageOptions {
  parentid?: null | string
  payload?: MessagePayload
}

export class Session {
  public readonly memory: Memory
  public readonly options: SessionOptions
  private readonly messages: Message[] = []

  constructor(options: SessionOptions = {}) {
    this.memory = options.memory ?? new PromptMemory()
    this.options = options
    this.appendMessage(new SessionHeader())
  }

  appendMessage(message: Message): Message
  appendMessage(type: MessageType, options?: AppendMessageOptions): Message
  appendMessage(messageOrType: Message | MessageType, options: AppendMessageOptions = {}): Message {
    const message =
      typeof messageOrType === 'string'
        ? createMessage(messageOrType, {
            ...options,
            previousMessage: this.messages.at(-1),
          })
        : messageOrType
    this.messages.push(message)
    return message
  }

  getMemory(): Memory {
    return this.memory
  }

  getMessages(): Message[] {
    return [...this.messages]
  }
}
