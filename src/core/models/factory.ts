// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Agent} from './agent.js'
import type {Provider} from './provider.js'

import {AnthropicAgent} from './adapters/anthropic.js'
import {OllamaAgent} from './adapters/ollama.js'
import {OpenAIAgent} from './adapters/openai.js'

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
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
