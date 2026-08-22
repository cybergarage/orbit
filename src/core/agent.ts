// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {z} from 'zod'

import path from 'node:path'
import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {AgentEvent, AgentEventHandler} from './agent-events.js'
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
import type {Session, SessionError} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'

import {AgentEventType} from './agent-events.js'
import {ModelAbortError, OrbitError} from './errors/index.js'
import {createNoopLogger} from './logger/index.js'
import {createMcpToolManager} from './mcp.js'
import {getModel, Message, MessageType} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {TurnPhase} from './session/index.js'
import {loadWorkspaceSettingsSync, mergeWorkspaceSettings} from './settings.js'
import {State} from './state.js'

const DEFAULT_MAX_TOOL_ITERATIONS = 5

export interface AgentTool extends Operator<never, unknown, ToolOptions> {
  readonly description: string
  readonly inputSchema?: Record<string, unknown>
  readonly name: string
  readonly schema: z.ZodType<unknown>
}

export interface AgentInvokeOptions extends ModelInvokeOptions {
  onEvent?: AgentEventHandler
  turnId?: string
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

export class Agent implements Operator<Message[], Message, AgentInvokeOptions> {
  public readonly logger: Logger
  public readonly messages: Message[]
  public readonly settings: WorkspaceSettings
  public readonly state: State
  public readonly tools: AgentTool[]
  private readonly cwd: string
  private readonly mcpToolManager: McpToolManager
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.settings = mergeWorkspaceSettings(loadWorkspaceSettingsSync(options.cwd), options.settings)
    this.cwd = path.resolve(options.cwd ?? process.cwd())
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

  async invoke(messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message> {
    return this.invokeSession(this.getSession(), messages, options)
  }

  async run(session: Session, messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message> {
    return this.invokeSession(session, messages, options)
  }

  // Session recording, tool iteration, and terminal-state handling intentionally share one lifecycle boundary.
  // eslint-disable-next-line complexity
  private async invokeSession(
    session: Session,
    messages: Message[],
    options?: Partial<AgentInvokeOptions>,
  ): Promise<Message> {
    const turnId = options?.turnId ?? uuidv7()
    const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
    try {
      session.recordTurnContext({
        cwd: this.cwd,
        maxToolIterations,
        model: this.model.getModel(),
        provider: this.model.getProvider(),
        turnId,
      })
      session.recordTurnEvent({phase: TurnPhase.Started, turnId})
      session.appendNewMessages(messages, {turnId})
      throwIfAborted(options?.signal)
      const conversation = [...messages]
      this.logger.debug(
        {
          initialMessageCount: this.messages.length,
          requestMessageCount: messages.length,
        },
        'agent invoke started',
      )
      const mcpTools = await this.mcpToolManager.getTools()
      throwIfAborted(options?.signal)
      const tools = [...this.tools, ...mcpTools, ...(options?.tools ?? [])]
      const modelOptions = tools.length > 0 ? {...options, tools} : options
      this.logger.debug(
        {
          mcpToolCount: mcpTools.length,
          toolCount: tools.length,
        },
        'agent tools loaded',
      )

      for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
        throwIfAborted(options?.signal)
        this.logger.debug({iteration, maxToolIterations}, 'agent model iteration started')
        emitAgentEvent(options?.onEvent, {iteration, type: AgentEventType.ModelStarted})
        // Tool loops are intentionally sequential because each model response depends on the previous tool results.
        // eslint-disable-next-line no-await-in-loop
        const modelMessage = await this.model.invoke([...this.messages, ...conversation], modelOptions)
        throwIfAborted(options?.signal)
        const [storedModelMessage] = session.appendMessages([modelMessage], {iteration, turnId})
        conversation.push(storedModelMessage)
        emitAgentEvent(options?.onEvent, {
          iteration,
          message: storedModelMessage,
          type: AgentEventType.MessageCompleted,
        })
        this.logger.debug({iteration, role: modelMessage.role}, 'agent model iteration completed')

        const toolCalls = getToolCalls(storedModelMessage)
        this.logger.debug({iteration, toolCallCount: toolCalls.length}, 'agent tool calls received')
        if (toolCalls.length === 0) {
          session.recordTurnEvent({phase: TurnPhase.Completed, turnId})
          // The terminal flush belongs to this iteration and must finish before returning the response.
          // eslint-disable-next-line no-await-in-loop
          await session.flush()
          return storedModelMessage
        }

        if (iteration === maxToolIterations) {
          this.logger.debug({maxToolIterations, toolCallCount: toolCalls.length}, 'agent max tool iterations exceeded')
          throw new Error(`Agent exceeded maximum tool iterations: ${maxToolIterations}`)
        }

        // Tool execution for one model turn can run in parallel before the next model call.
        // eslint-disable-next-line no-await-in-loop
        const toolResults = await Promise.all(
          toolCalls.map(async (toolCall) => ({
            message: await this.invokeTool(toolCall, tools, iteration, options),
            toolCall,
          })),
        )
        const storedToolMessages = session.appendMessages(
          toolResults.map((result) => result.message),
          {iteration, turnId},
        )
        for (const [index, message] of storedToolMessages.entries()) {
          emitAgentEvent(options?.onEvent, {
            iteration,
            message,
            toolCall: toolResults[index].toolCall,
            type: AgentEventType.ToolCompleted,
          })
        }

        conversation.push(...storedToolMessages)
      }

      throw new Error(`Agent exceeded maximum tool iterations: ${maxToolIterations}`)
    } catch (error) {
      if (options?.signal?.aborted && !(error instanceof ModelAbortError)) {
        const abortError = new ModelAbortError('Agent invocation aborted.', {cause: error})
        session.recordTurnEvent({phase: TurnPhase.Cancelled, turnId})
        await session.flush()
        throw abortError
      }

      if (error instanceof ModelAbortError) {
        session.recordTurnEvent({phase: TurnPhase.Cancelled, turnId})
        await session.flush()
        throw error
      }

      session.recordTurnEvent({error: serializeSessionError(error), phase: TurnPhase.Failed, turnId})
      await session.flush()
      throw error
    }
  }

  private async invokeTool(
    toolCall: ModelToolCall,
    tools: AgentTool[],
    iteration: number,
    options?: Partial<AgentInvokeOptions>,
  ): Promise<Message> {
    throwIfAborted(options?.signal)
    emitAgentEvent(options?.onEvent, {iteration, toolCall, type: AgentEventType.ToolStarted})
    const tool = tools.find((candidate) => candidate.name === toolCall.name)

    if (tool === undefined) {
      return createToolResultMessage(toolCall, `Unknown tool: ${toolCall.name}`, true)
    }

    try {
      const output = await tool.invoke(toolCall.input as never, options)
      throwIfAborted(options?.signal)
      return createToolResultMessage(toolCall, output)
    } catch (error) {
      throwIfAborted(options?.signal)
      return createToolResultMessage(toolCall, error instanceof Error ? error.message : String(error), true)
    }
  }
}

function emitAgentEvent(handler: AgentEventHandler | undefined, event: AgentEvent): void {
  handler?.(event)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ModelAbortError('Agent invocation aborted.', {cause: signal.reason})
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

function serializeSessionError(error: unknown): SessionError {
  if (error instanceof OrbitError) {
    return {
      ...(error.code === undefined ? {} : {code: error.code}),
      message: error.message,
      name: error.name,
    }
  }

  if (error instanceof Error) return {message: error.message, name: error.name}
  return {message: String(error), name: 'Error'}
}
