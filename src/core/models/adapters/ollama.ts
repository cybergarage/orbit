// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

import type {Model} from '../model.js'
import type {Prompt} from '../prompt.js'
import type {Provider} from '../provider.js'

import {Role} from '../role.js'

export class OllamaAgent implements Model {
  private readonly client = new Ollama()

  constructor(private readonly model: string) {}

  getModel(): string {
    return this.model
  }

  getProvider(): Provider {
    return 'ollama'
  }

  async prompt(messages: Prompt[]): Promise<Prompt> {
    const response = await this.client.chat({messages, model: this.model})
    return {
      content: response.message.content,
      role: Role.Assistant,
    }
  }
}
