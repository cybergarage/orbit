// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

import type {Model} from '../model.js'
import type {Prompt} from '../prompt.js'
import type {Provider} from '../provider.js'

import {Message, MessageType} from '../../message/index.js'

export class OllamaAgent implements Model {
  private readonly client = new Ollama()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getProvider(): Provider {
    return 'ollama'
  }

  async prompt(messages: Prompt[]): Promise<Message> {
    const response = await this.client.chat({messages, model: this.model})
    return new Message(MessageType.Assistant, {
      content: response.message.content,
    })
  }
}
