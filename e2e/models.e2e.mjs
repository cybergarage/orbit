// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {getModel, Message, MessageType} from '../dist/core/index.js'
import {cloudModelConfig, localOllamaModel} from './models-config.mjs'

async function checkResponse(model) {
  const result = await model.invoke([new Message(MessageType.User, {content: 'Say hello in one short sentence.'})], {
    maxOutputTokens: 512,
    signal: AbortSignal.timeout(120_000),
  })
  expect(result.type).to.equal(MessageType.Assistant)
  expect(result.content.trim()).not.to.equal('')
  expect(result.payload.response.provider).to.equal(model.getProvider())
}

describe('Live model smoke tests', function () {
  this.timeout(130_000)

  for (const provider of ['openai', 'anthropic']) {
    it(`${provider}: returns a real assistant response when a test API key is configured`, async function () {
      const config = cloudModelConfig(provider)
      if (!config) this.skip()
      await checkResponse(getModel(provider, config.model, config.settings))
    })
  }

  it('ollama: returns a real assistant response when a local model is installed', async function () {
    const model = await localOllamaModel()
    if (!model) this.skip()
    await checkResponse(getModel('ollama', model, {providers: {ollama: {host: 'http://127.0.0.1:11434'}}}))
  })
})
