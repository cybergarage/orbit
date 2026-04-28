// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Memory} from '../memory/index.js'
import type {Message, MessagePayload, MessageType} from './message.js'

import {PromptMemory} from '../memory/index.js'
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
  }

  appendMessage(type: MessageType, options: AppendMessageOptions = {}): Message {
    const message = createMessage(type, {
      ...options,
      previousMessage: this.messages.at(-1),
    })
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
