// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Anthropic} from '@anthropic-ai/sdk'

import {type Agent, type ChatMessage, splitSystemPrompt} from '../agent.js'

export class AnthropicAgent implements Agent {
  private readonly client = new Anthropic()

  constructor(
    private readonly model: string,
    private readonly systemPrompt?: string,
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const requestMessages = this.systemPrompt
      ? [{content: this.systemPrompt, role: 'system'} as ChatMessage, ...messages]
      : messages
    const {messages: chatMessages, systemPrompt} = splitSystemPrompt(requestMessages)

    const response = await this.client.messages.create({
      // Anthropic's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      max_tokens: 8096,
      messages: chatMessages.map((message) => ({
        content: message.content,
        role: message.role === 'assistant' ? 'assistant' : 'user',
      })),
      model: this.model,
      ...(systemPrompt ? {system: systemPrompt} : {}),
    })

    const block = response.content[0]
    return block.type === 'text' ? block.text : ''
  }
}
