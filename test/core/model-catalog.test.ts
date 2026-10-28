// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Wire fields retain provider spelling. Node 20 fetch is supported; catalog pagination/batches are sequential.
/* eslint-disable n/no-unsupported-features/node-builtins */
import {expect} from 'chai'

import type {WorkspaceSettings} from '../../src/core/index.js'

import {ModelCatalog} from '../../src/core/index.js'
const absent: WorkspaceSettings = {
  providers: {
    anthropic: {apiKeyEnv: 'ORBIT_TEST_ABSENT_CLAUDE_KEY'},
    openai: {apiKeyEnv: 'ORBIT_TEST_ABSENT_OPENAI_KEY'},
  },
}
const unavailable: typeof fetch = async () => {
  throw new Error('Service unavailable')
}

const configured: WorkspaceSettings = {providers: {...absent.providers, openai: {apiKey: 'fake-test-openai'}}}
const both: WorkspaceSettings = {
  providers: {anthropic: {apiKey: 'fake-test-claude'}, openai: {apiKey: 'fake-test-openai'}},
}
describe('ModelCatalog', () => {
  it('excludes missing-key providers without attempting remote listing', async () => {
    let calls = 0
    const catalog = new ModelCatalog({
      fetcher: unavailable,
      async listRemote() {
        calls++
        return []
      },
    })
    const result = await catalog.list(absent)
    expect(calls).equal(0)
    expect(
      result.providers
        .filter((provider) => provider.provider !== 'ollama')
        .every((provider) => provider.status === 'unconfigured' && provider.models.length === 0),
    ).equal(true)
    expect(result.providers[0].status).equal('unavailable')
  })

  it('reports authentication and listing errors without exposing keys or raw errors', async () => {
    const catalog = new ModelCatalog({
      fetcher: unavailable,
      async listRemote(provider) {
        throw Object.assign(new Error('SECRET Authorization fake-test-openai'), {
          status: provider === 'openai' ? 401 : 429,
        })
      },
    })
    const result = await catalog.list(both)
    expect(result.providers.find((provider) => provider.provider === 'openai')).include({
      credential: 'rejected',
      status: 'authentication-rejected',
    })
    expect(result.providers.find((provider) => provider.provider === 'anthropic')).include({
      credential: 'present',
      status: 'listing-failed',
    })
    expect(JSON.stringify(result)).not.contain('SECRET').and.not.contain('fake-test')
    expect(result.providers.every((provider) => provider.models.length === 0)).equal(true)
  })

  it('intersects remote availability with adapter compatibility and does not invent entries', async () => {
    const catalog = new ModelCatalog({
      fetcher: unavailable,
      listRemote: async (provider) =>
        provider === 'openai'
          ? [{id: 'gpt-4o'}, {id: 'whisper-1'}, {id: 'unknown-future-model'}]
          : [
              {id: 'claude-listed', lifecycle: 'active', type: 'model'},
              {id: 'retired', lifecycle: 'retired', type: 'model'},
              {id: 'unknown-legacy', type: 'model'},
            ],
    })
    const result = await catalog.list(both)
    expect(
      result.providers.find((provider) => provider.provider === 'openai')?.models.map((model) => model.model),
    ).deep.equal(['gpt-4o'])
    expect(
      result.providers.find((provider) => provider.provider === 'anthropic')?.models.map((model) => model.model),
    ).deep.equal(['claude-listed'])
    expect(result.providers.find((provider) => provider.provider === 'anthropic')?.label).equal('Claude (Anthropic)')
    expect(result.providers.find((provider) => provider.provider === 'openai')?.credential).equal('list-verified')
  })

  it('lists only installed tool-capable local models and bounds local service waits', async () => {
    const catalog = new ModelCatalog({
      fetcher: async (url, options) =>
        String(url).endsWith('/tags')
          ? new Response(JSON.stringify({models: [{name: 'tools'}, {name: 'text-only'}]}))
          : new Response(
              JSON.stringify({
                capabilities: JSON.parse(String(options?.body)).model === 'tools' ? ['tools'] : ['completion'],
              }),
            ),
    })
    expect((await catalog.list(absent)).providers[0].models.map((model) => model.model)).deep.equal(['tools'])
    const timed = new ModelCatalog({
      fetcher: (_url, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')), {once: true})
        }),
      timeoutMs: 100,
    })
    expect((await timed.list(absent)).providers[0].status).equal('unavailable')
  })

  it('caches bounded snapshots, separates credentials, and removes stale entries on failed refresh', async () => {
    let calls = 0
    let fail = false
    let now = 1000
    const catalog = new ModelCatalog({
      fetcher: unavailable,
      async listRemote() {
        calls++
        if (fail) throw Object.assign(new Error('private'), {status: 403})
        return [{id: 'gpt-4o'}]
      },
      now: () => now,
    })
    await catalog.list(configured)
    await catalog.list(configured)
    expect(calls).equal(1)
    await catalog.list({providers: {...absent.providers, openai: {apiKey: 'different-fake-key'}}})
    expect(calls).equal(2)
    fail = true
    now += 30_001
    const result = await catalog.list(configured)
    expect(result.providers.find((provider) => provider.provider === 'openai')?.models).deep.equal([])
    let rejected = false
    try {
      await catalog.requireSelection(configured, {model: 'gpt-4o', provider: 'anthropic'})
    } catch {
      rejected = true
    }

    expect(rejected).equal(true)
  })
})
