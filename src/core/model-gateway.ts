// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Wire fields retain provider spelling. Node 20 fetch is supported; catalog pagination/batches are sequential.
/* eslint-disable camelcase, n/no-unsupported-features/node-builtins */
import {Anthropic} from '@anthropic-ai/sdk'
import {OpenAI} from 'openai'

import type {ModelSelection} from './session/model-selection.js'
import type {WorkspaceSettings} from './settings.js'

import {modelCredential} from './model-catalog.js'
import {createAnthropicOptions} from './models/adapters/anthropic.js'
import {createOpenAIOptions} from './models/adapters/openai.js'
import {createProvider} from './models/provider.js'
import {modelSelectionSchema} from './session/model-selection.js'

export const modelGatewayRoutes = {
  anthropic: ['anthropic-messages', 'anthropic-model'],
  ollama: ['chat', 'show', 'ps'],
  openai: ['openai-chat'],
} as const
export interface ModelGatewayOptions {
  anthropic?: Pick<Anthropic, 'messages' | 'models'>
  fetcher?: typeof fetch
  openai?: Pick<OpenAI, 'chat'>
}
/** Host-only transport for an already admitted selection. Credentials never enter worker configuration. */
export class ModelGateway {
  private readonly selection: ModelSelection

  constructor(
    private readonly settings: WorkspaceSettings,
    selection: ModelSelection,
    private readonly options: ModelGatewayOptions = {},
  ) {
    this.selection = modelSelectionSchema.parse(selection)
    if (!Object.hasOwn(modelGatewayRoutes, selection.provider)) throw new Error('Unsupported model provider')
  }

  async request(route: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    const provider = this.selection.provider as keyof typeof modelGatewayRoutes
    if (!(modelGatewayRoutes[provider] as readonly string[]).includes(route))
      throw new Error('Model route does not match the admitted provider')
    if (JSON.stringify(body ?? {}).length > 512_000) throw new Error('Model request too large')
    const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>
    if (provider !== 'ollama' && input.model !== undefined && input.model !== this.selection.model)
      throw new Error('Model does not match the admitted selection')
    const bound = AbortSignal.any([signal, AbortSignal.timeout(210_000)])
    try {
      if (provider === 'ollama') return await this.local(route, input, bound)
      if (!modelCredential(provider, this.settings) && !this.options[provider]) throw new Error('Missing credential')
      const connection = createProvider(provider, this.settings)
      if (provider === 'openai') {
        const client =
          this.options.openai ?? new OpenAI({...createOpenAIOptions(connection), logLevel: 'off', maxRetries: 0})
        const request = {
          max_completion_tokens: 1024,
          messages: input.messages,
          model: this.selection.model,
          stream: false,
          tools: input.tools,
          ...((input.response_format as {type?: string})?.type === 'json_object'
            ? {response_format: {type: 'json_object'}}
            : {}),
        }
        return await client.chat.completions.create(request as Parameters<typeof client.chat.completions.create>[0], {
          signal: bound,
        })
      }

      const client =
        this.options.anthropic ?? new Anthropic({...createAnthropicOptions(connection), logLevel: 'off', maxRetries: 0})
      if (route === 'anthropic-model')
        return await client.models.retrieve(this.selection.model, undefined, {
          headers: {'anthropic-version': '2026-10-21'},
          signal: bound,
          timeout: 5000,
        })
      const request = {
        max_tokens: 1024,
        messages: input.messages,
        model: this.selection.model,
        stream: false,
        system: input.system,
        tools: input.tools,
      }
      return await client.messages.create(request as Parameters<typeof client.messages.create>[0], {signal: bound})
    } catch {
      if (signal.aborted) throw new Error('Model request cancelled')
      // Provider SDK errors can contain request headers and response bodies. Never forward them.
      throw new Error('Model request failed; check provider availability and credentials')
    }
  }

  private async local(route: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const payload =
      route === 'ps'
        ? undefined
        : route === 'show'
          ? {model: this.selection.model}
          : {
              ...body,
              keep_alive: '60s',
              model: this.selection.model,
              options: {num_ctx: 8192, num_predict: 1024, seed: 42, temperature: 0},
              stream: false,
              think: false,
            }
    const response = await (this.options.fetcher ?? fetch)(
      new URL('/api/' + route, this.settings.providers?.ollama?.host ?? 'http://127.0.0.1:11434'),
      {
        body: payload ? JSON.stringify(payload) : undefined,
        headers: {'Content-Type': 'application/json'},
        method: payload ? 'POST' : 'GET',
        signal,
      },
    )
    if (!response.ok) throw new Error('Local model unavailable')
    return response.json()
  }
}
