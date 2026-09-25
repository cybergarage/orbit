// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {WorkspaceSettings} from '../settings.js'

const providers = new Set<string>(['anthropic', 'ollama', 'openai'])

export type ProviderName = string

export interface Provider {
  getAPIKey(): string | undefined
  getContextWindow?(): number | undefined
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
  return typeof value === 'string' && providers.has(value)
}

export function isProvider(value: unknown): value is ProviderName {
  return isProviderName(value)
}

export function createProvider(name: ProviderName, settings?: WorkspaceSettings): Provider {
  return new SettingsProvider(name, settings)
}

export function registerProviderName(name: ProviderName): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`Invalid provider name: ${name}`)
  providers.add(name)
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

  getContextWindow(): number | undefined {
    return this.settings?.providers?.[this.name]?.contextWindow
  }

  getHost(): string | undefined {
    return this.settings?.providers?.[this.name]?.host
  }

  getName(): ProviderName {
    return this.name
  }

  private getAPIKeyEnv(): string | undefined {
    return this.settings?.providers?.[this.name]?.apiKeyEnv
  }

  private getConfiguredAPIKey(): string | undefined {
    return this.settings?.providers?.[this.name]?.apiKey
  }
}
