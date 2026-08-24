// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import type {
  AgentOptions,
  McpClient,
  Model,
  ModelInvokeOptions,
  Operator,
  OperatorOptions,
  PromptTemplateInput,
} from '../../src/core/models/index.js'
import type {MessageType as MessageTypeName} from '../../src/core/session/message.js'

import {MemorySessionLogStore, Role, SETTINGS_FILE_NAME} from '../../src/core/index.js'
import {Message as CoreMessage, MessageType as CoreMessageType, UserMessage} from '../../src/core/message/index.js'
import {
  Agent,
  createMcpToolManager,
  getModel,
  getProvider,
  getRoles,
  Message,
  MessageType,
  ModelRegistry,
  OperatorType,
  PromptTemplate,
  Session,
  SessionHeader,
  splitSystemPrompt,
  State,
  tool,
  ToolProfile,
} from '../../src/core/models/index.js'

const TEST_OLLAMA_MODEL = 'test-ollama-model'

describe('model helpers', () => {
  describe('Agent', () => {
    it('requires a model when using the default Ollama provider directly', () => {
      expect(() => new Agent()).to.throw('No model specified for provider: ollama')
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

    it('automatically binds an injected log store to the agent session', async () => {
      const logs = new MemorySessionLogStore()
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel: () => TEST_OLLAMA_MODEL,
            getName: () => OperatorType.Model,
            getProvider: () => 'ollama',
            invoke: async () => new Message(MessageType.Assistant, {content: 'ok'}),
          }),
        },
        logStore: logs,
      })
      agent.logger.setDebugEnabled(true)

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      const records = await logs.list(agent.getSession().getId())
      expect(records.data.map((record) => record.message)).to.include.members([
        'agent invoke started',
        'agent model iteration completed',
      ])
      expect(records.data.map((record) => record.eventType)).to.include.members([
        'session.created',
        'turn.started',
        'model.request.started',
        'model.request.completed',
        'turn.completed',
      ])
      expect(JSON.stringify(records.data)).not.to.contain('hello')
      expect(records.data.every((record) => record.correlation.sessionId === agent.getSession().getId())).to.equal(true)
      await agent.close()
      await logs.close()
    })

    it('passes operator options through to the model invoke call', async () => {
      const calls: {messages: Message[]; options?: Partial<OperatorOptions>}[] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return TEST_OLLAMA_MODEL
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

      expect(calls).to.have.length(1)
      expect(calls[0].options).to.deep.include(options)
      expect(calls[0].messages.map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
        {content: 'hello', role: Role.User},
      ])
    })

    it('prepends Agent messages when invoking the model', async () => {
      const calls: Message[][] = []
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return TEST_OLLAMA_MODEL
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

      expect(calls).to.have.length(1)
      expect(calls[0].map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
        {content: 'System context', role: Role.System},
        {content: 'hello', role: Role.User},
      ])
    })

    it('builds each model request from canonical session history and new input', async () => {
      const calls: Message[][] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (messages) => {
            calls.push(messages)
            return new Message(MessageType.Assistant, {content: `reply-${calls.length}`})
          }),
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'first'})])
      await agent.invoke([new Message(MessageType.User, {content: 'second'})])

      expect(calls.map((messages) => messages.map((message) => message.content))).to.deep.equal([
        ['first'],
        ['first', 'reply-1', 'second'],
      ])
      expect(agent.getSession().getConversationMessages().map((message) => message.content)).to.deep.equal([
        'first',
        'reply-1',
        'second',
        'reply-2',
      ])
    })

    it('returns the model response from run', async () => {
      const response = new Message(MessageType.Assistant, {content: 'ok'})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return TEST_OLLAMA_MODEL
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

      const session = new Session()
      const result = await agent.run(session, [new Message(MessageType.User)])

      expect(result).not.to.equal(response)
      expect(result.content).to.equal(response.content)
      expect(result.id).to.equal(response.id)
      expect(result.timestamp).to.equal(response.timestamp)
      expect(session.getConversationMessages().at(-1)).to.equal(result)
    })

    it('prepends Agent messages when running the model', async () => {
      const calls: Message[][] = []
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const agent = new Agent({
        deps: {
          createModel: (): Model => ({
            getModel() {
              return TEST_OLLAMA_MODEL
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

      expect(calls).to.have.length(1)
      expect(calls[0].map((message) => ({content: message.content, role: message.role}))).to.deep.equal([
        {content: 'System context', role: Role.System},
        {content: 'hello', role: Role.User},
      ])
    })

    it('copies AgentOptions messages when constructed', () => {
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const appendedMessage = new Message(MessageType.Session, {content: 'Appended context', role: Role.System})
      const messages = [systemMessage]
      const agent = new Agent({messages, model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}})

      messages.push(appendedMessage)

      expect(agent.messages).to.deep.equal([systemMessage])
    })

    it('copies AgentOptions tools when constructed', () => {
      const searchTool = tool((input: string) => input, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.string(),
      })
      const lookupTool = tool((input: string) => input, {
        description: 'Look up a value.',
        name: 'lookup',
        schema: z.string(),
      })
      const tools = [searchTool]
      const agent = new Agent({model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}, tools})

      tools.push(lookupTool)

      expect(agent.tools).to.deep.equal([searchTool])
    })

    it('passes constructor tools to the model invoke call', async () => {
      const searchTool = tool((input: string) => input, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.string(),
      })
      const calls: {options?: Partial<ModelInvokeOptions>}[] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (_messages, options) => {
            calls.push({options})
            return new Message(MessageType.Assistant, {content: 'ok'})
          }),
        },
        tools: [searchTool],
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      expect(calls[0].options?.tools).to.deep.equal([
        {description: searchTool.description, inputSchema: searchTool.inputSchema, name: searchTool.name},
      ])
    })

    it('loads the coding profile as model specifications', async () => {
      const calls: {options?: Partial<ModelInvokeOptions>}[] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (_messages, options) => {
            calls.push({options})
            return new Message(MessageType.Assistant, {content: 'ok'})
          }),
        },
        toolProfile: ToolProfile.Coding,
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      expect(calls[0].options?.tools?.map((availableTool) => availableTool.name)).to.deep.equal([
        'bash',
        'edit',
        'glob',
        'grep',
        'list',
        'read',
        'write',
      ])
      expect(calls[0].options?.tools?.every((availableTool) => !('execute' in availableTool))).to.equal(true)
    })

    it('lets workspace settings override the product default tool profile', async () => {
      const calls: {options?: Partial<ModelInvokeOptions>}[] = []
      const agent = new Agent({
        defaultToolProfile: ToolProfile.Coding,
        deps: {
          createModel: (): Model => createStubModel(async (_messages, options) => {
            calls.push({options})
            return new Message(MessageType.Assistant, {content: 'ok'})
          }),
        },
        settings: {tools: {include: ['read'], profile: ToolProfile.None}},
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      expect(calls[0].options?.tools?.map((availableTool) => availableTool.name)).to.deep.equal(['read'])
    })

    it('merges invocation tools with constructor tools', async () => {
      const searchTool = tool((input: string) => input, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.string(),
      })
      const lookupTool = tool((input: string) => input, {
        description: 'Look up a value.',
        name: 'lookup',
        schema: z.string(),
      })
      const calls: {options?: Partial<ModelInvokeOptions>}[] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (_messages, options) => {
            calls.push({options})
            return new Message(MessageType.Assistant, {content: 'ok'})
          }),
        },
        tools: [searchTool],
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})], {tools: [lookupTool]})

      expect(calls[0].options?.tools).to.deep.equal([
        {description: searchTool.description, inputSchema: searchTool.inputSchema, name: searchTool.name},
        {description: lookupTool.description, inputSchema: lookupTool.inputSchema, name: lookupTool.name},
      ])
    })

    it('rejects duplicate tool names across registration scopes', async () => {
      const first = tool((input: string) => input, {
        description: 'First.',
        name: 'duplicate',
        schema: z.string(),
      })
      const second = tool((input: string) => input, {
        description: 'Second.',
        name: 'duplicate',
        schema: z.string(),
      })
      const agent = new Agent({model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}, tools: [first]})

      try {
        await agent.invoke([new Message(MessageType.User, {content: 'hello'})], {tools: [second]})
        expect.fail('Expected duplicate registration to fail.')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.contain('Duplicate tool name: duplicate')
      }
    })

    it('loads configured MCP tools once and passes their input schema to the model', async () => {
      const inputSchema = {
        properties: {path: {type: 'string'}},
        required: ['path'],
        type: 'object',
      }
      const fakeClient = createFakeMcpClient({
        tools: [{description: 'Read a file.', inputSchema, name: 'read_file'}],
      })
      const manager = createMcpToolManager(
        {servers: {filesystem: {command: 'mcp-filesystem'}}},
        {
          clientFactory: () => fakeClient,
          transportFactory: () => ({}) as never,
        },
      )
      const calls: {options?: Partial<ModelInvokeOptions>}[] = []
      const agent = new Agent({
        deps: {
          createMcpToolManager: () => manager,
          createModel: (): Model => createStubModel(async (_messages, options) => {
            calls.push({options})
            return new Message(MessageType.Assistant, {content: 'ok'})
          }),
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])
      await agent.invoke([new Message(MessageType.User, {content: 'again'})])

      expect(fakeClient.listToolsCalls).to.equal(1)
      expect(calls[0].options?.tools?.map((availableTool) => ({
        description: availableTool.description,
        inputSchema: availableTool.inputSchema,
        name: availableTool.name,
      }))).to.deep.equal([
        {
          description: 'Read a file.',
          inputSchema,
          name: 'filesystem__read_file',
        },
      ])
    })

    it('executes namespaced MCP tool calls against the original remote tool name', async () => {
      const fakeClient = createFakeMcpClient({
        callToolOutput: {content: [{text: 'file contents', type: 'text'}]},
        tools: [{description: 'Read a file.', inputSchema: {type: 'object'}, name: 'read_file'}],
      })
      const manager = createMcpToolManager(
        {servers: {filesystem: {command: 'mcp-filesystem'}}},
        {
          clientFactory: () => fakeClient,
          transportFactory: () => ({}) as never,
        },
      )
      const calls: Message[][] = []
      const agent = new Agent({
        deps: {
          createMcpToolManager: () => manager,
          createModel: (): Model => createStubModel(async (messages) => {
            calls.push(messages)
            if (calls.length === 1) {
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: [{id: 'call-1', input: {path: 'README.md'}, name: 'filesystem__read_file'}],
                },
              })
            }

            return new Message(MessageType.Assistant, {content: 'done'})
          }),
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'read'})])

      expect(fakeClient.callToolCalls).to.deep.equal([{arguments: {path: 'README.md'}, name: 'read_file'}])
      expect(calls[1][2].payload).to.deep.equal({
        input: {path: 'README.md'},
        isError: false,
        name: 'filesystem__read_file',
        output: {content: [{text: 'file contents', type: 'text'}]},
        toolCallId: 'call-1',
      })
    })

    it('namespaces duplicate MCP tool names from multiple servers', async () => {
      const clients: Record<string, ReturnType<typeof createFakeMcpClient>> = {
        files: createFakeMcpClient({tools: [{inputSchema: {type: 'object'}, name: 'search'}]}),
        web: createFakeMcpClient({tools: [{inputSchema: {type: 'object'}, name: 'search'}]}),
      }
      const manager = createMcpToolManager(
        {
          servers: {
            files: {command: 'mcp-files'},
            web: {command: 'mcp-web'},
          },
        },
        {
          clientFactory: (serverName) => clients[serverName],
          transportFactory: () => ({}) as never,
        },
      )

      expect((await manager.getTools()).map((availableTool) => availableTool.name)).to.deep.equal([
        'files__search',
        'web__search',
      ])
    })

    it('closes connected MCP clients through Agent.close', async () => {
      const fakeClient = createFakeMcpClient({
        tools: [{description: 'Read a file.', inputSchema: {type: 'object'}, name: 'read_file'}],
      })
      const manager = createMcpToolManager(
        {servers: {filesystem: {command: 'mcp-filesystem'}}},
        {
          clientFactory: () => fakeClient,
          transportFactory: () => ({}) as never,
        },
      )
      const agent = new Agent({
        deps: {
          createMcpToolManager: () => manager,
          createModel: (): Model => createStubModel(async () => new Message(MessageType.Assistant, {content: 'ok'})),
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])
      await agent.close()

      expect(fakeClient.closeCalls).to.equal(1)
    })

    it('executes model tool calls and re-invokes the model with tool results', async () => {
      const searchTool = tool(({query}: {query: string}) => `result:${query}`, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.object({query: z.string()}),
      })
      const calls: Message[][] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (messages) => {
            calls.push(messages)
            if (calls.length === 1) {
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: [{id: 'call-1', input: {query: 'orbit'}, name: 'search'}],
                },
              })
            }

            return new Message(MessageType.Assistant, {content: 'done'})
          }),
        },
        tools: [searchTool],
      })

      const response = await agent.invoke([new Message(MessageType.User, {content: 'hello'})])
      const toolMessage = calls[1][2]

      expect(response.content).to.equal('done')
      expect(calls).to.have.length(2)
      expect(toolMessage.type).to.equal(MessageType.Tool)
      expect(toolMessage.payload).to.deep.equal({
        input: {query: 'orbit'},
        isError: false,
        name: 'search',
        output: {
          content: [{text: 'result:orbit', type: 'text'}],
        },
        toolCallId: 'call-1',
      })
    })

    it('returns tool execution errors to the model as tool results', async () => {
      const failingTool = tool(() => {
        throw new Error('boom')
      }, {
        description: 'Fail.',
        name: 'fail',
        schema: z.object({}),
      })
      const calls: Message[][] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (messages) => {
            calls.push(messages)
            if (calls.length === 1) {
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: [{id: 'call-1', input: {}, name: 'fail'}],
                },
              })
            }

            return new Message(MessageType.Assistant, {content: 'handled'})
          }),
        },
        tools: [failingTool],
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      expect(calls[1][2].payload).to.deep.equal({
        input: {},
        isError: true,
        name: 'fail',
        output: {content: [{text: 'boom', type: 'text'}], isError: true},
        toolCallId: 'call-1',
      })
    })

    it('returns unknown tool calls to the model as tool errors', async () => {
      const calls: Message[][] = []
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async (messages) => {
            calls.push(messages)
            if (calls.length === 1) {
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: [{id: 'call-1', input: {}, name: 'missing'}],
                },
              })
            }

            return new Message(MessageType.Assistant, {content: 'handled'})
          }),
        },
      })

      await agent.invoke([new Message(MessageType.User, {content: 'hello'})])

      expect(calls[1][2].payload).to.deep.equal({
        input: {},
        isError: true,
        name: 'missing',
        output: {content: [{text: 'Unknown tool: missing', type: 'text'}], isError: true},
        toolCallId: 'call-1',
      })
    })

    it('throws when the model exceeds max tool iterations', async () => {
      const searchTool = tool((input: string) => input, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.string(),
      })
      const agent = new Agent({
        deps: {
          createModel: (): Model => createStubModel(async () => new Message(MessageType.Assistant, {
            payload: {
              toolCalls: [{id: 'call-1', input: 'orbit', name: 'search'}],
            },
          })),
        },
        tools: [searchTool],
      })

      try {
        await agent.invoke([new Message(MessageType.User, {content: 'hello'})], {maxToolIterations: 1})
        throw new Error('Expected Agent.invoke to fail.')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('Agent exceeded maximum tool iterations: 1')
      }
    })

    it('treats models as operators and returns the model name', () => {
      const model = getModel('ollama', TEST_OLLAMA_MODEL)
      const operator: Operator<Message[], Message, OperatorOptions> = model

      expect(operator.getName()).to.equal(OperatorType.Model)
      expect(operator.getName('Suffix')).to.equal(`${OperatorType.Model}:Suffix`)
    })

    it('returns the agent operator name with optional suffixes', () => {
      const agent = new Agent({model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}})

      expect(agent.getName()).to.equal(OperatorType.Agent)
      expect(agent.getName('Suffix')).to.equal(`${OperatorType.Agent}:Suffix`)
      expect(agent.getName('')).to.equal(OperatorType.Agent)
    })

    it('accepts AgentOptions as the constructor type', () => {
      const systemMessage = new Message(MessageType.Session, {content: 'System context', role: Role.System})
      const searchTool = tool((input: string) => input, {
        description: 'Search for a value.',
        name: 'search',
        schema: z.string(),
      })
      const options: AgentOptions = {
        messages: [systemMessage],
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
        tools: [searchTool],
      }

      expect(options).to.deep.equal({
        messages: [systemMessage],
        model: {
          name: 'llama3.1',
          provider: 'ollama',
        },
        tools: [searchTool],
      })
    })

    it('returns the State Session from getSession', () => {
      const agent = new Agent({model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}})
      const firstSession = agent.getSession()
      const secondSession = agent.getSession()

      expect(firstSession).to.be.instanceOf(Session)
      expect(secondSession).to.be.instanceOf(Session)
      expect(firstSession).to.equal(secondSession)
      expect(firstSession).to.equal(agent.getState().getSession())
    })

    it('returns the provided State Session from getSession', () => {
      const session = new Session()
      const agent = new Agent({model: {name: TEST_OLLAMA_MODEL, provider: 'ollama'}, state: new State(session)})

      expect(agent.getSession()).to.equal(session)
    })

    it('loads workspace settings when constructed', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-agent-settings-'))
      await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
      await fs.writeFile(
        path.join(root, '.orbit', SETTINGS_FILE_NAME),
        JSON.stringify({
          provider: 'openai',
          providers: {
            openai: {apiKeyEnv: 'OPENAI_KEY'},
          },
        }),
      )

      const agent = new Agent({
        cwd: root,
        deps: {
          createModel: (_provider, _model, settings): Model => createStubModel(async () => new Message(MessageType.Assistant, {
            content: settings?.providers?.openai?.apiKeyEnv ?? '',
          })),
        },
      })

      expect(agent.getSettings()).to.deep.equal({
        provider: 'openai',
        providers: {
          openai: {apiKeyEnv: 'OPENAI_KEY'},
        },
      })
      expect((await agent.invoke([new Message(MessageType.User)])).content).to.equal('OPENAI_KEY')
    })

    it('lets AgentOptions settings override workspace settings', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-agent-settings-'))
      await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
      await fs.writeFile(
        path.join(root, '.orbit', SETTINGS_FILE_NAME),
        JSON.stringify({
          providers: {
            openai: {apiKeyEnv: 'WORKSPACE_OPENAI_KEY'},
          },
        }),
      )

      const agent = new Agent({
        cwd: root,
        deps: {
          createModel: (_provider, _model, settings): Model => createStubModel(async () => new Message(MessageType.Assistant, {
            content: settings?.providers?.openai?.apiKeyEnv ?? '',
          })),
        },
        settings: {
          providers: {
            openai: {apiKeyEnv: 'CLI_OPENAI_KEY'},
          },
        },
      })

      expect(agent.getSettings()).to.deep.equal({
        providers: {
          openai: {apiKeyEnv: 'CLI_OPENAI_KEY'},
        },
      })
      expect((await agent.invoke([new Message(MessageType.User)])).content).to.equal('CLI_OPENAI_KEY')
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
      session.appendMessages([new Message(MessageType.User)])
      const [second] = session.appendMessages([new Message(MessageType.Assistant)])

      expect(session.getFirstMessageId()).to.equal(header.id)
      expect(session.getLastMessageId()).to.equal(second.id)
    })

    it('appends a message and returns it', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const [message] = session.appendMessages([
        new Message(MessageType.User, {
          payload: {content: 'Hello'},
        }),
      ])

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

      const [appended] = session.appendMessages([message])

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

      const [message] = session.appendMessages([new Message(MessageType.Assistant)])

      expect(message.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    })

    it('serializes messages as JSON objects with the expected field names', () => {
      const session = new Session()

      const [message] = session.appendMessages([
        new Message(MessageType.Tool, {
          parentid: 'parent-message-id',
          payload: {name: 'lookup', result: 'ok'},
          role: Role.User,
        }),
      ])
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

      const [first] = session.appendMessages([new Message(MessageType.User)])
      const [second] = session.appendMessages([new Message(MessageType.Assistant)])

      expect(first.parentid).to.equal(header.id)
      expect(second.parentid).to.equal(first.id)
    })

    it('links messages appended together in order', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const [first, second] = session.appendMessages([new Message(MessageType.User), new Message(MessageType.Assistant)])

      expect(first.parentid).to.equal(header.id)
      expect(second.parentid).to.equal(first.id)
    })

    it('overrides an explicit parentid with the last message id', () => {
      const session = new Session()
      const header = session.getMessages()[0]

      const [message] = session.appendMessages([
        new Message(MessageType.Tool, {
          parentid: 'custom-parent-id',
        }),
      ])

      expect(message.parentid).to.equal(header.id)
    })

    it('returns a copy of the message list', () => {
      const session = new Session()
      const [message] = session.appendMessages([new Message(MessageType.User)])
      const messages = session.getMessages()
      const header = messages[0]

      messages.push(new Message(MessageType.Tool))

      expect(session.getMessages()).to.deep.equal([header, message])
    })

    it('throws when appending an unsupported message type', () => {
      const session = new Session()

      expect(() => session.appendMessages([new Message('System' as MessageTypeName)])).to.throw(
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
    it('rejects Ollama model creation when no model is specified', () => {
      expect(() => getModel('ollama')).to.throw('No model specified for provider: ollama')
    })

    it('returns the explicitly requested provider and model', () => {
      const model = getModel('anthropic', 'claude-custom')

      expect(model.getProvider()).to.equal('anthropic')
      expect(model.getModel()).to.equal('claude-custom')
    })
  })

  describe('ModelRegistry', () => {
    it('creates registered providers with their default model and settings', () => {
      const registry = new ModelRegistry()
      registry.register({
        create: (model, provider): Model => ({
          getModel: () => model,
          getName: () => OperatorType.Model,
          getProvider: () => provider.getName(),
          async invoke() {
            return new Message(MessageType.Assistant, {content: provider.getHost() ?? ''})
          },
        }),
        defaultModel: 'custom-default',
        name: 'custom',
      })

      const model = registry.create('custom', undefined, {providers: {custom: {host: 'http://custom'}}})

      expect(registry.names()).to.deep.equal(['custom'])
      expect(model.getModel()).to.equal('custom-default')
      expect(model.getProvider()).to.equal('custom')
    })

    it('rejects duplicate and unknown model providers', () => {
      const registry = new ModelRegistry()
      const registration = {
        create: (): Model => createStubModel(async () => new Message(MessageType.Assistant)),
        defaultModel: 'custom-default',
        name: 'custom',
      }
      registry.register(registration)

      expect(() => registry.register(registration)).to.throw('already registered')
      expect(() => registry.register({...registration, name: 'invalid provider'})).to.throw(
        'Invalid model provider name',
      )
      expect(() => registry.create('missing')).to.throw('Unsupported model provider: missing')
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

function createStubModel(
  invoke: (messages: Message[], options?: Partial<ModelInvokeOptions>) => Promise<Message>,
): Model {
  return {
    getModel() {
      return TEST_OLLAMA_MODEL
    },
    getName() {
      return OperatorType.Model
    },
    getProvider() {
      return 'ollama'
    },
    invoke,
  }
}

function createFakeMcpClient(options: {
  callToolOutput?: unknown
  tools: Array<{description?: string; inputSchema: Record<string, unknown>; name: string}>
}) {
  const client = {
    async callTool(params: {arguments?: Record<string, unknown>; name: string}) {
      client.callToolCalls.push(params)
      return options.callToolOutput ?? {content: []}
    },
    callToolCalls: [] as Array<{arguments?: Record<string, unknown>; name: string}>,
    async close() {
      client.closeCalls += 1
    },
    closeCalls: 0,
    async connect() {
      client.connectCalls += 1
    },
    connectCalls: 0,
    async listTools() {
      client.listToolsCalls += 1
      return {tools: options.tools}
    },
    listToolsCalls: 0,
  } satisfies McpClient & {
    callToolCalls: Array<{arguments?: Record<string, unknown>; name: string}>
    closeCalls: number
    connectCalls: number
    listToolsCalls: number
  }

  return client
}
