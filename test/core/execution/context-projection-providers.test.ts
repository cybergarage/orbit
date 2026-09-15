// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Provider fixtures use exact SDK wire fields. */
import {expect} from 'chai'

import type {Model} from '../../../src/core/models/model.js'

import {createProvider, Message, MessageType} from '../../../src/core/index.js'
import {AnthropicAgent} from '../../../src/core/models/adapters/anthropic.js'
import {OllamaAgent} from '../../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../../src/core/models/adapters/openai.js'
import {persistedContextMessage} from '../../../src/core/session/compaction.js'
import {
  INTERRUPTED_TOOL_NOTICE,
  interruptedCalls,
  projectInterruptedMessages,
} from '../../../src/core/session/interrupted-context.js'

describe('interrupted context provider request captures', () => {
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

      const message = new Message(MessageType.Assistant, {
        content: 'original',
        payload: {
          response: {providerMetadata: {fixture: 'retained'}},
          toolCalls: [
            {id: 'first', input: {}, name: 'read'},
            {id: 'second', input: {}, name: 'read'},
          ],
        },
      })
      const entries = [
        {
          message: persistedContextMessage(message),
          timestamp: message.timestamp,
          turnId: 'cancelled',
          type: 'message' as const,
        },
      ]
      const raw = JSON.stringify(entries)
      const view = projectInterruptedMessages(entries, interruptedCalls(entries))
      const prepared = model.prepare!(view, {
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
      expect(counted).contains(INTERRUPTED_TOOL_NOTICE)
      expect(JSON.stringify(entries)).equal(raw)
      expect(view[0].payload).deep.equal(message.payload)
      const serialized = JSON.stringify(sent)
      if (provider !== 'ollama') expect(serialized).contains('first').and.contains('second')
      if (provider === 'anthropic') expect(serialized).contains('"is_error":true')
      if (provider === 'ollama') expect(serialized).contains('"tool_name":"read"')
      if (provider === 'openai') expect(prepared.request.max_completion_tokens).to.equal(123)
      if (provider === 'anthropic') expect(prepared.request.max_tokens).to.equal(123)
      if (provider === 'ollama') expect(prepared.request.options).to.deep.equal({num_predict: 123})
      expect(() => model.prepare!([], {maxOutputTokens: 0})).to.throw('output cap')
    })
})
