// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {
  AgentOptions,
  Model,
  Operator,
  OperatorOptions,
  PromptTemplateInput,
} from '../../src/core/models/index.js'
import type {MessageType as MessageTypeName} from '../../src/core/session/message.js'

import {Role} from '../../src/core/index.js'
import {Message as CoreMessage, MessageType as CoreMessageType, UserMessage} from '../../src/core/message/index.js'
import {
  Agent,
  DEFAULT_MODELS,
  getModel,
  getProvider,
  getRoles,
  Message,
  MessageType,
  OperatorType,
  PromptTemplate,
  Session,
  SessionHeader,
  splitSystemPrompt,
  State,
} from '../../src/core/models/index.js'

describe('model helpers', () => {
  describe('Agent', () => {
    it('resolves the default provider and model when options are omitted', async () => {
      const calls: {messages: Message[]; model: string; provider: string}[] = []
      const agent = new Agent({
        deps: {
          createModel: (provider, model): Model => ({
            getModel() {
              return model ?? DEFAULT_MODELS[provider ?? 'ollama']
            },
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return provider ?? 'ollama'
            },
            async invoke(messages) {
              calls.push({
                messages,
                model: model ?? DEFAULT_MODELS[provider ?? 'ollama'],
                provider: provider ?? 'ollama',
              })
              return new Message(MessageType.Assistant, {content: 'ok'})
            },
          }),
        },
      })

      expect(agent).to.be.instanceOf(Agent)
      const prompt = new Message(MessageType.User, {content: 'hello'})
      const response = await agent.invoke([prompt])

      expect(response).to.be.instanceOf(Message)
      expect(response.content).to.equal('ok')
      expect(response.role).to.equal(Role.Assistant)
      expect(calls).to.deep.equal([
        {
          messages: [prompt],
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
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return provider ?? 'ollama'
            },
            async invoke() {
              calls.push({model: model ?? '', provider: provider ?? 'ollama'})
              return new Message(MessageType.Assistant, {content: 'ok'})
            },
          }),
        },
        model: {
          name: 'claude-custom',
          provider: 'anthropic',
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])
      expect(calls).to.deep.equal([{model: 'claude-custom', provider: 'anthropic'}])
    })

    it('passes operator options through to the model invoke call', async () => {
      const calls: {messages: Message[]; options?: Partial<OperatorOptions>}[] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return DEFAULT_MODELS.ollama
            },
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return 'ollama'
            },
            async invoke(messages, options) {
              calls.push({messages, options})
              return new Message(MessageType.Assistant, {content: 'ok'})
            },
          }),
        },
      })
      const prompt = new Message(MessageType.User, {content: 'hello'})
      const options = {traceId: 'trace-1'}

      await agent.invoke([prompt], options)

      expect(calls).to.deep.equal([{messages: [prompt], options}])
    })

    it('prepends Agent messages when invoking the model', async () => {
      const calls: Message[][] = []
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return DEFAULT_MODELS.ollama
            },
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return 'ollama'
            },
            async invoke(messages) {
              calls.push(messages)
              return new Message(MessageType.Assistant, {content: 'ok'})
            },
          }),
        },
        messages: [systemMessage],
      })
      const prompt = new Message(MessageType.User, {content: 'hello'})

      await agent.invoke([prompt])

      expect(calls).to.deep.equal([[systemMessage, prompt]])
    })

    it('returns the model response from run', async () => {
      const response = new Message(MessageType.Assistant, {content: 'ok'})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return DEFAULT_MODELS.ollama
            },
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return 'ollama'
            },
            async invoke() {
              return response
            },
          }),
        },
      })

      expect(await agent.run(new Session(), [new Message(MessageType.User)])).to.equal(response)
    })

    it('prepends Agent messages when running the model', async () => {
      const calls: Message[][] = []
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return DEFAULT_MODELS.ollama
            },
            getName() {
              return OperatorType.Model
            },
            getProvider() {
              return 'ollama'
            },
            async invoke(messages) {
              calls.push(messages)
              return new Message(MessageType.Assistant, {content: 'ok'})
            },
          }),
        },
        messages: [systemMessage],
      })
      const prompt = new Message(MessageType.User, {content: 'hello'})

      await agent.run(new Session(), [prompt])

      expect(calls).to.deep.equal([[systemMessage, prompt]])
    })

    it('copies AgentOptions messages when constructed', () => {
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const appendedMessage = new Message(MessageType.Session, {content: 'Appended context', role: Role.System})
      const messages = [systemMessage]
      const agent = new Agent({messages})

      messages.push(appendedMessage)

      expect(agent.messages).to.deep.equal([systemMessage])
    })

    it('treats models as operators and returns the model name', () => {
      const model = getModel('ollama')
      const operator: Operator<Message[], Message, OperatorOptions> = model

      expect(operator.getName()).to.equal(OperatorType.Model)
      expect(operator.getName('Suffix')).to.equal(`${OperatorType.Model}:Suffix`)
    })

    it('returns the agent operator name with optional suffixes', () => {
      const agent = new Agent()

      expect(agent.getName()).to.equal(OperatorType.Agent)
      expect(agent.getName('Suffix')).to.equal(`${OperatorType.Agent}:Suffix`)
      expect(agent.getName('')).to.equal(OperatorType.Agent)
    })

    it('accepts AgentOptions as the constructor type', () => {
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const options: AgentOptions = {
        messages: [systemMessage],
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
      }

      expect(options).to.deep.equal({
        messages: [systemMessage],
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
      })
    })

    it('returns the State Session from getSession', () => {
      const agent = new Agent()
      const firstSession = agent.getSession()
      const secondSession = agent.getSession()

      expect(firstSession).to.be.instanceOf(Session)
      expect(secondSession).to.be.instanceOf(Session)
      expect(firstSession).to.equal(secondSession)
      expect(firstSession).to.equal(agent.getState().getSession())
    })

    it('returns the provided State Session from getSession', () => {
      const session = new Session()
      const agent = new Agent({state: new State(session)})

      expect(agent.getSession()).to.equal(session)
    })

  })

  describe('Session', () => {
    it('starts with a session header message', () => {
      const session = new Session()
      const messages = session.getMessages()

      expect(messages).to.have.length(1)
      expect(messages[0]).to.be.instanceOf(SessionHeader)
      expect(messages[0].type).to.equal(MessageType.Session)
      expect(messages[0].parentid).to.equal(null)
      expect(messages[0].id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('returns the first and last message ids for a new Session', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      expect(session.getFirstMessageId()).to.equal(header.id)
      expect(session.getLastMessageId()).to.equal(header.id)
    })

    it('returns null for message ids when the message list is empty', () => {
      const session = new Session()
      const internals = session as unknown as {messages: Message[]}
      internals.messages.length = 0

      expect(session.getFirstMessageId()).to.equal(null)
      expect(session.getLastMessageId()).to.equal(null)
    })

    it('keeps the first message id and updates the last message id as messages are appended', () => {
      const session = new Session()
      const header = session.getMessages()[0]
      session.appendMessage(MessageType.User)
      const second = session.appendMessage(MessageType.Assistant)

      expect(session.getFirstMessageId()).to.equal(header.id)
      expect(session.getLastMessageId()).to.equal(second.id)
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

    it('appends a copy of a prebuilt message instance with the last message id as parentid', () => {
      const session = new Session()
      const header = session.getMessages()[0]
      const message = new Message(MessageType.User, {
        contents: ['Hello', 'World'],
        parentid: 'custom-parent-id',
        payload: {content: 'Hello'},
        role: Role.User,
      })

      const appended = session.appendMessage(message)

      expect(appended).to.not.equal(message)
      expect(appended.type).to.equal(message.type)
      expect(appended.contents).to.deep.equal(message.contents)
      expect(appended.content).to.equal(message.content)
      expect(appended.payload).to.deep.equal(message.payload)
      expect(appended.role).to.equal(message.role)
      expect(appended.parentid).to.equal(header.id)
      expect(session.getMessages()[1]).to.equal(appended)
    })

    it('creates messages through the Message constructor', () => {
      const message = new Message(MessageType.Assistant, {
        content: 'Hello',
        parentid: 'parent-message-id',
        payload: {content: 'Hello'},
      })

      expect(message.type).to.equal(MessageType.Assistant)
      expect(message.role).to.equal(Role.Assistant)
      expect(message.contents).to.deep.equal(['Hello'])
      expect(message.content).to.equal('Hello')
      expect(message.parentid).to.equal('parent-message-id')
      expect(message.payload).to.deep.equal({content: 'Hello'})
      expect(message.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('uses the first contents entry as the content getter', () => {
      const message = new Message(MessageType.Assistant, {
        contents: ['first', 'second'],
      })

      expect(message.contents).to.deep.equal(['first', 'second'])
      expect(message.content).to.equal('first')
    })

    it('uses an empty content string when contents are omitted', () => {
      const message = new Message(MessageType.Assistant)

      expect(message.contents).to.deep.equal([])
      expect(message.content).to.equal('')
    })

    it('uses default roles for message types when role is omitted', () => {
      expect(new Message(MessageType.User).role).to.equal(Role.User)
      expect(new Message(MessageType.Session).role).to.equal(Role.System)
      expect(new Message(MessageType.Assistant).role).to.equal(Role.Assistant)
      expect(new Message(MessageType.Tool).role).to.equal(Role.Assistant)
    })

    it('uses an explicit role from MessageOptions', () => {
      const message = new Message(MessageType.Tool, {
        role: Role.User,
      })

      expect(message.role).to.equal(Role.User)
    })

    it('creates user messages with contents context', () => {
      const message = new UserMessage(['hello'], Role.User)

      expect(message.type).to.equal(MessageType.User)
      expect(message.contents).to.deep.equal(['hello'])
      expect(message.role).to.equal(Role.User)
      expect(message.content).to.equal('hello')
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
        role: Role.User,
      })
      const serialized = JSON.stringify(message)

      expect(JSON.parse(serialized)).to.deep.equal({
        contents: [],
        id: message.id,
        parentid: session.getMessages()[0].id,
        payload: {name: 'lookup', result: 'ok'},
        role: Role.User,
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

    it('overrides an explicit parentid with the last message id', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const message = session.appendMessage(MessageType.Tool, {
        parentid: 'custom-parent-id',
      })

      expect(message.parentid).to.equal(header.id)
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

    it('exports messages from the core message module', () => {
      const message = new CoreMessage(CoreMessageType.Assistant, {
        content: 'Hello',
      })

      expect(message.content).to.equal('Hello')
      expect(message.contents).to.deep.equal(['Hello'])
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
      expect(getRoles()).to.deep.equal([Role.Assistant, Role.System, Role.User, 'developer'])
    })
  })

  describe('splitSystemPrompt', () => {
    it('collects system messages and leaves visible history intact', () => {
      const hello = new Message(MessageType.User, {content: 'Hello'})
      const answer = new Message(MessageType.Assistant, {content: 'Hi there'})
      const result = splitSystemPrompt([
        new Message(MessageType.Session, {content: 'Japanese only', role: Role.System}),
        new Message(MessageType.Session, {content: 'Workspace context', role: Role.System}),
        hello,
        answer,
      ])

      expect(result.systemPrompt).to.equal('Japanese only\n\nWorkspace context')
      expect(result.messages).to.deep.equal([hello, answer])
    })
  })
})
