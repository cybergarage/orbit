// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model} from '../../src/core/models/index.js'

import {
  createInitialInteractiveState,
  handleModelCommand,
  handleSlashCommand,
  submitInteractiveInput,
} from '../../src/core/interactive.js'
import {Agent, createLogger, Message, MessageType, OperatorType, Role} from '../../src/core/models/index.js'

function createMockAgent(
  invokeImpl: Agent['invoke'],
  options: AgentOptions = {},
): Agent {
  return new Agent({
    ...options,
    deps: {
      createModel: (): Model => ({
        getModel() {
          return options.model?.name ?? 'llama3.1'
        },
        getName() {
          return OperatorType.Model
        },
        getProvider() {
          return options.model?.provider ?? 'ollama'
        },
        invoke: invokeImpl,
      }),
    },
  })
}

class MockAgent extends Agent {
  constructor(
    private readonly invokeImpl: Agent['invoke'],
    options: AgentOptions = {},
  ) {
    super({
      ...options,
      deps: {
        createModel: (): Model => ({
          getModel() {
            return options.model?.name ?? 'llama3.1'
          },
          getName() {
            return OperatorType.Model
          },
          getProvider() {
            return options.model?.provider ?? 'ollama'
          },
          invoke: invokeImpl,
        }),
      },
    })
  }
}

