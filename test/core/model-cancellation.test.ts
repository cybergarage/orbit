// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import assert from 'node:assert/strict'

import {createProvider, Message, MessageType} from '../../src/core/index.js'
import {AnthropicAgent} from '../../src/core/models/adapters/anthropic.js'
import {OllamaAgent} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'

const messages = () => [new Message(MessageType.User, {content: 'Synthetic cancellation test'})]
const ollamaResponse = () => ({
  message: {content: 'Complete', role: 'assistant'},
  model: 'fixture',
})

describe('model adapter cancellation', () => {
  for (const provider of ['openai', 'anthropic'] as const) {
    it(`forwards the abort signal to the ${provider} SDK and preserves its rejection`, async () => {
      const controller = new AbortController()
      const reason = new Error('Synthetic request cancellation')
      let observedSignal: AbortSignal | undefined
      const create = (_request: unknown, options: {signal: AbortSignal}) => {
        observedSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true})
        })
      }

      const model =
        provider === 'openai'
          ? new OpenAIAgent('fixture', createProvider(provider), {client: {chat: {completions: {create}}} as never})
          : new AnthropicAgent('fixture', createProvider(provider), {client: {messages: {create}} as never})
      const pending = model.invoke(messages(), {signal: controller.signal})
      const rejected = assert.rejects(pending, (error) => error === reason)
      expect(observedSignal).to.equal(controller.signal)
      controller.abort(reason)
      await rejected
    })
  }

  it('aborts an in-flight Ollama SDK request and preserves its rejection', async () => {
    const controller = new AbortController()
    const reason = new Error('Synthetic Ollama cancellation')
    let aborts = 0
    let rejectRequest: (reason: Error) => void = () => {
      throw new Error('Request has not started')
    }

    const client = {
      abort() {
        aborts++
        rejectRequest(reason)
      },
      chat() {
        return new Promise((_resolve, reject) => {
          rejectRequest = reject
        })
      },
    }
    const model = new OllamaAgent('fixture', createProvider('ollama'), {client: client as never})
    const pending = model.invoke(messages(), {signal: controller.signal})
    const rejected = assert.rejects(pending, (error) => error === reason)
    controller.abort(reason)
    await rejected
    expect(aborts).to.equal(1)
  })

  for (const failed of [false, true]) {
    it(`removes the Ollama abort listener after ${failed ? 'failure' : 'success'}`, async () => {
      const controller = new AbortController()
      const reason = new Error('Synthetic SDK failure')
      let aborts = 0
      const client = {
        abort() {
          aborts++
        },
        async chat() {
          if (failed) throw reason
          return ollamaResponse()
        },
      }
      const model = new OllamaAgent('fixture', createProvider('ollama'), {client: client as never})
      const pending = model.invoke(messages(), {signal: controller.signal})
      if (failed) await assert.rejects(pending, (error) => error === reason)
      else expect((await pending).content).to.equal('Complete')
      controller.abort()
      expect(aborts).to.equal(0)
    })
  }
})
