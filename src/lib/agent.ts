// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

const ollama = new Ollama()

export class Agent {
  constructor(private readonly systemPrompt?: string) {}

  async chat(msg: string): Promise<string> {
    const messages: {content: string; role: 'system' | 'user'}[] = []
    if (this.systemPrompt) {
      messages.push({content: this.systemPrompt, role: 'system'})
    }

    messages.push({content: msg, role: 'user'})

    const response = await ollama.chat({
      messages,
      model: 'llama3.1',
    })
    return response.message.content
  }
}
