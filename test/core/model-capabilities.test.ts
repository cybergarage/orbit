// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Check independent metadata fixtures sequentially. */
import {expect} from 'chai'
import {restore, stub, useFakeTimers} from 'sinon'

import type {Model, ModelCapabilities} from '../../src/core/index.js'
import type {AnthropicAgentOptions} from '../../src/core/models/adapters/anthropic.js'
import type {OllamaAgentOptions} from '../../src/core/models/adapters/ollama.js'

import {AnthropicAgent} from '../../src/core/models/adapters/anthropic.js'
import {AppleFoundationModelsAgent} from '../../src/core/models/adapters/apple.js'
import {OllamaAgent} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'
import {ollamaToolCapability} from '../../src/core/models/adapters/provider-capabilities.js'
import {canIncludeModelTools, createProvider, Message, MessageType, resolveModelCapabilities} from '../../src/index.js'

function legacy(): Model {
  return {
    getModel: () => 'gpt-4o',
    getName: () => 'fixture',
    getProvider: () => 'openai',
    async invoke() {
      throw new Error('Capability discovery must not generate')
    },
  }
}

async function rejects(pending: Promise<unknown>, text: string) {
  try {
    await pending
  } catch (error) {
    expect(String(error)).contains(text)
    return
  }

  throw new Error('Expected rejection')
}

function local(value: unknown, fail = false) {
  let calls = 0
  const client = {
    abort() {
      throw new Error('Do not abort shared inference')
    },
    async chat() {
      throw new Error('Discovery must not generate')
    },
    async ps() {
      throw new Error('Tool discovery needs only show')
    },
    async show(input: {model: string}) {
      calls++
      expect(input.model).equals('selected:tag')
      if (fail) throw new Error('Private transport detail')
      return value
    },
  } as unknown as OllamaAgentOptions['client']
  return {calls: () => calls, model: new OllamaAgent('selected:tag', createProvider('ollama'), {client})}
}

function claude(value: unknown, baseURL: null | string = 'https://api.anthropic.com', fail = false) {
  let calls = 0
  const client = {
    baseURL: baseURL ?? undefined,
    messages: {
      async create() {
        throw new Error('Discovery must not generate')
      },
    },
    models: {
      async retrieve(
        id: string,
        _params: unknown,
        options: {headers: Record<string, string>; maxRetries: number; signal: AbortSignal; timeout: number},
      ) {
        calls++
        expect(id).equals('claude-fixture')
        expect(options.maxRetries).equals(0)
        expect(options.timeout).equals(5000)
        expect(options.signal.aborted).equals(false)
        expect(options.headers['anthropic-version']).equals('2026-10-21')
        if (fail) throw new Error('Private transport detail')
        return value
      },
    },
  } as unknown as AnthropicAgentOptions['client']
  return {calls: () => calls, model: new AnthropicAgent('claude-fixture', createProvider('anthropic'), {client})}
}

