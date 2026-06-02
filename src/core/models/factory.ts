// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {WorkspaceSettings} from '../settings.js'
import type {Model} from './model.js'
import type {ProviderName} from './provider.js'

import {AnthropicAgent} from './adapters/anthropic.js'
import {OllamaAgent} from './adapters/ollama.js'
import {OpenAIAgent} from './adapters/openai.js'
import {createProvider} from './provider.js'

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
}

export function getModel(provider: ProviderName = 'ollama', model?: string, settings?: WorkspaceSettings): Model {
  const resolvedModel = model ?? DEFAULT_MODELS[provider]
  const providerConfig = createProvider(provider, settings)
  switch (provider) {
    case 'anthropic': {
      return new AnthropicAgent(resolvedModel, providerConfig)
    }

    case 'ollama': {
      return new OllamaAgent(resolvedModel, providerConfig)
    }

    case 'openai': {
      return new OpenAIAgent(resolvedModel, providerConfig)
    }
  }
}
