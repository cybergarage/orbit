// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {cloudModelConfig, localOllamaModel} from './models-config.mjs'

const refusedRequest = async () => {
  throw new TypeError('fetch failed', {cause: {code: 'ECONNREFUSED'}})
}

const tags = (models) => async () => ({json: async () => ({models}), ok: true})

describe('Live model test conditions', () => {
  for (const provider of ['openai', 'anthropic']) {
    const prefix = `ORBIT_TEST_${provider.toUpperCase()}`
    it(`requires a dedicated ${provider} test key`, () => {
      expect(cloudModelConfig(provider, {})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${provider.toUpperCase()}_API_KEY`]: 'fake-key'})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${prefix}_API_KEY`]: '  '})).to.equal(undefined)
      expect(cloudModelConfig(provider, {[`${prefix}_API_KEY`]: 'fake-key'}).model).to.equal(undefined)
      expect(
        cloudModelConfig(provider, {[`${prefix}_API_KEY`]: 'fake-key', [`${prefix}_MODEL`]: 'test-model'}),
      ).to.deep.equal({
        model: 'test-model',
        settings: {providers: {[provider]: {apiKeyEnv: `${prefix}_API_KEY`}}},
      })
    })
  }

  it('skips a stopped local Ollama server', async () => {
    expect(await localOllamaModel({}, refusedRequest)).to.equal(undefined)
  })

  it('skips an empty local installation and discovers installed models without downloading', async () => {
    expect(await localOllamaModel({}, tags([]))).to.equal(undefined)
    expect(await localOllamaModel({}, tags([{name: 'local:latest'}]))).to.equal('local:latest')
    expect(
      await localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: 'second'}, tags([{name: 'first'}, {model: 'second:latest'}])),
    ).to.equal('second:latest')
  })

  it('fails an explicitly requested missing model', async () => {
    try {
      await localOllamaModel({ORBIT_TEST_OLLAMA_MODEL: 'missing'}, tags([]))
      expect.fail('Expected discovery to fail')
    } catch (error) {
      expect(error.message).to.include('not installed locally')
    }
  })

  it('does not hide discovery HTTP, timeout, or protocol failures as skips', async () => {
    for (const request of [
      async () => ({ok: false, status: 500}),
      async () => {
        throw new DOMException('Timed out', 'TimeoutError')
      },
      tags(),
    ]) {
      let failed = false
      try {
        await localOllamaModel({}, request)
      } catch {
        failed = true
      }

      expect(failed).to.equal(true)
    }
  })
})