describe('Runtime model capabilities', () => {
  let openAIBase: string | undefined
  let anthropicBase: string | undefined

  beforeEach(() => {
    openAIBase = process.env.OPENAI_BASE_URL
    anthropicBase = process.env.ANTHROPIC_BASE_URL
    delete process.env.OPENAI_BASE_URL
    delete process.env.ANTHROPIC_BASE_URL
  })

  afterEach(() => {
    restore()
    if (openAIBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = openAIBase
    if (anthropicBase === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = anthropicBase
  })

  it('exports the optional contract/resolver through package, core and models entry points', async () => {
    const core = await import('../../src/core/index.js')
    const models = await import('../../src/core/models/index.js')
    expect(core.resolveModelCapabilities).equals(resolveModelCapabilities)
    expect(models.resolveModelCapabilities).equals(resolveModelCapabilities)
    expect(models.canIncludeModelTools).equals(canIncludeModelTools)
    expect((await resolveModelCapabilities(legacy())).tools).equals('unknown')
  })

  it('permits unknown tool information without changing it to supported or inferring from names', async () => {
    const info = await resolveModelCapabilities(legacy())
    expect(info).deep.equals({model: 'gpt-4o', provider: 'openai', source: 'unknown', tools: 'unknown'})
    const specs = [{description: 'Read-only host opt-in', inputSchema: {type: 'object'}, name: 'optional_search'}]
    expect(canIncludeModelTools(info) ? specs : []).equals(specs)
    expect(info.tools).equals('unknown')
    expect(canIncludeModelTools({tools: 'supported'})).equals(true)
    expect(canIncludeModelTools({tools: 'unsupported'})).equals(false)
  })

  it('normalizes malformed/absent capability values and contains one failed attempt', async () => {
    for (const payload of [undefined, null, {}, {tools: true}, {tools: 'future'}]) {
      const model = {
        ...legacy(),
        async getCapabilities() {
          return payload as ModelCapabilities
        },
      }
      expect((await resolveModelCapabilities(model)).tools).equals('unknown')
    }

    let calls = 0
    const model = {
      ...legacy(),
      async getCapabilities(): Promise<ModelCapabilities> {
        calls++
        throw new Error('Private detail')
      },
    }
    const result = await resolveModelCapabilities(model)
    expect(calls).equals(1)
    expect(result.tools).equals('unknown')
    expect(JSON.stringify(result)).not.contains('Private detail')
  })

  it('preserves explicit unsupported observations and discards identity drift without retrying', async () => {
    const observation = Object.freeze({source: 'adapter' as const, tools: 'unsupported' as const})
    const model = {
      ...legacy(),
      async getCapabilities() {
        return observation
      },
    }
    expect((await resolveModelCapabilities(model)).tools).equals('unsupported')
    let calls = 0
    let id = 'before'
    const changing = {
      ...legacy(),
      async getCapabilities() {
        calls++
        id = 'after'
        return observation
      },
      getModel: () => id,
    }
    expect(await resolveModelCapabilities(changing)).deep.equals({
      model: 'after',
      provider: 'openai',
      source: 'unknown',
      tools: 'unknown',
    })
    expect(calls).equals(1)
  })

  it('normalizes copied bounded named observations independently of general support', async () => {
    const names = ['project_memory_search', 'project_memory_search']
    const model = {
      ...legacy(),
      async getCapabilities(): Promise<ModelCapabilities> {
        return {namedTools: names, source: 'adapter', tools: 'unsupported'}
      },
    }
    const info = await resolveModelCapabilities(model)
    expect(info.namedTools).deep.equals(['project_memory_search'])
    expect(canIncludeModelTools(info)).equals(false)
    names.push('later_change')
    expect(info.namedTools).deep.equals(['project_memory_search'])
    for (const namedTools of [
      null,
      'project_memory_search',
      [null],
      [''],
      ['scope/tool'],
      ['x'.repeat(65)],
      Array.from({length: 65}, () => 'valid'),
    ]) {
      const invalid = {
        ...legacy(),
        async getCapabilities() {
          return {namedTools, source: 'adapter', tools: 'unknown'} as ModelCapabilities
        },
      }
      const result = await resolveModelCapabilities(invalid)
      expect(result).not.have.property('namedTools')
      expect(result.tools).equals('unknown')
      expect(canIncludeModelTools(result)).equals(true)
    }

    expect(
      (
        await resolveModelCapabilities({
          ...legacy(),
          async getCapabilities() {
            return {namedTools: [], source: 'adapter' as const, tools: 'unsupported' as const}
          },
        })
      ).namedTools,
    ).deep.equals([])
  })

  for (const field of ['model', 'provider'] as const)
    it(`discards named observations after ${field} identity drift`, async () => {
      const identity = {model: 'before', provider: 'apple'}
      const model = {
        ...legacy(),
        async getCapabilities() {
          identity[field] = 'after'
          return {namedTools: ['project_memory_search'], source: 'adapter' as const, tools: 'unsupported' as const}
        },
        getModel: () => identity.model,
        getProvider: () => identity.provider,
      }
      const result = await resolveModelCapabilities(model)
      expect(result).not.have.property('namedTools')
      expect(result.tools).equals('unknown')
      expect(result[field]).equals('after')
    })

  it('does not retain names across subsequent model/provider selections or errors', async () => {
    let selected = false
    const model = {
      ...legacy(),
      async getCapabilities() {
        return selected
          ? (undefined as unknown as ModelCapabilities)
          : {namedTools: ['project_memory_search'], source: 'adapter' as const, tools: 'unsupported' as const}
      },
      getModel: () => (selected ? 'new' : 'system'),
      getProvider: () => (selected ? 'custom' : 'apple'),
    }
    expect((await resolveModelCapabilities(model)).namedTools).deep.equals(['project_memory_search'])
    selected = true
    expect(await resolveModelCapabilities(model)).deep.equals({
      model: 'new',
      provider: 'custom',
      source: 'unknown',
      tools: 'unknown',
    })
    expect(
      await resolveModelCapabilities({
        ...model,
        async getCapabilities(): Promise<ModelCapabilities> {
          throw new Error('private')
        },
      }),
    ).not.have.property('namedTools')
  })

  it('bounds non-cooperative discovery and aborts its metadata signal at the deadline', async () => {
    const clock = useFakeTimers()
    try {
      let calls = 0
      let observed: AbortSignal | undefined
      const model = {
        ...legacy(),
        getCapabilities(options?: {signal?: AbortSignal}): Promise<ModelCapabilities> {
          calls++
          observed = options?.signal
          return new Promise(() => {})
        },
      }
      const pending = resolveModelCapabilities(model)
      await clock.tickAsync(5000)
      expect((await pending).tools).equals('unknown')
      expect(observed?.aborted).equals(true)
      expect(calls).equals(1)
    } finally {
      clock.restore()
    }
  })

  it('propagates cancellation before and during discovery without invoking or retrying generation', async () => {
    const controller = new AbortController()
    let calls = 0
    const model = {
      ...legacy(),
      getCapabilities(): Promise<ModelCapabilities> {
        calls++
        return new Promise(() => {})
      },
    }
    const pending = rejects(resolveModelCapabilities(model, {signal: controller.signal}), 'cancel fixture')
    await Promise.resolve()
    controller.abort(new Error('cancel fixture'))
    await pending
    expect(calls).equals(1)
    await rejects(resolveModelCapabilities(model, {signal: controller.signal}), 'cancel fixture')
    expect(calls).equals(1)
  })

  it('reports the Apple adapter restriction without probing the Apple SDK or helper', async () => {
    const model = new AppleFoundationModelsAgent('system', createProvider('apple'), {
      transport: {
        async request() {
          throw new Error('No helper probe permitted')
        },
      },
    })
    expect(await resolveModelCapabilities(model)).deep.equals({
      model: 'system',
      provider: 'apple',
      source: 'adapter',
      tools: 'unsupported',
    })
    const tools = [{description: 'fixture', inputSchema: {type: 'object'}, name: 'search'}]
    expect(() => model.prepare([new Message(MessageType.User, {content: 'fixture'})], {tools})).throws(
      'does not support tools',
    )
  })

  for (const [name, metadata, expected] of [
    ['explicit tools', {capabilities: ['completion', 'tools']}, 'supported'],
    ['text-only', {capabilities: ['completion']}, 'unsupported'],
    ['empty explicit list', {capabilities: []}, 'unsupported'],
    ['absent metadata', {}, 'unknown'],
    ['unrecognized feature', {capabilities: ['future-capability']}, 'unknown'],
    ['wrong type', {capabilities: 'tools'}, 'unknown'],
    ['malformed list', {capabilities: ['tools', null]}, 'unknown'],
  ] as const) {
    it(`resolves Ollama ${name} for the selected model only`, async () => {
      const fixture = local(metadata)
      expect((await resolveModelCapabilities(fixture.model)).tools).equals(expected)
      expect(fixture.calls()).equals(1)
      expect(ollamaToolCapability(metadata)).equals(expected)
    })
  }

  it('returns unknown for missing/failed Ollama discovery and keeps invocation specifications unchanged', async () => {
    const fixture = local(undefined, true)
    expect((await resolveModelCapabilities(fixture.model)).tools).equals('unknown')
    expect(fixture.calls()).equals(1)
    const model = new OllamaAgent('legacy', createProvider('ollama'), {
      client: {
        abort() {},
        async chat() {
          throw new Error('No generation')
        },
      } as OllamaAgentOptions['client'],
    })
    expect((await resolveModelCapabilities(model)).tools).equals('unknown')
    const textOnly = local({capabilities: ['completion']}).model
    const specs = [{description: 'fixture', inputSchema: {type: 'object'}, name: 'explicit_tool'}]
    expect(canIncludeModelTools(await resolveModelCapabilities(textOnly))).equals(false)
    expect(textOnly.prepare([], {tools: specs}).request.tools).length(1)
  })

  it('uses one bounded native Ollama show request without generating', async () => {
    let signal: AbortSignal | undefined
    let calls = 0
    stub(globalThis, 'fetch').callsFake(async (input, options) => {
      calls++
      expect(String(input)).equals('http://127.0.0.1:19590/api/show')
      expect(JSON.parse(String(options?.body)).model).equals('selected:tag')
      signal = options?.signal ?? undefined
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Response is available on supported Node 20.19.
      return new Response(JSON.stringify({capabilities: ['tools']}))
    })
    const model = new OllamaAgent(
      'selected:tag',
      createProvider('ollama', {providers: {ollama: {host: 'http://127.0.0.1:19590'}}}),
    )
    expect((await resolveModelCapabilities(model)).tools).equals('supported')
    expect(calls).equals(1)
    expect(signal?.aborted).equals(false)
  })

  it('propagates native Ollama metadata cancellation without retrying or aborting generation', async () => {
    const controller = new AbortController()
    let observed: AbortSignal | undefined
    let calls = 0
    let started!: () => void
    const requested = new Promise<void>((resolve) => {
      started = resolve
    })
    stub(globalThis, 'fetch').callsFake((_input, options) => {
      calls++
      observed = options?.signal ?? undefined
      started()
      return new Promise((_resolve, reject) => {
        observed?.addEventListener('abort', () => reject(observed?.reason), {once: true})
      })
    })
    const model = new OllamaAgent('fixture', createProvider('ollama'))
    const pending = rejects(model.getCapabilities({signal: controller.signal}), 'cancel metadata')
    await requested
    expect(calls).equals(1)
    controller.abort(new Error('cancel metadata'))
    await pending
    expect(observed?.aborted).equals(true)
    expect(calls).equals(1)
  })

  it('bounds direct Anthropic discovery as well as resolver discovery', async () => {
    const clock = useFakeTimers()
    try {
      let observed: AbortSignal | undefined
      const client = {
        baseURL: 'https://api.anthropic.com',
        messages: {},
        models: {
          retrieve(_id: string, _params: unknown, options: {signal: AbortSignal}) {
            observed = options.signal
            return new Promise(() => {})
          },
        },
      } as unknown as AnthropicAgentOptions['client']
      const model = new AnthropicAgent('fixture', createProvider('anthropic'), {client})
      const pending = model.getCapabilities()
      await clock.tickAsync(5000)
      expect((await pending).tools).equals('unknown')
      expect(observed?.aborted).equals(true)
    } finally {
      clock.restore()
    }
  })

  it('uses the native OpenAI exact-ID catalog without constructing a credentialed client or probing', async () => {
    for (const id of ['gpt-4o', 'gpt-4.1', 'gpt-5.4']) {
      expect(await resolveModelCapabilities(new OpenAIAgent(id, createProvider('openai')))).deep.equals({
        model: id,
        provider: 'openai',
        source: 'catalog',
        tools: 'supported',
      })
    }

    for (const id of ['gpt-future', 'gpt-4o-unlisted-snapshot', 'ft:gpt-4o:fixture']) {
      expect((await resolveModelCapabilities(new OpenAIAgent(id, createProvider('openai')))).tools).equals('unknown')
    }
  })

  it('does not bless OpenAI-compatible routes, conflicting host configuration or unidentified clients', async () => {
    process.env.OPENAI_BASE_URL = 'https://compatible.example/v1'
    expect((await resolveModelCapabilities(new OpenAIAgent('gpt-4o', createProvider('openai')))).tools).equals(
      'unknown',
    )
    delete process.env.OPENAI_BASE_URL
    const provider = createProvider('openai', {providers: {openai: {host: 'https://compatible.example/v1'}}})
    expect((await resolveModelCapabilities(new OpenAIAgent('gpt-4o', provider))).tools).equals('unknown')
    const chat = {
      completions: {
        async create() {
          throw new Error('No generation')
        },
      },
    } as never
    expect(
      (await resolveModelCapabilities(new OpenAIAgent('gpt-4o', createProvider('openai'), {client: {chat}}))).tools,
    ).equals('unknown')
    const pinned = new OpenAIAgent('gpt-4o', createProvider('openai'), {
      client: {baseURL: 'https://api.openai.com/v1/', chat},
    })
    process.env.OPENAI_BASE_URL = 'https://compatible.example/v1'
    expect((await resolveModelCapabilities(pinned)).tools).equals('supported')
  })

  it('uses only matching active native Anthropic metadata, with retries disabled', async () => {
    const fixture = claude({id: 'claude-fixture', lifecycle: 'active', type: 'model'})
    expect((await resolveModelCapabilities(fixture.model)).tools).equals('supported')
    expect(fixture.calls()).equals(1)
    for (const metadata of [
      {},
      {id: 'claude-fixture', type: 'model'},
      {id: 'claude-fixture', lifecycle: 'retired', type: 'model'},
      {id: 'other-model', lifecycle: 'active', type: 'model'},
      {id: 'claude-fixture', lifecycle: 'active', type: 'unknown'},
    ]) {
      const next = claude(metadata)
      expect((await resolveModelCapabilities(next.model)).tools).equals('unknown')
      expect(next.calls()).equals(1)
    }
  })

  it('keeps Anthropic failures and unknown routes unknown without remote listing or generation', async () => {
    const failed = claude(undefined, 'https://api.anthropic.com', true)
    expect((await resolveModelCapabilities(failed.model)).tools).equals('unknown')
    expect(failed.calls()).equals(1)
    for (const url of ['https://compatible.example', 'https://api.anthropic.com/proxy', 'http://api.anthropic.com']) {
      const next = claude({id: 'claude-fixture', lifecycle: 'active', type: 'model'}, url)
      expect((await resolveModelCapabilities(next.model)).tools).equals('unknown')
      expect(next.calls()).equals(0)
    }

    const unidentified = claude(undefined, null)
    expect((await resolveModelCapabilities(unidentified.model)).tools).equals('unknown')
    expect(unidentified.calls()).equals(0)
    process.env.ANTHROPIC_BASE_URL = 'https://compatible.example'
    expect(
      (await resolveModelCapabilities(new AnthropicAgent('claude-fixture', createProvider('anthropic')))).tools,
    ).equals('unknown')
  })
})
