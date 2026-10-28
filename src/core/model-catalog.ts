// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Wire fields retain provider spelling. Node 20 fetch is supported; catalog pagination/batches are sequential.
/* eslint-disable camelcase, no-await-in-loop, n/no-unsupported-features/node-builtins */
import {Anthropic} from '@anthropic-ai/sdk'
import {createHash} from 'node:crypto'
import {OpenAI} from 'openai'

import type {ModelSelection} from './session/model-selection.js'
import type {WorkspaceSettings} from './settings.js'

import {createAnthropicOptions} from './models/adapters/anthropic.js'
import {supportsOpenAIChatTools} from './models/adapters/openai-capabilities.js'
import {createOpenAIOptions} from './models/adapters/openai.js'
import {createProvider} from './models/provider.js'

export type CodingProvider = 'anthropic' | 'ollama' | 'openai'
export interface CatalogModel extends ModelSelection {
  label: string
  tools: true
}
export interface CatalogProvider {
  credential: 'list-verified' | 'missing' | 'not-required' | 'present' | 'rejected'
  label: string
  message?: string
  models: CatalogModel[]
  provider: CodingProvider
  status: 'authentication-rejected' | 'available' | 'listing-failed' | 'unavailable' | 'unconfigured' | 'unsupported'
}
export interface ModelCatalogSnapshot {
  checkedAt: number
  expiresAt: number
  providers: CatalogProvider[]
}
export interface ModelCatalogOptions {
  cacheMs?: number
  fetcher?: typeof fetch
  listRemote?: (
    provider: 'anthropic' | 'openai',
    settings: WorkspaceSettings,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>[]>
  now?: () => number
  timeoutMs?: number
}
const definitions = [
  {label: 'Ollama', provider: 'ollama'},
  {label: 'Claude (Anthropic)', provider: 'anthropic'},
  {label: 'OpenAI', provider: 'openai'},
] as const
/** Uses precisely the credential precedence used by the execution SDKs. Never return this value to a renderer. */
export function modelCredential(provider: 'anthropic' | 'openai', settings: WorkspaceSettings): string | undefined {
  try {
    const explicit = createProvider(provider, settings).getAPIKey()
    const value = explicit ?? process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']
    return value?.trim() ? value : undefined
  } catch {
    return undefined
  }
}

function errorStatus(error: unknown): CatalogProvider['status'] {
  const status = (error as {status?: number})?.status
  return status === 401 || status === 403 ? 'authentication-rejected' : 'listing-failed'
}

async function remoteModels(
  provider: 'anthropic' | 'openai',
  settings: WorkspaceSettings,
  signal: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const connection = createProvider(provider, settings)
  if (provider === 'openai') {
    const client = new OpenAI({...createOpenAIOptions(connection), logLevel: 'off', maxRetries: 0, timeout: 5000})
    const page = await client.models.list({signal})
    if (page.data.length > 1000) throw new Error('Catalog limit')
    return page.data as unknown as Record<string, unknown>[]
  }

  const client = new Anthropic({...createAnthropicOptions(connection), logLevel: 'off', maxRetries: 0, timeout: 5000})
  const result: Record<string, unknown>[] = []
  let after: string | undefined
  for (let page = 0; page < 10; page++) {
    const response = await client.models.list(
      {limit: 100, ...(after ? {after_id: after} : {})},
      {headers: {'anthropic-version': '2026-10-21'}, signal},
    )
    result.push(...(response.data as unknown as Record<string, unknown>[]))
    if (!response.hasNextPage()) return result
    const last = response.data.at(-1)?.id
    if (!last || last === after) throw new Error('Catalog pagination failed')
    after = last
  }

  throw new Error('Catalog limit')
}

/** Credential-aware read-only discovery. Listing authentication does not establish inference entitlement. */
export class ModelCatalog {
  private readonly cache = new Map<string, {expires: number; promise: Promise<ModelCatalogSnapshot>}>()
  private readonly now: () => number
  private readonly timeout: number
  private readonly ttl: number

  constructor(private readonly options: ModelCatalogOptions = {}) {
    this.now = options.now ?? Date.now
    this.timeout = Math.min(10_000, Math.max(100, options.timeoutMs ?? 5000))
    this.ttl = Math.min(60_000, Math.max(0, options.cacheMs ?? 30_000))
  }

