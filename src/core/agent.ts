// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import {performance} from 'node:perf_hooks'
import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {AgentEvent, AgentEventHandler} from './agent-events.js'
import type {DiagnosticContext, DiagnosticEventBus} from './diagnostics/index.js'
import type {Logger} from './logger/index.js'
import type {SessionLogStore} from './logs/index.js'
import type {McpToolManager, McpToolManagerFactoryOptions} from './mcp.js'
import type {
  Model,
  ModelInvokeOptions,
  ModelToolCall,
  ModelToolCallPayload,
  ModelToolResultPayload,
  ProviderName,
} from './models/index.js'
import type {Operator, OperatorOptions} from './processor/index.js'
import type {Session, SessionContextBuilder as SessionContextBuilderType, SessionError} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'
import type {
  InvokableTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolProfileName,
  ToolResult,
} from './tools/index.js'

import {AgentEventType} from './agent-events.js'
import {ModelAbortError, OrbitError} from './errors/index.js'
import {FileSessionLogStore, StoreSessionLoggerFactory} from './logs/index.js'
import {createMcpToolManager} from './mcp.js'
import {getModel, Message, MessageType} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {SessionContextBuilder, TurnPhase} from './session/index.js'
import {loadWorkspaceSettingsSync, mergeWorkspaceSettings} from './settings.js'
import {State} from './state.js'
import {adaptInvokableTool, createBuiltinTools, ToolProfile, ToolRegistry, ToolRuntime} from './tools/index.js'

const DEFAULT_MAX_TOOL_ITERATIONS = 5

export type AgentTool = InvokableTool

export interface AgentInvokeOptions extends OperatorOptions {
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  maxToolIterations?: number
  onEvent?: AgentEventHandler
  signal?: AbortSignal
  tools?: AgentTool[]
  turnId?: string
}

export interface AgentOptions {
  cwd?: string
  defaultToolProfile?: ToolProfileName
  deps?: {
    createMcpToolManager?: (settings: WorkspaceSettings, options: McpToolManagerFactoryOptions) => McpToolManager
    createModel?: typeof getModel
    sessionContextBuilder?: SessionContextBuilderType
  }
  diagnostics?: DiagnosticEventBus
  logger?: Logger
  logStore?: SessionLogStore
  messages?: Message[]
  model?: {
    name?: string
    provider?: ProviderName
  }
  settings?: WorkspaceSettings
  state?: State
  toolDefinitions?: ToolDefinition[]
  toolProfile?: ToolProfileName
  tools?: AgentTool[]
}

export class Agent implements Operator<Message[], Message, AgentInvokeOptions> {
  public readonly logger: Logger
  public readonly messages: Message[]
  public readonly settings: WorkspaceSettings
  public readonly state: State
  public readonly tools: AgentTool[]
  private readonly cwd: string
  private readonly diagnostics?: DiagnosticEventBus
  private readonly mcpToolManager: McpToolManager
  private readonly model: Model
  private readonly ownedLogStore?: SessionLogStore
  private readonly sessionContextBuilder: SessionContextBuilderType
  private readonly toolDefinitions: ToolDefinition[]

  // Model, session, diagnostics, and tool profile dependencies are resolved at one construction boundary.
  // eslint-disable-next-line complexity
  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.settings = mergeWorkspaceSettings(loadWorkspaceSettingsSync(options.cwd), options.settings)
    this.cwd = path.resolve(options.cwd ?? process.cwd())
    this.model = createModel(
      options.model?.provider ?? this.settings.provider,
      options.model?.name ?? this.settings.model,
      this.settings,
    )
    this.sessionContextBuilder = options.deps?.sessionContextBuilder ?? new SessionContextBuilder()
    this.diagnostics = options.diagnostics
    this.messages = [...(options.messages ?? [])]
    this.state = options.state ?? new State()
    if (options.logger === undefined) {
      const store = options.logStore ?? new FileSessionLogStore()
      if (options.logStore === undefined) this.ownedLogStore = store
      this.logger = new StoreSessionLoggerFactory(store).forSession(this.state.getSession().getId(), {
        component: 'agent',
      })
    } else {
      this.logger = options.logger.child({component: 'agent'})
    }

