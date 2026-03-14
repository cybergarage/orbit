// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

const ollama = new Ollama()

export class Agent {
  async chat(msg: string): Promise<string> {
    const response = await ollama.chat({
      messages: [{content: msg, role: 'user'}],
      model: 'llama3.1',
    })
    return response.message.content
  }
}
