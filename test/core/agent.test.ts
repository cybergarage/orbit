// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {getProvider, getRoles, splitSystemPrompt} from '../../src/core/models/index.js'

describe('model helpers', () => {
  describe('getProvider', () => {
    it('returns all defined providers in a stable order', () => {
      expect(getProvider()).to.deep.equal(['anthropic', 'ollama', 'openai'])
    })
  })

  describe('getRoles', () => {
    it('returns all defined roles in a stable order', () => {
      expect(getRoles()).to.deep.equal(['assistant', 'system', 'user'])
    })
  })

  describe('splitSystemPrompt', () => {
    it('collects system messages and leaves visible history intact', () => {
      const result = splitSystemPrompt([
        {content: 'Japanese only', role: 'system'},
        {content: 'Workspace context', role: 'system'},
        {content: 'Hello', role: 'user'},
        {content: 'Hi there', role: 'assistant'},
      ])

      expect(result.systemPrompt).to.equal('Japanese only\n\nWorkspace context')
      expect(result.messages).to.deep.equal([
        {content: 'Hello', role: 'user'},
        {content: 'Hi there', role: 'assistant'},
      ])
    })
  })
})
