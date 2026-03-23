// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Memory} from '../../src/core/index.js'
import type {
  AgentOptions,
  Model,
  Prompt,
  PromptTemplateInput,
  SessionOptions,
} from '../../src/core/models/index.js'

import {Dialogue, PromptMemory} from '../../src/core/index.js'
import {
  Agent,
  DEFAULT_MODELS,
  getModel,
  getProvider,
  getRoles,
  PromptTemplate,
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
              return {content: 'ok', role: 'assistant'}
            },
          }),
        },
      })

      expect(agent).to.be.instanceOf(Agent)
      expect(await agent.prompt([{content: 'hello', role: 'user'}])).to.deep.equal({
        content: 'ok',
        role: 'assistant',
      })
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
              return {content: 'ok', role: 'assistant'}
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

    it('accepts SessionOptions in newSession and passes through the provided memory', () => {
      const entries: Dialogue[] = [
        new Dialogue([{content: 'Hello', role: 'user'}], {content: 'Hi', role: 'assistant'}),
      ]
      const memory: Memory = {
        add(entry: Dialogue) {
          entries.push(entry)
        },
        query() {
          return [...entries]
        },
      }
      const options: SessionOptions = {memory}
      const agent = new Agent()

      const session = agent.newSession(options)

      expect(session).to.be.instanceOf(Session)
      expect(session.memory).to.equal(memory)
      expect(session.memory.query('anything')).to.deep.equal(entries)
    })

    it('uses PromptMemory by default when newSession is called without options', () => {
      const agent = new Agent()

      const session = agent.newSession()

      expect(session.memory).to.be.instanceOf(PromptMemory)
    })
  })

  describe('Session', () => {
    it('accepts SessionOptions as the constructor type', () => {
      const options: SessionOptions = {
        memory: new PromptMemory(),
      }

      expect(new Session(options)).to.be.instanceOf(Session)
    })

    it('uses PromptMemory by default when options are omitted', () => {
      const session = new Session()

      expect(session.memory).to.be.instanceOf(PromptMemory)
    })

    it('uses PromptMemory by default when memory is not provided', () => {
      const session = new Session({})

      expect(session.memory).to.be.instanceOf(PromptMemory)
    })

    it('uses the provided memory instance as-is', () => {
      const entries: Dialogue[] = [
        new Dialogue([{content: 'Hello', role: 'user'}], {content: 'Hi', role: 'assistant'}),
      ]
      const memory: Memory = {
        add(entry: Dialogue) {
          entries.push(entry)
        },
        query() {
          return [...entries]
        },
      }

      const session = new Session({memory})

      expect(session.memory).to.equal(memory)
      expect(session.memory.query('anything')).to.deep.equal(entries)
    })
  })

  describe('PromptTemplate', () => {
    it('creates an instance from a template string', () => {
      expect(PromptTemplate.from('Hello {name}')).to.be.instanceOf(PromptTemplate)
    })

    it('replaces a single placeholder', () => {
      const template = PromptTemplate.from('Hello {name}')

      expect(template.invoke({name: 'Scribemuse'})).to.equal('Hello Scribemuse')
    })

    it('replaces multiple placeholders and repeated keys', () => {
      const template = PromptTemplate.from('{greeting}, {name}! {greeting} again!')

      expect(template.invoke({greeting: 'Hello', name: 'Scribemuse'})).to.equal(
        'Hello, Scribemuse! Hello again!',
      )
    })

    it('stringifies non-string values', () => {
      const template = PromptTemplate.from('count={count}, ok={ok}, empty={empty}, missing={missing}')
      const params: PromptTemplateInput = {
        count: 3,
        empty: null,
        missing: undefined,
        ok: true,
      }

      expect(template.invoke(params)).to.equal('count=3, ok=true, empty=null, missing=undefined')
    })

    it('returns the original string when there are no placeholders', () => {
      const template = PromptTemplate.from('No placeholders here.')

      expect(template.invoke({})).to.equal('No placeholders here.')
    })

    it('throws when a required parameter is missing', () => {
      const template = PromptTemplate.from('Hello {name}')

      expect(() => template.invoke({})).to.throw('Missing prompt template parameter: name')
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
      expect(getRoles()).to.deep.equal(['assistant', 'system', 'user', 'developer'])
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
