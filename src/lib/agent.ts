// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Anthropic} from '@anthropic-ai/sdk'
import {Ollama} from 'ollama'
import {OpenAI} from 'openai'

export type Provider = 'anthropic' | 'ollama' | 'openai'
export type ChatRole = 'assistant' | 'system' | 'user'

export interface ChatMessage {
  content: string
  role: ChatRole
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
}

export interface Agent {
  chat(messages: ChatMessage[]): Promise<string>
}

export function splitSystemPrompt(messages: ChatMessage[]): {messages: ChatMessage[]; systemPrompt?: string} {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
  const visibleMessages = messages.filter((message) => message.role !== 'system')

  return {
    messages: visibleMessages,
    systemPrompt: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
  }
}

class OllamaAgent implements Agent {
  private readonly client = new Ollama()

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

    const response = await this.client.chat({messages: requestMessages, model: this.model})
    return response.message.content
  }
}

class AnthropicAgent implements Agent {
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

class OpenAIAgent implements Agent {
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

export function createAgent(provider: Provider = 'ollama', model?: string, systemPrompt?: string): Agent {
  const resolvedModel = model ?? DEFAULT_MODELS[provider]
  switch (provider) {
    case 'anthropic': {
      return new AnthropicAgent(resolvedModel, systemPrompt)
    }

    case 'ollama': {
      return new OllamaAgent(resolvedModel, systemPrompt)
    }

    case 'openai': {
      return new OpenAIAgent(resolvedModel, systemPrompt)
    }
  }
}
