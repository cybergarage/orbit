// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {AnthropicAgent} from './adapters/anthropic.js'
import {OllamaAgent} from './adapters/ollama.js'
import {OpenAIAgent} from './adapters/openai.js'

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
