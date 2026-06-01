// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {agentFlags, toAgentOptions} from '../../../src/apps/cli/flags.js'

describe('CLI agent flags', () => {
  describe('agentFlags', () => {
    it('uses all defined providers as CLI options', () => {
      expect(agentFlags.provider.options).to.deep.equal(['anthropic', 'ollama', 'openai'])
    })
  })

  describe('toAgentOptions', () => {
    it('includes a valid provider', () => {
      expect(toAgentOptions({provider: 'openai'})).to.deep.equal({provider: 'openai'})
    })

    it('includes debug when enabled', () => {
      expect(toAgentOptions({debug: true})).to.deep.equal({debug: true})
    })

    it('omits debug when disabled', () => {
      expect(toAgentOptions({debug: false})).to.deep.equal({})
    })

    it('ignores an invalid provider', () => {
      expect(toAgentOptions({provider: 'local'})).to.deep.equal({})
    })

    it('includes provider settings flags', () => {
      expect(
        toAgentOptions({
          anthropicApiKeyEnv: 'ANTHROPIC_KEY',
          ollamaHost: 'http://localhost:11434',
          openaiApiKeyEnv: 'OPENAI_KEY',
        }),
      ).to.deep.equal({
        settings: {
          providers: {
            anthropic: {apiKeyEnv: 'ANTHROPIC_KEY'},
            ollama: {host: 'http://localhost:11434'},
            openai: {apiKeyEnv: 'OPENAI_KEY'},
          },
        },
      })
    })
  })
})
