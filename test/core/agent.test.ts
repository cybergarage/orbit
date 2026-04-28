// Copyright (c) 2026 The Orbit Authors
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
import type {MessageType as MessageTypeName} from '../../src/core/session/message.js'

import {Dialogue, PromptMemory} from '../../src/core/index.js'
import {
  Agent,
  DEFAULT_MODELS,
  getModel,
  getProvider,
  getRoles,
  Message,
  MessageType,
  PromptTemplate,
  Session,
  SessionHeader,
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
        compact() {},
        query() {
          return [...entries[0].getQuestions(), entries[0].getAnswer()]
        },
      }
      const options: SessionOptions = {memory}
      const agent = new Agent()

      const session = agent.newSession(options)

      expect(session).to.be.instanceOf(Session)
      expect(session.memory).to.equal(memory)
      expect(session.memory.query('anything')).to.deep.equal([
        {content: 'Hello', role: 'user'},
        {content: 'Hi', role: 'assistant'},
      ])
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

    it('starts with a session header message', () => {
      const session = new Session()
      const messages = session.getMessages()

      expect(messages).to.have.length(1)
      expect(messages[0]).to.be.instanceOf(SessionHeader)
      expect(messages[0].type).to.equal(MessageType.Session)
      expect(messages[0].parentid).to.equal(null)
      expect(messages[0].id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('appends a message and returns it', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const message = session.appendMessage(MessageType.User, {
        payload: {content: 'Hello'},
      })

      expect(message).to.deep.equal(session.getMessages()[1])
      expect(message.type).to.equal(MessageType.User)
      expect(message.parentid).to.equal(header.id)
      expect(message.payload).to.deep.equal({content: 'Hello'})
    })

    it('appends a prebuilt message instance', () => {
      const session = new Session()
      const message = new Message(MessageType.User, {
        parentid: 'custom-parent-id',
        payload: {content: 'Hello'},
      })

      expect(session.appendMessage(message)).to.equal(message)
      expect(session.getMessages()[1]).to.equal(message)
    })

    it('creates messages through the Message constructor', () => {
      const message = new Message(MessageType.Assistant, {
        parentid: 'parent-message-id',
        payload: {content: 'Hello'},
      })

      expect(message.type).to.equal(MessageType.Assistant)
      expect(message.parentid).to.equal('parent-message-id')
      expect(message.payload).to.deep.equal({content: 'Hello'})
      expect(message.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('creates session headers through the Message constructor', () => {
      const header = new SessionHeader({
        payload: {title: 'Session'},
      })

      expect(header).to.be.instanceOf(Message)
      expect(header.type).to.equal(MessageType.Session)
      expect(header.parentid).to.equal(null)
      expect(header.payload).to.deep.equal({title: 'Session'})
      expect(header.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('generates UUIDv7 message ids', () => {
      const session = new Session()

      const message = session.appendMessage(MessageType.Assistant)

      expect(message.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('serializes messages as JSON objects with the expected field names', () => {
      const session = new Session()

      const message = session.appendMessage(MessageType.Tool, {
        parentid: 'parent-message-id',
        payload: {name: 'lookup', result: 'ok'},
      })
      const serialized = JSON.stringify(message)

      expect(JSON.parse(serialized)).to.deep.equal({
        id: message.id,
        parentid: 'parent-message-id',
        payload: {name: 'lookup', result: 'ok'},
        timestamp: message.timestamp,
        type: MessageType.Tool,
      })
    })

    it('uses the previous message id as parentid when parentid is omitted', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const first = session.appendMessage(MessageType.User)
      const second = session.appendMessage(MessageType.Assistant)

      expect(first.parentid).to.equal(header.id)
      expect(second.parentid).to.equal(first.id)
    })

    it('uses an explicit parentid as-is', () => {
      const session = new Session()

      const message = session.appendMessage(MessageType.Tool, {
        parentid: 'custom-parent-id',
      })

      expect(message.parentid).to.equal('custom-parent-id')
    })

    it('returns a copy of the message list', () => {
      const session = new Session()
      const message = session.appendMessage(MessageType.User)
      const messages = session.getMessages()
      const header = messages[0]

      messages.push(new Message(MessageType.Tool))

      expect(session.getMessages()).to.deep.equal([header, message])
    })

    it('throws when appending an unsupported message type', () => {
      const session = new Session()

      expect(() => session.appendMessage('System' as MessageTypeName)).to.throw(
        'Unsupported message type: System',
      )
    })

    it('exports message types from the message module', () => {
      const type: MessageTypeName = MessageType.User
      const message = new Message(type, {
        parentid: null,
      })

      expect(message.type).to.equal(MessageType.User)
    })

    it('uses the provided memory instance as-is', () => {
      const entries: Dialogue[] = [
        new Dialogue([{content: 'Hello', role: 'user'}], {content: 'Hi', role: 'assistant'}),
      ]
      const memory: Memory = {
        add(entry: Dialogue) {
          entries.push(entry)
        },
        compact() {},
        query() {
          return [...entries[0].getQuestions(), entries[0].getAnswer()]
        },
      }

      const session = new Session({memory})

      expect(session.memory).to.equal(memory)
      expect(session.memory.query('anything')).to.deep.equal([
        {content: 'Hello', role: 'user'},
        {content: 'Hi', role: 'assistant'},
      ])
    })

    it('flattens all dialogue prompts in PromptMemory query order', () => {
      const session = new Session({
        memory: new PromptMemory([
          new Dialogue(
            [
              {content: 'Hello', role: 'user'},
              {content: 'Can you help?', role: 'user'},
            ],
            {content: 'Sure', role: 'assistant'},
          ),
          new Dialogue([{content: 'Thanks', role: 'user'}], {content: 'You are welcome', role: 'assistant'}),
        ]),
      })

      expect(session.memory.query('anything')).to.deep.equal([
        {content: 'Hello', role: 'user'},
        {content: 'Can you help?', role: 'user'},
        {content: 'Sure', role: 'assistant'},
        {content: 'Thanks', role: 'user'},
        {content: 'You are welcome', role: 'assistant'},
      ])
    })
  })

  describe('PromptTemplate', () => {
    it('creates an instance from a template string', () => {
      expect(PromptTemplate.from('Hello {name}')).to.be.instanceOf(PromptTemplate)
    })

    it('replaces a single placeholder', () => {
      const template = PromptTemplate.from('Hello {name}')

      expect(template.invoke({name: 'Orbit'})).to.equal('Hello Orbit')
    })

    it('replaces multiple placeholders and repeated keys', () => {
      const template = PromptTemplate.from('{greeting}, {name}! {greeting} again!')

      expect(template.invoke({greeting: 'Hello', name: 'Orbit'})).to.equal(
        'Hello, Orbit! Hello again!',
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
