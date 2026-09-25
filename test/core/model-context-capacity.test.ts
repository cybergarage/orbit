// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Provider fixtures use wire field names. */
/* eslint-disable no-await-in-loop -- Exercise each independent fixture and assert its result in order. */
import {expect} from 'chai'
import {useFakeTimers} from 'sinon'

import type {Model, ModelContextInfo} from '../../src/core/index.js'

import {AnthropicAgent, type AnthropicAgentOptions} from '../../src/core/models/adapters/anthropic.js'
import {OllamaAgent, type OllamaAgentOptions} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'
import {readModelMetadata, unknownModelContextInfo} from '../../src/core/models/context-capacity.js'
import {createProvider, resolveModelContextCapacity} from '../../src/index.js'

function local(show: unknown, ps?: unknown, contextWindow?: number) {
  const client = {
    abort() {},
    async chat() {
      throw new Error('Discovery must not generate')
    },
    async ps() {
      return ps ?? {models: []}
    },
    async show() {
      return show
    },
  } as unknown as OllamaAgentOptions['client']
  return new OllamaAgent('fixture', createProvider('ollama', {providers: {ollama: {contextWindow}}}), {client})
}

const metadata = {model_info: {'general.architecture': 'qwen35', 'qwen35.context_length': 262_144}}
function custom(info: Partial<ModelContextInfo> = {}): Model {
  return {
    async getContextInfo() {
      return {...unknownModelContextInfo(), ...info}
    },
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'custom',
    async invoke() {
      throw new Error('Discovery must not generate')
    },
  }
}

async function rejects(action: Promise<unknown>, text: string) {
  try {
    await action
  } catch (error) {
    expect(String(error)).to.contain(text)
    return
  }

  throw new Error('Expected rejection')
}

