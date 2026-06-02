// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {z} from 'zod'

import type {Logger} from './logger/index.js'
import type {McpToolManager, McpToolManagerFactoryOptions} from './mcp.js'
import type {
  Model,
  ModelInvokeOptions,
  ModelToolCall,
  ModelToolCallPayload,
  ModelToolResultPayload,
  ProviderName,
  ToolOptions,
} from './models/index.js'
import type {Operator} from './processor/index.js'
import type {Session} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'

import {createNoopLogger} from './logger/index.js'
import {createMcpToolManager} from './mcp.js'
import {getModel, Message, MessageType} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {loadWorkspaceSettingsSync, mergeWorkspaceSettings} from './settings.js'
import {State} from './state.js'

const DEFAULT_MAX_TOOL_ITERATIONS = 5

export interface AgentTool extends Operator<never, unknown, ToolOptions> {
  readonly description: string
  readonly inputSchema?: Record<string, unknown>
  readonly name: string
  readonly schema: z.ZodType<unknown>
}

export interface AgentOptions {
  cwd?: string
  deps?: {
    createMcpToolManager?: (settings: WorkspaceSettings, options: McpToolManagerFactoryOptions) => McpToolManager
    createModel?: typeof getModel
  }
  logger?: Logger
  messages?: Message[]
  model?: {
    name?: string
    provider?: ProviderName
  }
  settings?: WorkspaceSettings
  state?: State
  tools?: AgentTool[]
}

export class Agent implements Operator<Message[], Message, ModelInvokeOptions> {
  public readonly logger: Logger
  public readonly messages: Message[]
  public readonly settings: WorkspaceSettings
  public readonly state: State
  public readonly tools: AgentTool[]
  private readonly mcpToolManager: McpToolManager
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.settings = mergeWorkspaceSettings(loadWorkspaceSettingsSync(options.cwd), options.settings)
    this.model = createModel(
      options.model?.provider ?? this.settings.provider,
      options.model?.name ?? this.settings.model,
      this.settings,
    )
    this.messages = [...(options.messages ?? [])]
    this.logger = (options.logger ?? createNoopLogger()).child({component: 'agent'})
    this.state = options.state ?? new State()
    this.tools = [...(options.tools ?? [])]
    this.mcpToolManager = (options.deps?.createMcpToolManager ?? createMcpToolManager)(this.settings, {
      cwd: options.cwd,
    })
  }

  async close(): Promise<void> {
    await this.mcpToolManager.close()
  }

  getModel(): Model {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Agent, suffix)
  }

  getSession(): Session {
    return this.state.getSession()
  }

  getSettings(): WorkspaceSettings {
    return this.settings
  }

  getState(): State {
    return this.state
  }

  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    const session = this.getSession()
    session.appendMessages(messages)
    const conversation = [...messages]
    this.logger.debug(
      {
        initialMessageCount: this.messages.length,
        requestMessageCount: messages.length,
      },
      'agent invoke started',
    )
    const mcpTools = await this.mcpToolManager.getTools()
    const tools = [...this.tools, ...mcpTools, ...(options?.tools ?? [])]
    const modelOptions = tools.length > 0 ? {...options, tools} : options
    const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
    this.logger.debug(
      {
        mcpToolCount: mcpTools.length,
        toolCount: tools.length,
      },
      'agent tools loaded',
    )

    for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
      this.logger.debug({iteration, maxToolIterations}, 'agent model iteration started')
      // Tool loops are intentionally sequential because each model response depends on the previous tool results.
      // eslint-disable-next-line no-await-in-loop
      const modelMessage = await this.model.invoke([...this.messages, ...conversation], modelOptions)
      session.appendMessages([modelMessage])
      conversation.push(modelMessage)
      this.logger.debug({iteration, role: modelMessage.role}, 'agent model iteration completed')

      const toolCalls = getToolCalls(modelMessage)
      this.logger.debug({iteration, toolCallCount: toolCalls.length}, 'agent tool calls received')
      if (toolCalls.length === 0) {
        return modelMessage
      }

      if (iteration === maxToolIterations) {
        this.logger.debug({maxToolIterations, toolCallCount: toolCalls.length}, 'agent max tool iterations exceeded')
        throw new Error(`Agent exceeded maximum tool iterations: ${maxToolIterations}`)
      }

      // Tool execution for one model turn can run in parallel before the next model call.
      // eslint-disable-next-line no-await-in-loop
      const toolMessages = await Promise.all(toolCalls.map((toolCall) => this.invokeTool(toolCall, tools, options)))
      session.appendMessages(toolMessages)
      conversation.push(...toolMessages)
    }

    throw new Error(`Agent exceeded maximum tool iterations: ${maxToolIterations}`)
  }

  async run(_session: Session, messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    return this.invoke(messages, options)
  }

  private async invokeTool(
    toolCall: ModelToolCall,
    tools: AgentTool[],
    options?: Partial<ModelInvokeOptions>,
  ): Promise<Message> {
    const tool = tools.find((candidate) => candidate.name === toolCall.name)

    if (tool === undefined) {
      return createToolResultMessage(toolCall, `Unknown tool: ${toolCall.name}`, true)
    }

    try {
      const output = await tool.invoke(toolCall.input as never, options)
      return createToolResultMessage(toolCall, output)
    } catch (error) {
      return createToolResultMessage(toolCall, error instanceof Error ? error.message : String(error), true)
    }
  }
}

function createToolResultMessage(toolCall: ModelToolCall, output: unknown, isError = false): Message {
  const payload: ModelToolResultPayload = {
    input: toolCall.input,
    isError,
    name: toolCall.name,
    output,
    toolCallId: toolCall.id,
  }

  return new Message(MessageType.Tool, {
    payload,
  })
}

function getToolCalls(message: Message): ModelToolCall[] {
  if (!isModelToolCallPayload(message.payload)) {
    return []
  }

  return message.payload.toolCalls
}

function isModelToolCallPayload(payload: unknown): payload is ModelToolCallPayload {
  if (typeof payload !== 'object' || payload === null || !('toolCalls' in payload)) {
    return false
  }

  return Array.isArray((payload as ModelToolCallPayload).toolCalls)
}
