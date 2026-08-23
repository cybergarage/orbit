// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {WorkspaceSettings} from '../settings.js'
import type {Model} from './model.js'
import type {Provider, ProviderName} from './provider.js'

import {AnthropicAgent} from './adapters/anthropic.js'
import {OllamaAgent} from './adapters/ollama.js'
import {OpenAIAgent} from './adapters/openai.js'
import {createProvider, registerProviderName} from './provider.js'

export interface ModelProviderRegistration {
  create(model: string, provider: Provider): Model
  defaultModel: string
  name: ProviderName
}

export class ModelRegistry {
  private readonly registrations = new Map<ProviderName, ModelProviderRegistration>()

  create(providerName: ProviderName, model?: string, settings?: WorkspaceSettings): Model {
    const registration = this.registrations.get(providerName)
    if (registration === undefined) throw new Error(`Unsupported model provider: ${providerName}`)
    return registration.create(model ?? registration.defaultModel, createProvider(providerName, settings))
  }

  get(providerName: ProviderName): ModelProviderRegistration | undefined {
    return this.registrations.get(providerName)
  }

  names(): ProviderName[] {
    return [...this.registrations.keys()]
  }

  register(registration: ModelProviderRegistration): void {
    if (!/^[A-Za-z0-9_-]+$/u.test(registration.name)) {
      throw new Error(`Invalid model provider name: ${registration.name}`)
    }

    if (this.registrations.has(registration.name)) {
      throw new Error(`Model provider is already registered: ${registration.name}`)
    }

    this.registrations.set(registration.name, registration)
  }
}

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-opus-4-6',
  ollama: 'llama3.1',
  openai: 'gpt-4o',
}

const modelRegistry = new ModelRegistry()
modelRegistry.register({
  create: (model, provider) => new AnthropicAgent(model, provider),
  defaultModel: DEFAULT_MODELS.anthropic,
  name: 'anthropic',
})
modelRegistry.register({
  create: (model, provider) => new OllamaAgent(model, provider),
  defaultModel: DEFAULT_MODELS.ollama,
  name: 'ollama',
})
modelRegistry.register({
  create: (model, provider) => new OpenAIAgent(model, provider),
  defaultModel: DEFAULT_MODELS.openai,
  name: 'openai',
})

export function getModel(provider: ProviderName = 'ollama', model?: string, settings?: WorkspaceSettings): Model {
  return modelRegistry.create(provider, model, settings)
}

export function getModelRegistry(): ModelRegistry {
  return modelRegistry
}

export function registerModelProvider(registration: ModelProviderRegistration): void {
  modelRegistry.register(registration)
  DEFAULT_MODELS[registration.name] = registration.defaultModel
  registerProviderName(registration.name)
}
