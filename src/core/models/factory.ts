// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model} from './model.js'
import type {Provider} from './provider.js'

import {AnthropicAgent} from './adapters/anthropic.js'
import {OllamaAgent} from './adapters/ollama.js'
import {OpenAIAgent} from './adapters/openai.js'

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
}

export function getModel(provider: Provider = 'ollama', model?: string): Model {
  const resolvedModel = model ?? DEFAULT_MODELS[provider]
  switch (provider) {
    case 'anthropic': {
      return new AnthropicAgent(resolvedModel)
    }

    case 'ollama': {
      return new OllamaAgent(resolvedModel)
    }

    case 'openai': {
      return new OpenAIAgent(resolvedModel)
    }
  }
}
