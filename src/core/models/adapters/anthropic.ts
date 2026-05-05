// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Anthropic} from '@anthropic-ai/sdk'

import type {Message} from '../../message/index.js'
import type {OperatorOptions} from '../../processor/index.js'
import type {Model} from '../model.js'
import type {Provider} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {splitSystemPrompt} from '../prompt.js'
import {Role} from '../role.js'

export class AnthropicAgent implements Model {
  private readonly client = new Anthropic()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Model, suffix)
  }

  getProvider(): Provider {
    return 'anthropic'
  }

  async invoke(messages: Message[], _options?: Partial<OperatorOptions>): Promise<Message> {
    const {messages: chatMessages, systemPrompt} = splitSystemPrompt(messages)

    const response = await this.client.messages.create({
      // Anthropic's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      max_tokens: 8096,
      messages: chatMessages.map((message) => ({
        content: message.content,
        role: message.role === Role.Assistant ? Role.Assistant : Role.User,
      })),
      model: this.model,
      ...(systemPrompt ? {system: systemPrompt} : {}),
    })

    const block = response.content[0]
    return new CoreMessage(MessageType.Assistant, {
      content: block.type === 'text' ? block.text : '',
    })
  }
}
