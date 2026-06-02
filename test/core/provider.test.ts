// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {createProvider, getProvider, getProviderNames, isProvider, isProviderName} from '../../src/core/index.js'

describe('Provider', () => {
  afterEach(() => {
    delete process.env.ORBIT_TEST_ANTHROPIC_KEY
    delete process.env.ORBIT_TEST_OPENAI_KEY
  })

  it('returns all defined provider names in a stable order', () => {
    expect(getProviderNames()).to.deep.equal(['anthropic', 'ollama', 'openai'])
    expect(getProvider()).to.deep.equal(['anthropic', 'ollama', 'openai'])
  })

  it('validates provider names', () => {
    expect(isProviderName('openai')).to.equal(true)
    expect(isProvider('anthropic')).to.equal(true)
    expect(isProviderName('local')).to.equal(false)
    expect(isProvider(null)).to.equal(false)
  })

  it('returns provider names from provider objects', () => {
    expect(createProvider('openai').getName()).to.equal('openai')
    expect(createProvider('anthropic').getName()).to.equal('anthropic')
    expect(createProvider('ollama').getName()).to.equal('ollama')
  })

  it('resolves OpenAI and Anthropic API keys from configured environment variables', () => {
    process.env.ORBIT_TEST_OPENAI_KEY = 'openai-secret'
    process.env.ORBIT_TEST_ANTHROPIC_KEY = 'anthropic-secret'

    expect(createProvider('openai', {providers: {openai: {apiKeyEnv: 'ORBIT_TEST_OPENAI_KEY'}}}).getAPIKey()).to.equal(
      'openai-secret',
    )
    expect(
      createProvider('anthropic', {providers: {anthropic: {apiKeyEnv: 'ORBIT_TEST_ANTHROPIC_KEY'}}}).getAPIKey(),
    ).to.equal('anthropic-secret')
  })

  it('returns direct API keys when API key environment variables are not configured', () => {
    expect(createProvider('openai', {providers: {openai: {apiKey: 'openai-direct'}}}).getAPIKey()).to.equal(
      'openai-direct',
    )
    expect(createProvider('anthropic', {providers: {anthropic: {apiKey: 'anthropic-direct'}}}).getAPIKey()).to.equal(
      'anthropic-direct',
    )
  })

  it('prefers API key environment variables over direct API keys', () => {
    process.env.ORBIT_TEST_OPENAI_KEY = 'openai-env'

    expect(
      createProvider('openai', {
        providers: {
          openai: {
            apiKey: 'openai-direct',
            apiKeyEnv: 'ORBIT_TEST_OPENAI_KEY',
          },
        },
      }).getAPIKey(),
    ).to.equal('openai-env')
  })

  it('throws when a configured API key environment variable is missing', () => {
    expect(() => createProvider('openai', {providers: {openai: {apiKeyEnv: 'ORBIT_TEST_OPENAI_KEY'}}}).getAPIKey()).to.throw(
      'openai API key environment variable is not set: ORBIT_TEST_OPENAI_KEY',
    )
  })

  it('returns configured Ollama host', () => {
    expect(createProvider('ollama', {providers: {ollama: {host: 'http://localhost:11434'}}}).getHost()).to.equal(
      'http://localhost:11434',
    )
  })

  it('returns undefined for unsupported API key and host values', () => {
    expect(createProvider('ollama').getAPIKey()).to.equal(undefined)
    expect(createProvider('openai').getAPIKey()).to.equal(undefined)
    expect(createProvider('openai').getHost()).to.equal(undefined)
    expect(createProvider('anthropic').getHost()).to.equal(undefined)
  })
})
