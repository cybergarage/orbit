// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'

import {getModel, Message, MessageType} from '../dist/core/index.js'
import {cloudModelConfig, localOllamaModel} from './models-config.mjs'

const user = (content) => new Message(MessageType.User, {content})
const options = (extra = {}) => ({maxOutputTokens: 2048, signal: AbortSignal.timeout(120_000), ...extra})
const lookupTool = {
  description: 'Look up the verification code for a record. The code is available only through this tool.',
  inputSchema: {
    additionalProperties: false,
    properties: {recordId: {type: 'string'}},
    required: ['recordId'],
    type: 'object',
  },
  name: 'lookup_verification_code',
}

function checkAssistant(result, model, {text = true} = {}) {
  expect(result.type).to.equal(MessageType.Assistant)
  if (text) expect(result.content.trim()).not.to.equal('')
  expect(result.payload.response.provider).to.equal(model.getProvider())
  expect(result.payload.response.model).to.be.a('string').and.not.to.equal('')
  if (result.payload.parts !== undefined) {
    expect(result.payload.parts).to.be.an('array').and.not.to.have.length(0)
  }
}

for (const provider of ['openai', 'anthropic', 'ollama']) {
  describe(`Live model integration: ${provider}`, function () {
    // Each two-request scenario owns a deadline per request.
    this.timeout(250_000)
    let model

    before(async function () {
      if (provider === 'ollama') {
        const selected = await localOllamaModel()
        if (!selected) this.skip()
        model = getModel(provider, selected, {providers: {ollama: {host: 'http://127.0.0.1:11434'}}})
      } else {
        const config = cloudModelConfig(provider)
        if (!config) this.skip()
        model = getModel(provider, config.model, config.settings)
      }

      console.log(`    Selected model: ${provider}/${model.getModel()}`)
    })

    it('returns a real assistant response with normalized metadata', async () => {
      const result = await model.invoke([user('Say hello in one short sentence.')], options())
      checkAssistant(result, model)
      expect(result.payload.toolCalls ?? []).to.have.length(0)
    })

    it('preserves a unique identifier across a multi-turn conversation', async () => {
      const identifier = `orbit-${randomUUID()}`
      const messages = [user(`The reference identifier for this conversation is ${identifier}. Acknowledge with OK.`)]
      const first = await model.invoke(messages, options())
      checkAssistant(first, model)
      messages.push(
        first,
        user('Copy the reference identifier from the first user message above. Output that identifier only.'),
      )
      const second = await model.invoke(messages, options())
      checkAssistant(second, model)
      expect(second.content).to.include(identifier)
      expect(second.payload.toolCalls ?? []).to.have.length(0)
    })

    it('round-trips a tool call and uses the returned verification code', async () => {
      const messages = [
        user(
          'Use lookup_verification_code exactly once with recordId "orbit-check". ' +
            'After receiving the result, reply with its code exactly. Do not guess the code or call the tool again.',
        ),
      ]
      const requested = await model.invoke(messages, options({tools: [lookupTool]}))
      checkAssistant(requested, model, {text: false})
      const calls = requested.payload.toolCalls ?? []
      expect(calls).to.have.length(1)
      const [call] = calls
      expect(call.id).to.be.a('string').and.not.to.equal('')
      expect(call.name).to.equal(lookupTool.name)
      expect(call.input).to.deep.equal({recordId: 'orbit-check'})
      if (requested.payload.parts !== undefined) {
        expect(requested.payload.parts.filter((part) => part.type === 'tool-call')).to.deep.equal([
          {toolCall: call, type: 'tool-call'},
        ])
      }

      // Generate the answer after the request so it cannot be inferred from the prompt.
      const code = `verified-${randomUUID()}`
      messages.push(
        requested,
        new Message(MessageType.Tool, {
          payload: {
            input: call.input,
            name: call.name,
            output: {content: [{text: JSON.stringify({code}), type: 'text'}]},
            toolCallId: call.id,
          },
        }),
      )
      const result = await model.invoke(messages, options({tools: [lookupTool]}))
      checkAssistant(result, model)
      expect(result.content).to.include(code)
      expect(result.payload.toolCalls ?? []).to.have.length(0)
    })
  })
}