  async list(settings: WorkspaceSettings = {}, options: {refresh?: boolean} = {}): Promise<ModelCatalogSnapshot> {
    const key = createHash('sha256')
      .update(
        JSON.stringify({
          anthropic: modelCredential('anthropic', settings),
          anthropicBase: process.env.ANTHROPIC_BASE_URL,
          openai: modelCredential('openai', settings),
          openaiBase: process.env.OPENAI_BASE_URL,
          providers: settings.providers,
        }),
      )
      .digest('hex')
    const cached = this.cache.get(key)
    if (!options.refresh && cached && cached.expires > this.now()) return structuredClone(await cached.promise)
    const checkedAt = this.now()
    const promise = Promise.all(definitions.map((definition) => this.discover(definition, settings))).then(
      (providers) => ({checkedAt, expiresAt: checkedAt + this.ttl, providers}),
    )
    this.cache.set(key, {expires: checkedAt + this.ttl, promise})
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!)
    return structuredClone(await promise)
  }

  async requireSelection(settings: WorkspaceSettings, selection: ModelSelection): Promise<void> {
    const snapshot = await this.list(settings, {refresh: true})
    if (
      !snapshot.providers.some(
        (provider) =>
          provider.status === 'available' &&
          provider.provider === selection.provider &&
          provider.models.some((model) => model.model === selection.model),
      )
    )
      throw new Error('Selected provider/model is unavailable or unsupported. Refresh the model catalog.')
  }

  private async discover(
    definition: (typeof definitions)[number],
    settings: WorkspaceSettings,
  ): Promise<CatalogProvider> {
    const {label, provider} = definition
    const base: CatalogProvider = {
      credential: provider === 'ollama' ? 'not-required' : 'missing',
      label,
      models: [],
      provider,
      status: 'unavailable',
    }
    if (provider !== 'ollama' && !modelCredential(provider, settings))
      return {...base, message: 'No API key configured', status: 'unconfigured'}
    const signal = AbortSignal.timeout(this.timeout)
    try {
      let models: CatalogModel[]
      if (provider === 'ollama') models = await this.localModels(settings, signal)
      else {
        const records = await (this.options.listRemote ?? remoteModels)(provider, settings, signal)
        models = records
          .filter((record) => {
            if (
              typeof record.id !== 'string' ||
              record.id.length > 200 ||
              record.lifecycle === 'retired' ||
              record.lifecycle === 'deprecated'
            )
              return false
            if (provider === 'openai') return supportsOpenAIChatTools(record.id)
            // The active Claude Models API contract covers text output and client tool use.
            // Unknown legacy records are excluded rather than inferring capability from an ID prefix.
            return record.lifecycle === 'active' && record.type === 'model'
          })
          .map((record) => ({
            label: typeof record.display_name === 'string' ? record.display_name : (record.id as string),
            model: record.id as string,
            provider,
            tools: true,
          }))
      }

      models = [...new Map(models.map((model) => [model.model, model])).values()]
      return {
        ...base,
        credential: provider === 'ollama' ? 'not-required' : 'list-verified',
        models,
        status: models.length > 0 ? 'available' : 'unsupported',
        ...(models.length > 0 ? {} : {message: 'No compatible tool-capable models returned'}),
      }
    } catch (error) {
      const status = provider === 'ollama' ? 'unavailable' : errorStatus(error)
      return {
        ...base,
        credential:
          provider === 'ollama' ? 'not-required' : status === 'authentication-rejected' ? 'rejected' : 'present',
        message:
          status === 'authentication-rejected'
            ? 'Models API authentication was rejected'
            : 'Model listing unavailable; retry discovery',
        status,
      }
    }
  }

  private async localModels(settings: WorkspaceSettings, signal: AbortSignal): Promise<CatalogModel[]> {
    const fetcher = this.options.fetcher ?? fetch
    const host = settings.providers?.ollama?.host ?? 'http://127.0.0.1:11434'
    const response = await fetcher(new URL('/api/tags', host), {signal})
    if (!response.ok) throw new Error('Local service unavailable')
    const data = (await response.json()) as {models?: {name: string}[]}
    if (!Array.isArray(data.models) || data.models.length > 128) throw new Error('Invalid local catalog')
    const result: CatalogModel[] = []
    // Small batches share one total timeout; discovery never loads or downloads a model.
    for (let index = 0; index < data.models.length; index += 4) {
      const group = await Promise.all(
        data.models.slice(index, index + 4).map(async (entry) => {
          if (typeof entry.name !== 'string' || !entry.name || entry.name.length > 200) return
          const shown = await fetcher(new URL('/api/show', host), {
            body: JSON.stringify({model: entry.name}),
            headers: {'Content-Type': 'application/json'},
            method: 'POST',
            signal,
          })
          if (!shown.ok) throw new Error('Local capability discovery failed')
          const details = (await shown.json()) as {capabilities?: string[]}
          return details.capabilities?.includes('tools')
            ? {label: entry.name, model: entry.name, provider: 'ollama' as const, tools: true as const}
            : undefined
        }),
      )
      result.push(...group.filter((entry): entry is CatalogModel & {provider: 'ollama'} => entry !== undefined))
    }

    return result
  }
}
