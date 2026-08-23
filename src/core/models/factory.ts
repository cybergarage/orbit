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
  defaultModel?: string
  name: ProviderName
}

export class ModelRegistry {
  private readonly registrations = new Map<ProviderName, ModelProviderRegistration>()

  create(providerName: ProviderName, model?: string, settings?: WorkspaceSettings): Model {
    const registration = this.registrations.get(providerName)
    if (registration === undefined) throw new Error(`Unsupported model provider: ${providerName}`)
    const selectedModel = model ?? registration.defaultModel
    if (selectedModel === undefined) throw new Error(`No model specified for provider: ${providerName}`)
    return registration.create(selectedModel, createProvider(providerName, settings))
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

const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-4-6'
const OPENAI_DEFAULT_MODEL = 'gpt-4o'

export const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  openai: OPENAI_DEFAULT_MODEL,
}

const modelRegistry = new ModelRegistry()
modelRegistry.register({
  create: (model, provider) => new AnthropicAgent(model, provider),
  defaultModel: ANTHROPIC_DEFAULT_MODEL,
  name: 'anthropic',
})
modelRegistry.register({
  create: (model, provider) => new OllamaAgent(model, provider),
  name: 'ollama',
})
modelRegistry.register({
  create: (model, provider) => new OpenAIAgent(model, provider),
  defaultModel: OPENAI_DEFAULT_MODEL,
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
  if (registration.defaultModel !== undefined) DEFAULT_MODELS[registration.name] = registration.defaultModel
  registerProviderName(registration.name)
}
