// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Parser} from '@oclif/core'
import {expect} from 'chai'

import {agentFlags, toAgentOptions} from '../../../src/apps/cli-flags.js'

describe('CLI agent flags', () => {
  describe('agentFlags', () => {
    it('uses all defined providers as CLI options', () => {
      expect(agentFlags.provider.options).to.deep.equal(['anthropic', 'ollama', 'openai'])
    })
  })

  describe('toAgentOptions', () => {
    it('passes parsed connection flags to provider settings', async () => {
      const parsed = await Parser.parse(
        [
          '--ollama-host',
          'http://127.0.0.1:11435',
          '--openai-api-key-env',
          'BOOK_FAKE_OPENAI_KEY',
          '--anthropic-api-key-env',
          'BOOK_FAKE_ANTHROPIC_KEY',
        ],
        {flags: agentFlags},
      )
      expect(toAgentOptions(parsed.flags)).to.deep.equal({
        settings: {
          providers: {
            anthropic: {apiKeyEnv: 'BOOK_FAKE_ANTHROPIC_KEY'},
            ollama: {host: 'http://127.0.0.1:11435'},
            openai: {apiKeyEnv: 'BOOK_FAKE_OPENAI_KEY'},
          },
        },
      })
    })

    it('prefers parser keys while preserving direct camelCase callers', () => {
      expect(
        toAgentOptions({
          'anthropic-api-key-env': 'CLI_ANTHROPIC_KEY',
          anthropicApiKeyEnv: 'OLD_ANTHROPIC_KEY',
          'ollama-host': 'http://127.0.0.1:11435',
          ollamaHost: 'http://127.0.0.1:11436',
          'openai-api-key-env': 'CLI_OPENAI_KEY',
          openaiApiKeyEnv: 'OLD_OPENAI_KEY',
        }),
      ).to.deep.equal({
        settings: {
          providers: {
            anthropic: {apiKeyEnv: 'CLI_ANTHROPIC_KEY'},
            ollama: {host: 'http://127.0.0.1:11435'},
            openai: {apiKeyEnv: 'CLI_OPENAI_KEY'},
          },
        },
      })
    })

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