describe('interactive helpers', () => {
  it('starts with an empty session state', () => {
    expect(createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})).to.deep.equal({
      input: '',
      isLoading: false,
      messages: [],
      model: 'llama3.1',
      provider: 'ollama',
    })
  })

  it('appends user and assistant messages while keeping prior history', async () => {
    const agent = createMockAgent(async (messages) =>
      new Message(MessageType.Assistant, {content: `reply:${messages.length}`}),
    )
    const AgentCtor = class extends MockAgent {
      constructor() {
        super(agent.invoke.bind(agent))
      }
    }

    const first = await submitInteractiveInput(
      AgentCtor,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      'hello',
    )
    const second = await submitInteractiveInput(AgentCtor, first, 'again')

    expect(first.messages.map((message) => message.content)).to.deep.equal(['hello', 'reply:1'])
    expect(first.messages.map((message) => message.role)).to.deep.equal([Role.User, Role.Assistant])
    expect(second.messages.map((message) => message.content)).to.deep.equal([
      'hello',
      'reply:1',
      'again',
      'reply:3',
    ])
    expect(second.messages.map((message) => message.role)).to.deep.equal([
      Role.User,
      Role.Assistant,
      Role.User,
      Role.Assistant,
    ])
  })

  it('ignores exit commands and empty input', async () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async () => {
          throw new Error('should not be called')
        }, options)
      }
    }

    expect(await submitInteractiveInput(AgentCtor, initial, '   ')).to.equal(initial)
    expect(await submitInteractiveInput(AgentCtor, initial, '/exit')).to.equal(initial)
  })

  it('returns the current provider:model for /model', () => {
    const initial = createInitialInteractiveState({model: 'gpt-4o', provider: 'openai'})
    const result = handleModelCommand(initial, '/model')

    expect(result).to.deep.equal({
      message: 'Current model: openai:gpt-4o',
      nextState: initial,
    })
  })

  it('updates provider and model for /model provider:model', () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const result = handleModelCommand(initial, '/model anthropic:claude-opus-4-6')

    expect(result).to.deep.equal({
      message: 'Model switched to anthropic:claude-opus-4-6',
      nextState: {
        ...initial,
        model: 'claude-opus-4-6',
        provider: 'anthropic',
      },
    })
  })

  it('reports and toggles debug logging with /debug commands', async () => {
    const logger = createLogger()
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async () => {
          throw new Error('should not be called')
        }, options)
      }
    }
    const initial = createInitialInteractiveState({logger, model: 'llama3.1', provider: 'ollama'})
    const enabled = await submitInteractiveInput(AgentCtor, initial, '/debug on')
    const status = await submitInteractiveInput(AgentCtor, enabled, '/debug')
    const disabled = await submitInteractiveInput(AgentCtor, status, '/debug off')

    expect(logger.isDebugEnabled()).to.equal(false)
    expect(disabled.messages.map((message) => message.content)).to.deep.equal([
      'Debug logging enabled',
      'Debug logging is on',
      'Debug logging disabled',
    ])
    expect(disabled.messages.map((message) => message.role)).to.deep.equal([
      Role.Assistant,
      Role.Assistant,
      Role.Assistant,
    ])
  })

  it('reports invalid /debug arguments without calling the agent', async () => {
    let callCount = 0
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async () => {
          callCount++
          return new Message(MessageType.Assistant, {content: 'should not run'})
        }, options)
      }
    }

    const nextState = await submitInteractiveInput(
      AgentCtor,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      '/debug maybe',
    )

    expect(callCount).to.equal(0)
    expect(nextState.messages.map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
      {content: 'Invalid debug command. Use /debug, /debug on, or /debug off', role: Role.Assistant},
    ])
  })

  it('reports unknown slash commands without calling the agent', () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const result = handleSlashCommand(initial, '/unknown value')

    expect(result).to.deep.equal({
      message: 'Unknown command: /unknown',
      nextState: initial,
    })
  })

  it('reports invalid /model syntax as an assistant message without calling the agent', async () => {
    let callCount = 0
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async () => {
          callCount++
          return new Message(MessageType.Assistant, {content: 'should not run'})
        }, options)
      }
    }

    const nextState = await submitInteractiveInput(
      AgentCtor,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      '/model invalid',
    )

    expect(callCount).to.equal(0)
    expect(nextState.messages.map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
      {content: 'Invalid model command. Use /model provider:model', role: Role.Assistant},
    ])
  })

  it('uses the switched provider and model for subsequent chat requests', async () => {
    const calls: {messages: string[]; model: string; provider: string}[] = []
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async (messages) => {
          const provider = options.model?.provider ?? 'ollama'
          const model = options.model?.name ?? 'llama3.1'
          calls.push({messages: messages.map((message) => message.content), model, provider})
          return new Message(MessageType.Assistant, {content: `reply:${provider}:${model}`})
        }, options)
      }
    }

    const switched = await submitInteractiveInput(
      AgentCtor,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      '/model openai:gpt-4o',
    )
    const replied = await submitInteractiveInput(AgentCtor, switched, 'hello')

    expect(calls).to.deep.equal([
      {
        messages: ['Model switched to openai:gpt-4o', 'hello'],
        model: 'gpt-4o',
        provider: 'openai',
      },
    ])
    expect(replied.messages.map((message) => message.content)).to.deep.equal([
      'Model switched to openai:gpt-4o',
      'hello',
      'reply:openai:gpt-4o',
    ])
    expect(replied.messages.map((message) => message.role)).to.deep.equal([
      Role.Assistant,
      Role.User,
      Role.Assistant,
    ])
  })

  it('prepends the system prompt only to the outgoing request', async () => {
    const calls: string[][] = []
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async (messages) => {
          calls.push(messages.map((message) => `${message.role}:${message.content}`))
          return new Message(MessageType.Assistant, {content: 'reply'})
        }, options)
      }
    }

    const nextState = await submitInteractiveInput(
      AgentCtor,
      createInitialInteractiveState({
        model: 'llama3.1',
        provider: 'ollama',
        systemPrompt: 'Workspace rules',
      }),
      'hello',
    )

    expect(calls).to.deep.equal([['system:Workspace rules', 'user:hello']])
    expect(nextState.messages.map((message) => message.content)).to.deep.equal(['hello', 'reply'])
    expect(nextState.messages.map((message) => message.role)).to.deep.equal([Role.User, Role.Assistant])
  })
})
