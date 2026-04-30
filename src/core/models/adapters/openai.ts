// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {OpenAI} from 'openai'

import type {Message} from '../../message/index.js'
import type {Model} from '../model.js'
import type {Provider} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'

export class OpenAIAgent implements Model {
  private readonly client = new OpenAI()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getProvider(): Provider {
    return 'openai'
  }

  async invoke(messages: Message[]): Promise<Message> {
    const response = await this.client.chat.completions.create({
      messages: messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      model: this.model,
    })

    return new CoreMessage(MessageType.Assistant, {
      content: response.choices[0]?.message.content ?? '',
    })
  }
}
