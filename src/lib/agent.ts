// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import Anthropic from '@anthropic-ai/sdk'
import {Ollama} from 'ollama'
import OpenAI from 'openai'

export type Provider = 'anthropic' | 'ollama' | 'openai'

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
}

export interface Agent {
  chat(msg: string): Promise<string>
}

class OllamaAgent implements Agent {
  private readonly client = new Ollama()

  constructor(
    private readonly model: string,
    private readonly systemPrompt?: string,
  ) {}

  async chat(msg: string): Promise<string> {
    const messages: {content: string; role: 'system' | 'user'}[] = []
    if (this.systemPrompt) {
      messages.push({content: this.systemPrompt, role: 'system'})
    }

    messages.push({content: msg, role: 'user'})

    const response = await this.client.chat({messages, model: this.model})
    return response.message.content
  }
}

class AnthropicAgent implements Agent {
  private readonly client = new Anthropic()

  constructor(
    private readonly model: string,
    private readonly systemPrompt?: string,
  ) {}

  async chat(msg: string): Promise<string> {
    const response = await this.client.messages.create({
      maxTokens: 8096,
      messages: [{content: msg, role: 'user'}],
      model: this.model,
      ...(this.systemPrompt ? {system: this.systemPrompt} : {}),
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

  async chat(msg: string): Promise<string> {
    const messages: {content: string; role: 'system' | 'user'}[] = []
    if (this.systemPrompt) {
      messages.push({content: this.systemPrompt, role: 'system'})
    }

    messages.push({content: msg, role: 'user'})

    const response = await this.client.chat.completions.create({
      messages,
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
