// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {OpenAI} from 'openai'

import type {Model} from '../model.js'
import type {Prompt} from '../prompt.js'
import type {Provider} from '../provider.js'

import {Message, MessageType} from '../../message/index.js'

export class OpenAIAgent implements Model {
  private readonly client = new OpenAI()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getProvider(): Provider {
    return 'openai'
  }

  async prompt(messages: Prompt[]): Promise<Message> {
    const response = await this.client.chat.completions.create({
      messages,
      model: this.model,
    })

    return new Message(MessageType.Assistant, {
      content: response.choices[0]?.message.content ?? '',
    })
  }
}
