// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model, Prompt, SessionOptions} from '../../src/core/models/index.js'

import {
  Agent,
  DEFAULT_MODELS,
  getModel,
  getProvider,
  getRoles,
  Session,
  splitSystemPrompt,
} from '../../src/core/models/index.js'

describe('model helpers', () => {
  describe('Agent', () => {
    it('resolves the default provider and model when options are omitted', async () => {
      const calls: {messages: Prompt[]; model: string; provider: string}[] = []
      const agent = new Agent({
        deps: {
          createModel: (provider, model): Model => ({
            getModel() {
              return model ?? DEFAULT_MODELS[provider ?? 'ollama']
            },
            getProvider() {
              return provider ?? 'ollama'
            },
            async prompt(messages) {
              calls.push({
                messages,
                model: model ?? DEFAULT_MODELS[provider ?? 'ollama'],
                provider: provider ?? 'ollama',
              })
              return 'ok'
            },
          }),
        },
      })

      expect(agent).to.be.instanceOf(Agent)
      expect(await agent.prompt([{content: 'hello', role: 'user'}])).to.equal('ok')
      expect(calls).to.deep.equal([
        {
          messages: [{content: 'hello', role: 'user'}],
          model: DEFAULT_MODELS.ollama,
          provider: 'ollama',
        },
      ])
    })

    it('uses the explicitly requested provider and model', async () => {
      const calls: {model: string; provider: string}[] = []
      const agent = new Agent({
        deps: {
          createModel: (provider, model): Model => ({
            getModel() {
              return model ?? ''
            },
            getProvider() {
              return provider ?? 'ollama'
            },
            async prompt() {
              calls.push({model: model ?? '', provider: provider ?? 'ollama'})
              return 'ok'
            },
          }),
        },
        model: {
          name: 'claude-custom',
          provider: 'anthropic',
        },
      })

      await agent.prompt([{content: 'hello', role: 'user'}])
      expect(calls).to.deep.equal([{model: 'claude-custom', provider: 'anthropic'}])
    })

    it('accepts AgentOptions as the constructor type', () => {
      const options: AgentOptions = {
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
      }

      expect(options).to.deep.equal({
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
      })
    })

    it('creates a new Session instance for each call to newSession', () => {
      const agent = new Agent()
      const firstSession = agent.newSession()
      const secondSession = agent.newSession()

      expect(firstSession).to.be.instanceOf(Session)
      expect(secondSession).to.be.instanceOf(Session)
      expect(firstSession).to.not.equal(secondSession)
    })
  })

  describe('Session', () => {
    it('accepts SessionOptions as the constructor type', () => {
      const options: SessionOptions = {}

      expect(new Session(options)).to.be.instanceOf(Session)
    })
  })

  describe('model metadata', () => {
    it('returns the provider default model when no model is specified', () => {
      const model = getModel('ollama')

      expect(model.getProvider()).to.equal('ollama')
      expect(model.getModel()).to.equal(DEFAULT_MODELS.ollama)
    })

    it('returns the explicitly requested provider and model', () => {
      const model = getModel('anthropic', 'claude-custom')

      expect(model.getProvider()).to.equal('anthropic')
      expect(model.getModel()).to.equal('claude-custom')
    })
  })

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
