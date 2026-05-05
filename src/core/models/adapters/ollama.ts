// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

import type {Message} from '../../message/index.js'
import type {OperatorOptions} from '../../processor/index.js'
import type {Model} from '../model.js'
import type {Provider} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'

export class OllamaAgent implements Model {
  private readonly client = new Ollama()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Model, suffix)
  }

  getProvider(): Provider {
    return 'ollama'
  }

  async invoke(messages: Message[], _options?: Partial<OperatorOptions>): Promise<Message> {
    const response = await this.client.chat({
      messages: messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      model: this.model,
    })
    return new CoreMessage(MessageType.Assistant, {
      content: response.message.content,
    })
  }
}