describe('model context capacity', () => {
  it('exports the resolver through the package entry point', () => {
    expect(resolveModelContextCapacity).to.be.a('function')
  })

  it('separates the Ollama model maximum from the configured runtime and reserves', async () => {
    const model = local(metadata, {models: [{context_length: 65_536, model: 'fixture:latest'}]}, 32_768)
    const result = await resolveModelContextCapacity(model, {outputReserve: 4096, safetyMargin: 256})
    expect(result.contextWindow).to.equal(262_144)
    expect(result.effectiveContextWindow).to.equal(32_768)
    expect(result.inputBudget).to.equal(28_416)
    expect(model.prepare([], {maxOutputTokens: 256}).request.options).to.deep.equal({num_ctx: 32_768, num_predict: 256})
  })

  it('uses loaded context only for the matching model and refreshes metadata', async () => {
    const ps = {
      models: [
        {context_length: 1024, name: 'unrelated'},
        {context_length: 32_768, name: 'fixture:latest'},
      ],
    }
    const model = local(metadata, ps)
    expect((await resolveModelContextCapacity(model)).effectiveContextWindow).to.equal(32_768)
    ps.models[1].context_length = 65_536
    expect((await resolveModelContextCapacity(model)).effectiveContextWindow).to.equal(65_536)
  })

  it('does not claim an unloaded model maximum is an active runtime', async () => {
    const result = await resolveModelContextCapacity(local(metadata))
    expect(result.contextWindow).to.equal(262_144)
    expect(result.effectiveContextWindow).to.equal(null)
    expect(result.inputBudget).to.equal(null)
  })

  it('reads Modelfile num_ctx when no loaded context is available', async () => {
    expect(
      (await resolveModelContextCapacity(local({...metadata, parameters: 'temperature 0.8\nnum_ctx 16384\n'})))
        .effectiveContextWindow,
    ).to.equal(16_384)
  })

  it('bounds explicit runtime overrides by the model maximum and profile ceiling', async () => {
    const model = local(metadata, undefined, 32_768)
    expect((await resolveModelContextCapacity(model, {contextWindow: 65_536})).effectiveContextWindow).to.equal(65_536)
    expect((await resolveModelContextCapacity(model, {contextWindow: 999_999})).effectiveContextWindow).to.equal(
      262_144,
    )
    expect((await resolveModelContextCapacity(model, {windowLimit: 200_000})).effectiveContextWindow).to.equal(32_768)
    expect((await resolveModelContextCapacity(model, {windowLimit: 8192})).effectiveContextWindow).to.equal(8192)
  })

  it('preserves unknown fields and rejects invalid explicit values', async () => {
    const result = await resolveModelContextCapacity(
      local({model_info: {'general.architecture': 'qwen35', 'qwen35.context_length': -1}}),
    )
    expect(result.contextWindow).to.equal(null)
    for (const contextWindow of [0, -1, Infinity, 1.5, Number.NaN]) {
      await rejects(resolveModelContextCapacity(custom(), {contextWindow}), 'Invalid contextWindow')
    }

    await rejects(resolveModelContextCapacity(custom(), {safetyMargin: -1}), 'Invalid context reserve')
  })

  it('reads independent Anthropic input and output limits from API response extensions', async () => {
    let called = ''
    const client = {
      messages: {},
      models: {
        async retrieve(id: string) {
          called = id
          return {max_input_tokens: 200_000, max_tokens: 64_000}
        },
      },
    } as unknown as AnthropicAgentOptions['client']
    const model = new AnthropicAgent('claude-fixture', createProvider('anthropic'), {client})
    const result = await resolveModelContextCapacity(model, {outputReserve: 4096, safetyMargin: 1000})
    expect(called).to.equal('claude-fixture')
    expect(result.maxInputTokens).to.equal(200_000)
    expect(result.maxOutputTokens).to.equal(64_000)
    expect(result.contextWindow).to.equal(null)
    expect(result.inputBudget).to.equal(199_000)
    await rejects(resolveModelContextCapacity(model, {outputReserve: 64_001}), 'output limit')
  })

  it('supports older Anthropic metadata and discovery failure with explicit fallback', async () => {
    for (const response of [{id: 'fixture'}, {max_input_tokens: null, max_tokens: '8192'}]) {
      const client = {
        messages: {},
        models: {
          async retrieve() {
            return response
          },
        },
      } as unknown as AnthropicAgentOptions['client']
      const result = await resolveModelContextCapacity(
        new AnthropicAgent('fixture', createProvider('anthropic'), {client}),
        {outputReserve: 1024, windowLimit: 8192},
      )
      expect(result.source).to.equal('unknown')
      expect(result.inputBudget).to.equal(7168)
    }

    expect(
      await readModelMetadata(async () => {
        throw new Error('Offline')
      }),
    ).to.equal(undefined)
    expect((await resolveModelContextCapacity(custom(), {contextWindow: 4096})).effectiveContextWindow).to.equal(4096)
  })

  it('uses only cataloged OpenAI IDs and applies explicit smaller configuration', async () => {
    for (const [id, window, output] of [
      ['gpt-4o', 128_000, 16_384],
      ['gpt-4.1', 1_047_576, 32_768],
      ['gpt-5.2', 400_000, 128_000],
      ['gpt-5.4', 1_050_000, 128_000],
    ] as const) {
      const model = new OpenAIAgent(id, createProvider('openai'), {client: {} as never})
      const info = await model.getContextInfo()
      expect(info.contextWindow).to.equal(window)
      expect(info.maxOutputTokens).to.equal(output)
    }

    for (const id of ['gpt-4o-unknown', 'ft:gpt-4o:custom', 'toString', 'gpt-5.4-mini']) {
      expect(
        (await new OpenAIAgent(id, createProvider('openai'), {client: {} as never}).getContextInfo()).contextWindow,
      ).to.equal(null)
    }

    const model = new OpenAIAgent('gpt-4o', createProvider('openai', {providers: {openai: {contextWindow: 8192}}}), {
      client: {} as never,
    })
    expect((await resolveModelContextCapacity(model)).effectiveContextWindow).to.equal(8192)
  })

  it('bounds metadata waits and honors cancellation without turning it into fallback', async () => {
    const clock = useFakeTimers()
    try {
      const pending = readModelMetadata(() => new Promise(() => {}))
      await clock.tickAsync(5001)
      expect(await pending).to.equal(undefined)
    } finally {
      clock.restore()
    }

    const controller = new AbortController()
    const pending = readModelMetadata(() => new Promise(() => {}), controller.signal)
    controller.abort(new Error('Cancelled discovery'))
    await rejects(pending, 'Cancelled discovery')
    await rejects(resolveModelContextCapacity(custom(), {signal: controller.signal}), 'Cancelled discovery')
  })
})
