// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

import type {Model} from '../model.js'
import type {Prompt} from '../prompt.js'

export class OllamaAgent implements Model {
  private readonly client = new Ollama()

  constructor(private readonly model: string) {}

  async prompt(messages: Prompt[]): Promise<string> {
    const response = await this.client.chat({messages, model: this.model})
    return response.message.content
  }
}
