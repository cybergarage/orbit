// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {OpenAI} from 'openai'

import type {Agent, ChatMessage} from '../agent.js'

export class OpenAIAgent implements Agent {
  private readonly client = new OpenAI()

  constructor(
    private readonly model: string,
    private readonly systemPrompt?: string,
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const requestMessages: ChatMessage[] = []
    if (this.systemPrompt) {
      requestMessages.push({content: this.systemPrompt, role: 'system'})
    }

    requestMessages.push(...messages)
    const response = await this.client.chat.completions.create({
      messages: requestMessages,
      model: this.model,
    })

    return response.choices[0]?.message.content ?? ''
  }
}
