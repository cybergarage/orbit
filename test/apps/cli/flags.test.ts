// Copyright (c) 2026 The Scribemuse Authors
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

    it('ignores an invalid provider', () => {
      expect(toAgentOptions({provider: 'local'})).to.deep.equal({})
    })
  })
})
