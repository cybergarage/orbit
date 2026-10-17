// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import assert from 'node:assert/strict'

import {cloudModelConfig, localOllamaModel} from './models-config.mjs'

const refusedRequest = async () => {
  throw new TypeError('fetch failed', {cause: {code: 'ECONNREFUSED'}})
}

function installation(models, capabilities = {}, calls = []) {
  return async (url, options) => {
    calls.push({options, url})
    if (url.endsWith('/api/tags')) return {json: async () => ({models}), ok: true}
    const {model} = JSON.parse(options.body)
    return {json: async () => ({capabilities: capabilities[model] ?? []}), ok: true}
  }
}

const failedResponse = async () => ({ok: false, status: 500})
const timedOutRequest = async () => {
  throw new DOMException('Timed out', 'TimeoutError')
}

describe('Live model test conditions', () => {
  for (const provider of ['openai', 'anthropic']) {
    const prefix = `ORBIT_TEST_${provider.toUpperCase()}`
    it(`requires a dedicated ${provider} test key`, () => {
      expect(cloudModelConfig(provider, {})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${provider.toUpperCase()}_API_KEY`]: 'fake-key'})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${prefix}_API_KEY`]: '  '})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${prefix}_MODEL`]: 'test-model'})).to.equal(undefined)
    })

    it(`supports the default and explicit ${provider} models without copying keys`, () => {
      expect(cloudModelConfig(provider, {[`${prefix}_API_KEY`]: 'fake-key'}).model).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${prefix}_API_KEY`]: 'fake-key', [`${prefix}_MODEL`]: '  '}).model).to.equal(
        undefined,
      )
      expect(
        cloudModelConfig(provider, {[`${prefix}_API_KEY`]: 'fake-key', [`${prefix}_MODEL`]: ' test-model '}),
      ).to.deep.equal({
        model: 'test-model',
        settings: {providers: {[provider]: {apiKeyEnv: `${prefix}_API_KEY`}}},
      })
    })
  }

  it('skips a stopped local Ollama server unless a model was explicitly requested', async () => {
    expect(await localOllamaModel({}, refusedRequest)).to.equal(undefined)
    await assert.rejects(localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: 'explicit'}, refusedRequest), /fetch failed/)
  })

  it('skips an empty local installation without downloading a model', async () => {
    const calls = []
    expect(await localOllamaModel({}, installation([], {}, calls))).to.equal(undefined)
    expect(calls.map(({url}) => url)).to.deep.equal(['http://127.0.0.1:11434/api/tags'])
  })

  it('skips embedding and text-only models and selects the first tool-capable model', async () => {
    const calls = []
    const request = installation(
      [{name: 'embed'}, {name: 'text'}, {model: 'tools'}, {name: 'later'}],
      {embed: ['embedding'], later: ['tools'], text: ['completion'], tools: ['completion', 'tools']},
      calls,
    )
    expect(await localOllamaModel({}, request)).to.equal('tools')
    const metadata = calls.slice(1)
    expect(metadata.map(({options}) => JSON.parse(options.body).model)).to.deep.equal(['embed', 'text', 'tools'])
    for (const {options, url} of metadata) {
      expect(url).to.equal('http://127.0.0.1:11434/api/show')
      expect(options.method).to.equal('POST')
      expect(options.signal).to.be.instanceOf(AbortSignal)
    }
  })

  it('skips an installation without tool support', async () => {
    expect(await localOllamaModel({}, installation([{name: 'embed'}], {embed: ['embedding']}))).to.equal(undefined)
    expect(await localOllamaModel({}, installation([{name: 'unknown'}]))).to.equal(undefined)
  })

  it('selects an explicit model using its latest alias and checks its capabilities', async () => {
    const calls = []
    const request = installation([{name: 'first'}, {model: 'second:latest'}], {'second:latest': ['tools']}, calls)
    expect(await localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: ' second '}, request)).to.equal('second:latest')
    expect(calls.slice(1).map(({options}) => JSON.parse(options.body).model)).to.deep.equal(['second:latest'])
    await assert.rejects(localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: 'first'}, request), /does not report tool support/)
  })

  it('fails an explicitly requested missing model without selecting another one', async () => {
    await assert.rejects(
      localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: 'missing'}, installation([{name: 'other'}])),
      /not installed locally/,
    )
  })

  it('does not hide discovery HTTP, timeout, or protocol failures as skips', async () => {
    await assert.rejects(localOllamaModel({}, failedResponse), /HTTP 500/)
    await assert.rejects(localOllamaModel({}, timedOutRequest), /Timed out/)
    await assert.rejects(localOllamaModel({}, installation()), TypeError)
  })

  it('does not hide capability HTTP and timeout failures as skips', async () => {
    for (const failure of [failedResponse, timedOutRequest]) {
      const request = (url, options) =>
        url.endsWith('/api/tags') ? installation([{name: 'candidate'}])(url, options) : failure()
      await assert.rejects(localOllamaModel({}, request))
    }
  })
})