    this.toolDefinitions = [
      ...createBuiltinTools({
        ...this.settings.tools,
        profile: options.toolProfile ?? this.settings.tools?.profile ?? options.defaultToolProfile ?? ToolProfile.None,
      }),
      ...(options.toolDefinitions ?? []),
    ]
    this.tools = [...(options.tools ?? [])]
    this.mcpToolManager = (options.deps?.createMcpToolManager ?? createMcpToolManager)(this.settings, {
      cwd: options.cwd,
      diagnosticContext: {
        sessionId: this.state.getSession().getId(),
        threadId: this.state.getSession().getId(),
      },
      diagnostics: this.diagnostics,
    })
    this.diagnostics?.emit({
      data: {
        cwd: this.cwd,
        model: this.model.getModel(),
        provider: this.model.getProvider(),
      },
      sessionId: this.state.getSession().getId(),
      type: 'model.selected',
    })
  }

  async close(): Promise<void> {
    try {
      await this.mcpToolManager.close()
    } finally {
      await this.ownedLogStore?.close()
    }
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

  /** Runs one turn from new input and derives prior model context from the agent session. */
  async invoke(messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message> {
    return this.invokeSession(this.getSession(), messages, options)
  }

  /** Runs one turn from new input and derives prior model context from the supplied session. */
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
      session.appendMessages(messages, {turnId})
      throwIfAborted(options?.signal)
      const sessionMessageCount = this.sessionContextBuilder.build(session).messages.length
      this.logger.debug(
        {
          initialMessageCount: this.messages.length,
          newMessageCount: messages.length,
          sessionMessageCount,
        },
        'agent invoke started',
      )
      const mcpTools = await this.mcpToolManager.getTools()
      throwIfAborted(options?.signal)
      const tools = [...this.tools, ...mcpTools, ...(options?.tools ?? [])]
      const registry = new ToolRegistry()
      for (const definition of this.toolDefinitions) registry.register(definition)
      for (const [index, availableTool] of tools.entries()) {
        registry.register(
          adaptInvokableTool(availableTool, availableTool.source ?? {id: `agent:${index}`, kind: 'custom'}),
        )
      }

      const toolSnapshot = registry.snapshot()
      const toolRuntime = new ToolRuntime(toolSnapshot)
      const diagnostics = options?.diagnostics ?? this.diagnostics
      const modelOptions: Partial<ModelInvokeOptions> = {
        ...toModelInvokeOptions(options),
        ...(diagnostics === undefined
          ? {}
          : {
              diagnosticContext: {
                iteration: 0,
                runId: turnId,
                sessionId: session.getId(),
                threadId: session.getId(),
              },
              diagnostics,
            }),
        ...(toolSnapshot.specs().length > 0 ? {tools: toolSnapshot.specs()} : {}),
      }
      this.logger.debug(
        {
          mcpToolCount: mcpTools.length,
          toolCount: toolSnapshot.specs().length,
        },
        'agent tools loaded',
      )

      for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
        throwIfAborted(options?.signal)
        this.logger.debug({iteration, maxToolIterations}, 'agent model iteration started')
        emitAgentEvent(options?.onEvent, {iteration, type: AgentEventType.ModelStarted})
        const iterationOptions =
          modelOptions.diagnostics === undefined
            ? modelOptions
            : {
                ...modelOptions,
                diagnosticContext: {...modelOptions.diagnosticContext, iteration},
              }
        const context = this.sessionContextBuilder.build(session)
        // Tool loops are intentionally sequential because each model response depends on the previous tool results.
        // eslint-disable-next-line no-await-in-loop
        const modelMessage = await this.model.invoke([...this.messages, ...context.messages], iterationOptions)
        throwIfAborted(options?.signal)
        const [storedModelMessage] = session.appendMessages([modelMessage], {iteration, turnId})
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
        const signal = options?.signal ?? new AbortController().signal
        // eslint-disable-next-line no-await-in-loop
        const toolResults = await toolRuntime.executeAll(
          toolCalls,
          (toolCall): ToolExecutionContext => ({
            callId: toolCall.id,
            cwd: this.cwd,
            emitUpdate(update) {
              emitAgentEvent(options?.onEvent, {
                iteration,
                toolCall,
                type: AgentEventType.ToolUpdated,
                update,
              })
            },
            signal,
          }),
          (toolCall, execute) => this.observeToolExecution(toolCall, execute, iteration, options),
        )
        const storedToolMessages = session.appendMessages(
          toolResults.map((result) => createToolResultMessage(result.toolCall, result.result)),
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

  // Tool execution, error projection, and diagnostics share one lifecycle boundary.
  private async observeToolExecution(
    toolCall: ModelToolCall,
    execute: () => Promise<ToolExecutionResult>,
    iteration: number,
    options?: Partial<AgentInvokeOptions>,
  ): Promise<ToolExecutionResult> {
    throwIfAborted(options?.signal)
    emitAgentEvent(options?.onEvent, {iteration, toolCall, type: AgentEventType.ToolStarted})
    const diagnostics = options?.diagnostics ?? this.diagnostics
    const diagnosticContext = {
      ...options?.diagnosticContext,
      iteration,
      runId: options?.turnId ?? options?.diagnosticContext?.runId,
      sessionId: options?.diagnosticContext?.sessionId ?? this.state.getSession().getId(),
    }
    diagnostics?.emit({
      ...diagnosticContext,
      data: {name: toolCall.name, toolCallId: toolCall.id},
      fullData: {input: toolCall.input},
      type: 'tool.started',
    })
    const startedAt = performance.now()
    const execution = await execute()
    throwIfAborted(options?.signal)
    const isError = execution.result.isError === true
    diagnostics?.emit({
      ...diagnosticContext,
      data: {durationMs: performance.now() - startedAt, isError, name: toolCall.name, toolCallId: toolCall.id},
      fullData: {input: toolCall.input, output: execution.result},
      ...(isError ? {level: 'error' as const} : {}),
      type: 'tool.completed',
    })
    return execution
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

function createToolResultMessage(toolCall: ModelToolCall, output: ToolResult): Message {
  const payload: ModelToolResultPayload = {
    input: toolCall.input,
    isError: output.isError === true,
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

function toModelInvokeOptions(options: Partial<AgentInvokeOptions> | undefined): Partial<ModelInvokeOptions> {
  const result: Record<string, unknown> = {...options}
  delete result.onEvent
  delete result.tools
  delete result.turnId
  return result as Partial<ModelInvokeOptions>
}
