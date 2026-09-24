// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentOptions, Model} from '../../src/core/models/index.js'

import {
  createInitialInteractiveState,
  handleInventoryCommand,
  handleModelCommand,
  handleSlashCommand,
  normalizeInteractiveInput,
  slashCommandHelpMessage,
  submitInteractiveInput,
} from '../../src/core/interactive.js'
import {
  Agent,
  createLogger,
  createNoopLogger,
  Message,
  MessageType,
  OperatorType,
  Role,
} from '../../src/core/models/index.js'
import {SessionRepository} from '../session-storage-fixture.js'

function createMockAgent(invokeImpl: Model['invoke'], options: AgentOptions = {}): Agent {
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
    private readonly invokeImpl: Model['invoke'],
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
  it('lists inventory locally without consuming pending skills or creating an agent', async () => {
    class NoAgent extends Agent {
      constructor() {
        super({
          deps: {
            createModel() {
              throw new Error('Inventory must not create an agent')
            },
          },
        })
      }
    }
    const state = {
      ...createInitialInteractiveState({
        model: 'fixture',
        provider: 'ollama',
        settings: {
          mcp: {servers: {fixture: {command: 'never-start'}}},
          tools: {include: ['read'], profile: 'none'},
        },
      }),
      pendingSkills: [{digest: 'unchanged', id: 'workspace:review'}],
    }
    const result = await submitInteractiveInput(NoAgent, state, '/tools')
    expect(result.messages.at(-1)?.content).include('"read" [builtin] registered')
    expect(result.conversationMessages).deep.equal([])
    expect(result.pendingSkills).deep.equal(state.pendingSkills)
    const servers = await submitInteractiveInput(NoAgent, state, '/mcp')
    expect(servers.messages.at(-1)?.content).include('"fixture" not-connected tools=unknown')
    expect((await handleInventoryCommand(state, '/tools extra'))?.message).include('Invalid inventory command')
    expect(await handleInventoryCommand(state, '/other')).equal(undefined)
  })

  it('starts with an empty session state', () => {
    expect(createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})).to.deep.equal({
      conversationMessages: [],
      input: '',
      isLoading: false,
      messages: [],
      model: 'llama3.1',
      provider: 'ollama',
    })
  })

  it('hydrates visible history from a resumed session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-interactive-resume-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'resumed'})
    session.appendMessages([
      new Message(MessageType.User, {content: 'previous question', role: Role.User}),
      new Message(MessageType.Tool, {content: 'internal tool result'}),
      new Message(MessageType.Assistant, {content: 'previous answer', role: Role.Assistant}),
    ])

    const state = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama', session})

    expect(state.conversationMessages.map((message) => message.content)).to.deep.equal([
      'previous question',
      'internal tool result',
      'previous answer',
    ])
    expect(state.messages.map((message) => message.content)).to.deep.equal(['previous question', 'previous answer'])
    await session.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('appends user and assistant messages while keeping prior history', async () => {
    const agent = createMockAgent(
      async (messages) => new Message(MessageType.Assistant, {content: `reply:${messages.length}`}),
    )
    const AgentCtor = class extends MockAgent {
      constructor() {
        super((messages) => agent.invoke(messages))
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
    expect(second.messages.map((message) => message.content)).to.deep.equal(['hello', 'reply:1', 'again', 'reply:3'])
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

  it('shows the active session with current runtime provider and model', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-interactive-information-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({
      createdAt: '2026-08-25T01:02:03.000Z',
      cwd: root,
      id: 'session-information',
      model: 'persisted-model',
      originator: 'orbit-interactive',
      provider: 'ollama',
    })
    session.appendMessages([new Message(MessageType.User, {content: 'Investigate a failure', role: Role.User})])
    const state = createInitialInteractiveState({
      model: 'gpt-5',
      provider: 'openai',
      session,
    })

    const result = handleSlashCommand(state, '/session')

    expect(result?.nextState).to.equal(state)
    expect(result?.message).to.include('Session ID: session-information')
    expect(result?.message).to.include('Status: interrupted')
    expect(result?.message).to.include('Originator: orbit-interactive')
    expect(result?.message).to.include('Provider: openai')
    expect(result?.message).to.include('Model: gpt-5')
    expect(result?.message).to.include(`Transcript file: ${session.getFile()}`)
    expect(result?.message).to.include('Preview: Investigate a failure')
    expect(handleSlashCommand(state, '/session extra')?.message).to.equal('Invalid session command. Use /session')
    await session.close()
    await fs.rm(root, {force: true, recursive: true})
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

  it('returns slash command help while preserving state', () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const result = handleSlashCommand(initial, '/help')

    expect(result).to.deep.equal({
      message: slashCommandHelpMessage,
      nextState: initial,
    })
    expect(slashCommandHelpMessage).to.equal(
      [
        'Slash commands:',
        '/tools [--connect] - List tool metadata; optionally discover MCP tools',
        '/mcp [--connect] - List MCP servers; optionally connect to count tools',
        '/skills - List Skill IDs and digests',
        '/skill ID@DIGEST - Select for the next Run; /skill clear removes pending selections',
        '/help - Show slash commands',
        '/exit - Exit interactive mode',
        '/session - Show the current session information',
        '/model - Show the current model',
        '/model provider:model - Switch the current model',
        '/debug - Show debug logging state',
        '/debug on - Enable debug logging',
        '/debug off - Disable debug logging',
      ].join('\n'),
    )
  })

  it('reports slash command help without calling the agent', async () => {
    let callCount = 0
    const loggedCommands: unknown[] = []
    const logger = createNoopLogger()
    logger.info = (fields) => loggedCommands.push(fields)
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
      createInitialInteractiveState({logger, model: 'llama3.1', provider: 'ollama'}),
      '/help',
    )

    expect(callCount).to.equal(0)
    expect(nextState.messages.map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
      {content: slashCommandHelpMessage, role: Role.Assistant},
    ])
    expect(loggedCommands).to.deep.equal([{command: '/help'}])
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

  it('uses the switched provider and model without sending command output to the model', async () => {
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
        messages: ['hello'],
        model: 'gpt-4o',
        provider: 'openai',
      },
    ])
    expect(replied.messages.map((message) => message.content)).to.deep.equal([
      'Model switched to openai:gpt-4o',
      'hello',
      'reply:openai:gpt-4o',
    ])
    expect(replied.messages.map((message) => message.role)).to.deep.equal([Role.Assistant, Role.User, Role.Assistant])
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

  it('uses a persistent session as the canonical interactive history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-interactive-session-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'interactive-1', model: 'llama3.1', provider: 'ollama'})
    const AgentCtor = class extends MockAgent {
      constructor(options: AgentOptions = {}) {
        super(async (messages) => new Message(MessageType.Assistant, {content: `reply:${messages.length}`}), options)
      }
    }
    const initial = createInitialInteractiveState({
      model: 'llama3.1',
      provider: 'ollama',
      session,
    })

    const first = await submitInteractiveInput(AgentCtor, initial, 'hello')
    const command = await submitInteractiveInput(AgentCtor, first, '/help')
    const second = await submitInteractiveInput(AgentCtor, command, 'again')
    const file = session.getFile() as string
    await session.close()

    const resumed = repository.open(file)
    expect(second.messages.map((message) => message.content)).to.deep.equal([
      'hello',
      'reply:1',
      slashCommandHelpMessage,
      'again',
      'reply:3',
    ])
    expect(resumed.getConversationMessages().map((message) => message.content)).to.deep.equal([
      'hello',
      'reply:1',
      'again',
      'reply:3',
    ])
    await resumed.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  describe('normalizeInteractiveInput', () => {
    it('converts pasted carriage returns to line feeds', () => {
      expect(normalizeInteractiveInput('first line\rsecond line\rthird line')).to.equal('first line\nsecond line\nthird line')
    })

    it('converts CRLF line breaks to single line feeds', () => {
      expect(normalizeInteractiveInput('first line\r\nsecond line')).to.equal('first line\nsecond line')
    })

    it('leaves single-line input unchanged', () => {
      expect(normalizeInteractiveInput('hello')).to.equal('hello')
    })
  })
})
