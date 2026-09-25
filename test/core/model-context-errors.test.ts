// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- SDK error fixtures use wire field names. */
import {expect} from 'chai'

import type {Model} from '../../src/core/index.js'

import {ContextOverflowError, createProvider, IncompleteModelResponseError} from '../../src/core/index.js'
import {AnthropicAgent} from '../../src/core/models/adapters/anthropic.js'
import {OllamaAgent} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'

function model(provider: string, error: Error): Model {
  const fail = async () => {
    throw error
  }

  if (provider === 'openai')
    return new OpenAIAgent('fixture', createProvider(provider), {
      client: {chat: {completions: {create: fail}}} as never,
    })
  if (provider === 'anthropic')
    return new AnthropicAgent('fixture', createProvider(provider), {client: {messages: {create: fail}} as never})
  return new OllamaAgent('fixture', createProvider(provider), {client: {abort() {}, chat: fail} as never})
}

describe('provider context error classification', () => {
  const cases = [
    [
      'openai',
      Object.assign(new Error('Too long'), {code: 'context_length_exceeded', status: 400}),
      ContextOverflowError,
    ],
    [
      'anthropic',
      Object.assign(new Error('Too long'), {
        error: {error: {message: 'prompt is too long: 300 > 200', type: 'invalid_request_error'}},
        status: 400,
      }),
      ContextOverflowError,
    ],
    [
      'ollama',
      Object.assign(new Error('the input length exceeds the context length'), {status_code: 400}),
      ContextOverflowError,
    ],
    [
      'ollama',
      Object.assign(
        new Error('llama-server returned invalid tool call arguments for "write": unexpected end of JSON input'),
        {status_code: 500},
      ),
      IncompleteModelResponseError,
    ],
  ] as const
  for (const [provider, error, type] of cases) {
    it(`normalizes ${provider} ${error.message} and preserves the cause`, async () => {
      let received: unknown
      try {
        await model(provider, error).invoke([])
      } catch (error_) {
        received = error_
      }

      expect(received).to.be.instanceOf(type)
      expect((received as Error).cause).to.equal(error)
    })
  }

  for (const provider of ['openai', 'anthropic', 'ollama']) {
    it(`preserves ${provider} unrelated server errors`, async () => {
      const error = Object.assign(new Error('Server unavailable'), {status: 500, status_code: 500})
      let received: unknown
      try {
        await model(provider, error).invoke([])
      } catch (error_) {
        received = error_
      }

      expect(received).to.equal(error)
    })
  }
})
