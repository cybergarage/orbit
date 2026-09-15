// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Provider fixtures use exact SDK wire fields. */
import {expect} from 'chai'
import {Ollama} from 'ollama'

import type {Model} from '../../src/core/models/model.js'

import {createProvider, Message, MessageType} from '../../src/core/index.js'
import {AnthropicAgent} from '../../src/core/models/adapters/anthropic.js'
import {OllamaAgent} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'

describe('prepared provider requests', () => {
  for (const provider of ['openai', 'anthropic', 'ollama'] as const)
    it('sends the frozen counted ' + provider + ' projection and cap', async () => {
      let sent: unknown
      let model: Model
      if (provider === 'openai') {
        const client = {
          chat: {
            completions: {
              async create(request: unknown) {
                sent = request
                return {
                  choices: [{finish_reason: 'stop', message: {content: 'ok', refusal: null, role: 'assistant'}}],
                  id: 'reply',
                  model: 'fixture',
                }
              },
            },
          },
        } as unknown as NonNullable<ConstructorParameters<typeof OpenAIAgent>[2]>['client']
        model = new OpenAIAgent('fixture', createProvider(provider), {client})
      } else if (provider === 'anthropic') {
        const client = {
          messages: {
            async create(request: unknown) {
              sent = request
              return {
                content: [{text: 'ok', type: 'text'}],
                id: 'reply',
                model: 'fixture',
                stop_reason: 'end_turn',
                usage: {input_tokens: 1, output_tokens: 1},
              }
            },
          },
        } as unknown as NonNullable<ConstructorParameters<typeof AnthropicAgent>[2]>['client']
        model = new AnthropicAgent('fixture', createProvider(provider), {client})
      } else {
        const client = {
          abort() {},
          async chat(request: unknown) {
            sent = request
            return {
              created_at: new Date(0),
              done: true,
              eval_count: 1,
              message: {content: 'ok', role: 'assistant'},
              model: 'fixture',
              prompt_eval_count: 1,
            }
          },
        } as unknown as NonNullable<ConstructorParameters<typeof OllamaAgent>[2]>['client']
        model = new OllamaAgent('fixture', createProvider(provider), {client})
      }

      const message = new Message(MessageType.User, {content: 'original'})
      const prepared = model.prepare!([message], {
        maxOutputTokens: 123,
        tools: [
          {
            description: 'Read fixture',
            inputSchema: {properties: {path: {type: 'string'}}, required: ['path'], type: 'object'},
            name: 'read',
          },
        ],
      })
      const counted = JSON.stringify(prepared.request)
      message.contents[0] = 'mutated'
      expect(Object.isFrozen(prepared.request)).to.equal(true)
      expect(counted).to.include('original').and.include('Read fixture').and.include('path')
      await prepared.invoke()
      if (provider === 'ollama') expect(sent).not.to.equal(prepared.request)
      else expect(sent).to.equal(prepared.request)
      expect(JSON.stringify(sent)).to.equal(counted)
      if (provider === 'openai') expect(prepared.request.max_completion_tokens).to.equal(123)
      if (provider === 'anthropic') expect(prepared.request.max_tokens).to.equal(123)
      if (provider === 'ollama') expect(prepared.request.options).to.deep.equal({num_predict: 123})
      expect(() => model.prepare!([], {maxOutputTokens: 0})).to.throw('output cap')
    })

  it('uses the real Ollama SDK without mutating the counted request across invocations', async () => {
    const bodies: string[] = []
    const client = new Ollama({
      async fetch(_input, init) {
        bodies.push(String(init?.body))
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Fetch Response exists on supported Node 20.19.
        return new Response(JSON.stringify({
          done: true, eval_count: 1, message: {content: 'ok', role: 'assistant'},
          model: 'fixture', prompt_eval_count: 2,
        }), {headers: {'content-type': 'application/json'}})
      },
      host: 'http://ollama.invalid',
    })
    const model = new OllamaAgent('fixture', createProvider('ollama'), {client})
    const prepared = model.prepare([new Message(MessageType.User, {content: 'original'})], {maxOutputTokens: 12})
    const counted = JSON.stringify(prepared.request)
    expect((await prepared.invoke()).content).to.equal('ok')
    expect((await prepared.invoke()).content).to.equal('ok')
    expect(bodies).to.deep.equal([counted, counted])
    expect(JSON.stringify(prepared.request)).to.equal(counted)
    expect(Object.isFrozen(prepared.request)).to.equal(true)
    expect(Object.isFrozen(prepared.request.messages)).to.equal(true)
    expect(prepared.request.stream).to.equal(false)
  })

  it('isolates nested SDK mutations even when an Ollama invocation fails', async () => {
    const sent: string[] = []
    const client = {
      abort() {},
      async chat(request: {messages: {content: string}[]; options: {num_predict: number}}) {
        sent.push(JSON.stringify(request))
        request.messages[0].content = 'SDK mutation'
        request.options.num_predict = 1
        if (sent.length === 1) throw new Error('SDK failure')
        return {done: true, message: {content: 'ok', role: 'assistant'}, model: 'fixture'}
      },
    } as unknown as NonNullable<ConstructorParameters<typeof OllamaAgent>[2]>['client']
    const prepared = new OllamaAgent('fixture', createProvider('ollama'), {client}).prepare(
      [new Message(MessageType.User, {content: 'original'})], {maxOutputTokens: 12},
    )
    const counted = JSON.stringify(prepared.request)
    try {
      await prepared.invoke()
      expect.fail('Expected SDK failure')
    } catch (error) {expect((error as Error).message).to.equal('SDK failure')}

    expect((await prepared.invoke()).content).to.equal('ok')
    expect(sent).to.deep.equal([counted, counted])
    expect(JSON.stringify(prepared.request)).to.equal(counted)
  })

})
