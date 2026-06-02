// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {WorkspaceSettings} from '../settings.js'

const providers = ['anthropic', 'ollama', 'openai'] as const

export type ProviderName = (typeof providers)[number]

export interface Provider {
  getAPIKey(): string | undefined
  getHost(): string | undefined
  getName(): ProviderName
}

export function getProviderNames(): ProviderName[] {
  return [...providers]
}

export function getProvider(): ProviderName[] {
  return getProviderNames()
}

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && providers.includes(value as ProviderName)
}

export function isProvider(value: unknown): value is ProviderName {
  return isProviderName(value)
}

export function createProvider(name: ProviderName, settings?: WorkspaceSettings): Provider {
  return new SettingsProvider(name, settings)
}

class SettingsProvider implements Provider {
  constructor(
    private readonly name: ProviderName,
    private readonly settings?: WorkspaceSettings,
  ) {}

  getAPIKey(): string | undefined {
    const apiKeyEnv = this.getAPIKeyEnv()
    if (apiKeyEnv !== undefined) {
      const apiKey = process.env[apiKeyEnv]
      if (apiKey === undefined) {
        throw new Error(`${this.name} API key environment variable is not set: ${apiKeyEnv}`)
      }

      return apiKey
    }

    return this.getConfiguredAPIKey()
  }

  getHost(): string | undefined {
    if (this.name !== 'ollama') return undefined
    return this.settings?.providers?.ollama?.host
  }

  getName(): ProviderName {
    return this.name
  }

  private getAPIKeyEnv(): string | undefined {
    if (this.name === 'anthropic') return this.settings?.providers?.anthropic?.apiKeyEnv
    if (this.name === 'openai') return this.settings?.providers?.openai?.apiKeyEnv
    return undefined
  }

  private getConfiguredAPIKey(): string | undefined {
    if (this.name === 'anthropic') return this.settings?.providers?.anthropic?.apiKey
    if (this.name === 'openai') return this.settings?.providers?.openai?.apiKey
    return undefined
  }
}
