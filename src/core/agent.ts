// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import {performance} from 'node:perf_hooks'
import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {AgentEvent, AgentEventHandler} from './agent-events.js'
import type {DiagnosticContext, DiagnosticEventBus} from './diagnostics/index.js'
import type {ExecutionPolicy} from './execution/authorization.js'
import type {ExecutionJournal, JournalLevel} from './execution/journal.js'
import type {ApprovalReply, ApprovalRequest, RunContext, RunHandle, RunLimits, RunSnapshot} from './execution/run.js'
import type {Logger} from './logger/index.js'
import type {SessionLogStore} from './logs/index.js'
import type {McpToolManager, McpToolManagerFactoryOptions} from './mcp.js'
import type {
  Model,
  ModelInvokeOptions,
  ModelResponseMetadata,
  ModelToolCall,
  ModelToolCallPayload,
  ModelToolResultPayload,
  ProviderName,
} from './models/index.js'
import type {Operator, OperatorOptions} from './processor/index.js'
import type {ContextPolicy} from './session/context-policy.js'
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
import {InvalidInputError, ModelAbortError, OrbitError} from './errors/index.js'
import {assertManagedTool, executeManagedTool} from './execution/authorization.js'
import {copyJSON, FileExecutionJournal, MemoryExecutionJournal} from './execution/journal.js'
import {isolateLogger} from './execution/observer.js'
import {DEFAULT_RUN_LIMITS, RunExecutionError, RunStoppedError, RunSupervisor, until} from './execution/run.js'
import {
  FileSessionLogStore,
  LogEventType,
  LogOutcome,
  runWithLogContext,
  StoreSessionLoggerFactory,
} from './logs/index.js'
import {createMcpToolManager} from './mcp.js'
import {getModel, Message, MessageType} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {prepareSessionContext} from './session/context-policy.js'
import {SessionContextBuilder, TurnPhase} from './session/index.js'
import {loadWorkspaceSettingsSync, mergeWorkspaceSettings} from './settings.js'
import {State} from './state.js'
import {adaptInvokableTool, createBuiltinTools, ToolProfile, ToolRegistry, ToolRuntime} from './tools/index.js'

const DEFAULT_MAX_TOOL_ITERATIONS = 5

export type AgentTool = InvokableTool

export interface AgentInvokeOptions extends OperatorOptions {
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  limits?: Partial<RunLimits>

  maxToolIterations?: number
  onEvent?: AgentEventHandler
  onRunSnapshot?: (snapshot: RunSnapshot) => void
  requestId?: string
  signal?: AbortSignal
  tools?: AgentTool[]
  turnId?: string
}

interface ManagedInvokeOptions extends AgentInvokeOptions {
  contextPolicy?: ContextPolicy
  executionContext?: RunContext
  executionPolicy?: ExecutionPolicy
  mcp?: McpToolManager
}

export interface AgentOptions {
  contextPolicy?: ContextPolicy
  cwd?: string

  defaultToolProfile?: ToolProfileName
  deps?: {
    createMcpToolManager?: (settings: WorkspaceSettings, options: McpToolManagerFactoryOptions) => McpToolManager
    createModel?: typeof getModel
    sessionContextBuilder?: SessionContextBuilderType
  }
  diagnostics?: DiagnosticEventBus
  execution?: {
    allowLegacyTools?: boolean
    journalFactory?: (session: Session) => Promise<ExecutionJournal>
    journalLevel?: Exclude<JournalLevel, 'memory'>
    journalRoot?: string
    limits?: Partial<RunLimits>
    onApproval?: (request: ApprovalRequest) => Promise<void> | void
    policy?: ExecutionPolicy
    responderScope?: string
  }
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
  public readonly contextPolicy: ContextPolicy
  public readonly logger: Logger
  public readonly messages: Message[]
  public readonly settings: WorkspaceSettings
  public readonly state: State
  readonly supervisor = new RunSupervisor()
  public readonly tools: AgentTool[]
  private closePromise?: Promise<void>
  private readonly cwd: string
  private readonly diagnostics?: DiagnosticEventBus
  private readonly execution: NonNullable<AgentOptions['execution']>
  private readonly journals = new Map<string, Promise<ExecutionJournal>>()
  private readonly mcpFactory: NonNullable<NonNullable<AgentOptions['deps']>['createMcpToolManager']>
  private readonly model: Model
  private observerFailures = 0
  private readonly ownedLogStore?: SessionLogStore
  private readonly sessionContextBuilder: SessionContextBuilderType
  private readonly toolDefinitions: ToolDefinition[]

  // Model, session, diagnostics, and tool profile dependencies are resolved at one construction boundary.
  // eslint-disable-next-line complexity
  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.settings = mergeWorkspaceSettings(loadWorkspaceSettingsSync(options.cwd), options.settings)
    this.contextPolicy = options.contextPolicy ?? this.settings.contextPolicy ?? {mode: 'disabled'}
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
      this.logger = isolateLogger(options.logger, () => {
        this.observerFailures++
      }).child({component: 'agent'})
    }

    this.toolDefinitions = [
      ...createBuiltinTools({
        ...this.settings.tools,
        profile: options.toolProfile ?? this.settings.tools?.profile ?? options.defaultToolProfile ?? ToolProfile.None,
      }),
      ...(options.toolDefinitions ?? []),
    ]
    this.tools = [...(options.tools ?? [])]
    this.execution = options.execution ?? {}
    this.mcpFactory =
      options.deps?.createMcpToolManager ??
      ((settings, factoryOptions) => createMcpToolManager(settings.mcp, factoryOptions))
    this.diagnostics?.emit({
      data: {
        cwd: this.cwd,
        model: this.model.getModel(),
        provider: this.model.getProvider(),
      },
      sessionId: this.state.getSession().getId(),
      type: 'model.selected',
    })
    if (this.diagnostics === undefined) {
      this.logger.info(
        {
          eventType: LogEventType.SessionCreated,
          model: this.model.getModel(),
          outcome: LogOutcome.Succeeded,
          provider: this.model.getProvider(),
        },
        'agent session started',
      )
    }
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      const deadline = performance.now() + (this.execution.limits?.cleanupMs ?? DEFAULT_RUN_LIMITS.cleanupMs)
      const report = await this.supervisor.close(deadline)
      const closeStores = async () => {
        const outcomes = await Promise.allSettled([
          ...[...this.journals.values()].map(async (journal) => (await journal).close()),
          this.ownedLogStore?.close(),
        ])
        if (outcomes.some((outcome) => outcome.status === 'rejected'))
          throw new Error('Execution store close failed; inspect recording health')
      }

      if (report.incomplete) {
        this.supervisor
          .whenQuiescent()
          .then(closeStores)
          .catch(() => {})
        throw Object.assign(
          new Error(
            `Agent close incomplete; execution resources remain owned; ${report.results.map((result) => new RunExecutionError(result).message).join('; ')}`,
          ),
          {report},
        )
      }

      try {
        await until(closeStores(), deadline)
      } catch (error) {
        throw Object.assign(new Error('Agent store close failed or remains incomplete', {cause: error}), {report})
      }
    })()
    return this.closePromise
  }

  getModel(): Model {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Agent, suffix)
  }

  getObserverFailureCount(): number {
    return this.observerFailures
  }

  getRun(id: string): RunSnapshot | undefined {
    return this.supervisor.getRun(id)
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

  replyApproval(id: string, reply: ApprovalReply): Promise<'recorded'> {
    return this.supervisor.replyApproval(id, reply)
  }

  /** Runs one turn from new input and derives prior model context from the supplied session. */
  async run(session: Session, messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message> {
    return this.invokeSession(session, messages, options)
  }

  async startRun(
    messages: Message[],
    options: Partial<AgentInvokeOptions> = {},
    session = this.getSession(),
  ): Promise<RunHandle<Message>> {
    options = {...options, tools: options.tools ? [...options.tools] : undefined}
    messages = messages.map(
      (message) =>
        new Message(message.type, {
          contents: copyJSON(message.contents),
          id: message.id,
          role: message.role,
          timestamp: message.timestamp,
          ...(message.payload === undefined ? {} : {payload: copyJSON(message.payload)}),
        }),
    )
    let manager: McpToolManager | undefined
    const policy = this.execution.policy ?? {
      generation: 'workspace-confirm-v1',
      profile: 'workspace-confirm' as const,
      roots: [this.cwd],
    }
    const frozenPolicy = Object.freeze({...policy, roots: Object.freeze([...policy.roots])})
    const contextPolicy: ContextPolicy =
      this.contextPolicy.mode === 'budgeted'
        ? {...this.contextPolicy, profile: copyJSON(this.contextPolicy.profile)}
        : {mode: 'disabled'}
    const contextConfiguration =
      contextPolicy.mode === 'budgeted'
        ? {mode: contextPolicy.mode, profile: contextPolicy.profile}
        : {mode: contextPolicy.mode}
    // Estimators are injected behavior, not JSON settings or journal evidence.
    const settings = copyJSON({...this.settings, contextPolicy: contextConfiguration})
    const serialized = messages.map((message) => ({
      contents: message.contents,
      role: message.role,
      type: message.type,
      ...(message.payload === undefined ? {} : {payload: message.payload}),
    }))
    return this.supervisor.startRun<Message>({
      async cleanup() {
        await manager?.close()
      },
      configuration: {
        contextPolicy: contextConfiguration,
        cwd: this.cwd,
        model: this.model.getModel(),
        policy: {generation: policy.generation, profile: policy.profile, roots: [...policy.roots]},
        provider: this.model.getProvider(),
        sources: this.settings.mcp ?? {},
      },
      execute: async (run) => {
        manager = this.mcpFactory(settings, {
          cwd: this.cwd,
          diagnosticContext: {runId: run.id, sessionId: session.getId()},
          diagnostics: this.diagnostics,
          execution: {policy: frozenPolicy, run},
        })
        return runWithLogContext(
          {runId: run.id, sessionId: session.getId(), threadId: session.getId(), turnId: run.id},
          () =>
            this.invokeSessionWithTurn(session, messages, run.id, {
              ...options,
              contextPolicy,
              executionContext: run,
              executionPolicy: frozenPolicy,
              mcp: manager,
              signal: run.signal,
            }),
        )
      },
      input: {
        limits: options.limits ?? {},
        maxToolIterations: options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
        messages: serialized,
        tools: (options.tools ?? []).map((tool) => ({
          name: tool.name,
          schema:
            tool.inputSchema ??
            adaptInvokableTool(tool, tool.source ?? {id: tool.name, kind: 'custom'}).spec.inputSchema,
        })),
      },
      journal: () => this.getJournal(session),
      limits: {...this.execution.limits, ...options.limits},
      onApproval: this.execution.onApproval,
      onSnapshot: options.onRunSnapshot,
      requestId: options.requestId ?? options.turnId ?? uuidv7(),
      responderScope: this.execution.responderScope,
      runId: options.turnId,
      sessionId: session.getId(),
      signal: options.signal,
      synchronize: async () => session.synchronize((await this.getJournal(session)).level),
    })
  }

  // eslint-disable-next-line max-params
  private emitTurnTerminal(
    diagnostics: DiagnosticEventBus | undefined,
    session: Session,
    turnId: string,
    eventType: string,
    outcome: LogOutcome,
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = performance.now() - startedAt
    const event = diagnostics?.emit({
      data: {
        durationMs,
        ...(error === undefined ? {} : {error: error instanceof Error ? error.message : String(error)}),
      },
      level: outcome === LogOutcome.Failed ? 'error' : 'warn',
      runId: turnId,
      sessionId: session.getId(),
      threadId: session.getId(),
      turnId,
      type: eventType,
    })
    if (event === undefined) {
      this.logger[outcome === LogOutcome.Failed ? 'error' : 'warn'](
        {
          durationMs,
          ...(error === undefined ? {} : {error: error instanceof Error ? error.message : String(error)}),
          eventType,
          outcome,
        },
        eventType,
      )
    }
  }

  private getJournal(session: Session): Promise<ExecutionJournal> {
    if (
      session.journalRoot &&
      this.execution.journalRoot &&
      path.resolve(session.journalRoot) !== path.resolve(this.execution.journalRoot)
    )
      throw new Error(
        'Configure persistent journal roots on SessionRepository so deletion and recovery share the same location',
      )
    let pending = this.journals.get(session.getId())
    if (!pending) {
      pending = this.execution.journalFactory
        ? this.execution.journalFactory(session)
        : session.getFile()
          ? FileExecutionJournal.open(session.getId(), {
              lease: session.acquireWriterLease(),
              level: this.execution.journalLevel,
              root:
                this.execution.journalRoot ??
                session.journalRoot ??
                path.join(path.dirname(session.getFile()!), 'runs'),
            }).then(async (journal) => {
              try {
                await session.synchronize(journal.level)
                return journal
              } catch (error) {
                await journal.close()
                throw error
              }
            })
          : Promise.resolve(new MemoryExecutionJournal(session.getId(), session.acquireManagedLease()))
      this.journals.set(session.getId(), pending)
      pending.catch(() => {
        this.journals.delete(session.getId())
      })
    }

    return pending
  }

  // Session recording, tool iteration, and terminal-state handling intentionally share one lifecycle boundary.

  private async invokeSession(
    session: Session,
    messages: Message[],
    options?: Partial<AgentInvokeOptions>,
  ): Promise<Message> {
    const handle = await this.startRun(messages, options, session).catch((error) => {
      if (error instanceof RunStoppedError && options?.signal?.aborted)
        throw new ModelAbortError('Agent cancelled before admission', {cause: error})
      throw error
    })
    const result = await handle.finished
    const value = handle.value()
    if (result.outcome === 'completed' && value) return value
    if (result.outcome === 'cancelled') {
      const error = new ModelAbortError('Agent invocation aborted.')
      Object.assign(error, {result})
      throw error
    }

    throw new RunExecutionError(result)
  }

  // eslint-disable-next-line complexity
  private async invokeSessionWithTurn(
    session: Session,
    messages: Message[],
    turnId: string,
    options?: Partial<ManagedInvokeOptions>,
  ): Promise<Message> {
    const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
    if (!Number.isSafeInteger(maxToolIterations) || maxToolIterations < 0) throw new Error('Invalid maxToolIterations')
    const run = options!.executionContext!
    const policy = options!.executionPolicy!
    const managed = {allowLegacyTools: this.execution.allowLegacyTools, policy}
    const diagnostics = options?.diagnostics ?? this.diagnostics
    const turnStartedAt = performance.now()
    let terminalRecorded = false
    const recordTerminal = (phase: 'cancelled' | 'completed' | 'failed', error?: SessionError) => {
      if (terminalRecorded) return
      terminalRecorded = true
      session.recordTurnEvent({phase, turnId, ...(error === undefined ? {} : {error})})
    }

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
      const turnStarted = diagnostics?.emit({
        data: {messageCount: messages.length},
        level: 'info',
        runId: turnId,
        sessionId: session.getId(),
        threadId: session.getId(),
        turnId,
        type: LogEventType.TurnStarted,
      })
      if (turnStarted === undefined) {
        this.logger.info(
          {eventType: LogEventType.TurnStarted, messageCount: messages.length, outcome: LogOutcome.Started},
          'agent turn started',
        )
      }

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
      const mcpTools = await run.wait('mcp-discovery', options!.mcp!.getTools())
      throwIfAborted(options?.signal)
      const tools = [...this.tools, ...mcpTools, ...(options?.tools ?? [])]
      const registry = new ToolRegistry()
      for (const definition of this.toolDefinitions) {
        assertManagedTool(definition, managed)
        registry.register(definition)
      }

      for (const [index, availableTool] of tools.entries()) {
        registry.register(
          adaptInvokableTool(availableTool, availableTool.source ?? {id: `agent:${index}`, kind: 'custom'}),
        )
      }

      const toolSnapshot = registry.snapshot()
      for (const spec of toolSnapshot.specs()) assertManagedTool(toolSnapshot.get(spec.name)!, managed)
      await run.ready(toolSnapshot.specs())
      const toolRuntime = new ToolRuntime(
        toolSnapshot,
        (definition, input, context) => executeManagedTool(run, definition, input, context, managed),
        async () => {
          const id = uuidv7()
          run.operations.push({id, status: 'invalid'})
          await run.record('operation-result', {operationId: id, status: 'invalid'})
        },
      )
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
                turnId,
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
        const modelStartedAt = performance.now()
        if (diagnostics === undefined) {
          this.logger.info(
            {
              eventType: LogEventType.ModelRequestStarted,
              iteration,
              messageCount: context.messages.length,
              model: this.model.getModel(),
              outcome: LogOutcome.Started,
              provider: this.model.getProvider(),
              toolCount: toolSnapshot.specs().length,
            },
            'model request started',
          )
        }

        let modelMessage: Message
        try {
          // Tool loops are sequential because each model response depends on the previous tool results.

          const prepared =
            options?.contextPolicy?.mode === 'budgeted'
              ? // Context preparation is sequential because it uses this iteration history.
                // eslint-disable-next-line no-await-in-loop
                await prepareSessionContext({
                  model: this.model,
                  modelOptions: iterationOptions,
                  onEvent: (event) =>
                    emitAgentEvent(options?.onEvent, {iteration, type: AgentEventType.ContextPrepared, ...event}),
                  policy: options.contextPolicy,
                  prefix: this.messages,
                  run,
                  session,
                })
              : undefined
          run.consume('modelCalls')
          // The next model iteration depends on these results.
          // eslint-disable-next-line no-await-in-loop
          modelMessage = await run.wait(
            'model',
            prepared ? prepared.invoke() : this.model.invoke([...this.messages, ...context.messages], iterationOptions),
          )
        } catch (error) {
          if (diagnostics === undefined) {
            this.logger.error(
              {
                durationMs: performance.now() - modelStartedAt,
                error: error instanceof Error ? error.message : String(error),
                eventType: LogEventType.ModelRequestFailed,
                iteration,
                model: this.model.getModel(),
                outcome: LogOutcome.Failed,
                provider: this.model.getProvider(),
              },
              'model request failed',
            )
          }

          throw error
        }

        throwIfAborted(options?.signal)
        const [storedModelMessage] = session.appendMessages([modelMessage], {iteration, turnId})
        emitAgentEvent(options?.onEvent, {
          iteration,
          message: storedModelMessage,
          type: AgentEventType.MessageCompleted,
        })
        this.logger.debug({iteration, role: modelMessage.role}, 'agent model iteration completed')
        if (diagnostics === undefined) {
          const response = modelResponseMetadata(modelMessage)
          this.logger.info(
            {
              durationMs: response?.durationMs ?? performance.now() - modelStartedAt,
              eventType: LogEventType.ModelRequestCompleted,
              iteration,
              model: response?.model ?? this.model.getModel(),
              outcome: LogOutcome.Succeeded,
              provider: response?.provider ?? this.model.getProvider(),
              ...(response?.responseId === undefined ? {} : {requestId: response.responseId}),
              ...(response?.usage === undefined ? {} : {usage: {...response.usage}}),
            },
            'model request completed',
          )
        }

        const toolCalls = getToolCalls(storedModelMessage)
        run.consume('toolRequests', toolCalls.length)
        this.logger.debug({iteration, toolCallCount: toolCalls.length}, 'agent tool calls received')
        if (toolCalls.length === 0) {
          recordTerminal(TurnPhase.Completed)
          // The terminal flush belongs to this iteration and must finish before returning the response.
          // eslint-disable-next-line no-await-in-loop
          await session.flush()
          const turnCompleted = diagnostics?.emit({
            data: {durationMs: performance.now() - turnStartedAt, iteration},
            level: 'info',
            runId: turnId,
            sessionId: session.getId(),
            threadId: session.getId(),
            turnId,
            type: LogEventType.TurnCompleted,
          })
          if (turnCompleted === undefined) {
            this.logger.info(
              {
                durationMs: performance.now() - turnStartedAt,
                eventType: LogEventType.TurnCompleted,
                iteration,
                outcome: LogOutcome.Succeeded,
              },
              'agent turn completed',
            )
          }

          return storedModelMessage
        }

        if (iteration === maxToolIterations) {
          this.logger.debug({maxToolIterations, toolCallCount: toolCalls.length}, 'agent max tool iterations exceeded')
          run.requestStop('budget-exceeded')
          run.check()
        }

        // Tool execution for one model turn can run in parallel before the next model call.
        const signal = options?.signal ?? new AbortController().signal

        const callIds = new Set<string>()
        for (const call of toolCalls) {
          if (typeof call.id !== 'string' || call.id.length === 0 || callIds.has(call.id))
            throw new InvalidInputError('Tool call IDs must be unique within a model response')
          callIds.add(call.id)
        }

        run.consume('toolRounds')
        // The next model iteration depends on these results.
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
            iteration,
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
        recordTerminal(TurnPhase.Cancelled)
        await session.flush()
        this.emitTurnTerminal(
          diagnostics,
          session,
          turnId,
          LogEventType.TurnCancelled,
          LogOutcome.Cancelled,
          turnStartedAt,
        )
        throw abortError
      }

      if (error instanceof ModelAbortError) {
        recordTerminal(TurnPhase.Cancelled)
        await session.flush()
        this.emitTurnTerminal(
          diagnostics,
          session,
          turnId,
          LogEventType.TurnCancelled,
          LogOutcome.Cancelled,
          turnStartedAt,
        )
        throw error
      }

      recordTerminal(TurnPhase.Failed, serializeSessionError(error))
      await session.flush()
      this.emitTurnTerminal(
        diagnostics,
        session,
        turnId,
        LogEventType.TurnFailed,
        LogOutcome.Failed,
        turnStartedAt,
        error,
      )
      throw error
    }
  }

  // Tool execution, error projection, and diagnostics share one lifecycle boundary.
  // eslint-disable-next-line complexity
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
      turnId: options?.turnId ?? options?.diagnosticContext?.turnId,
    }
    const started = diagnostics?.emit({
      ...diagnosticContext,
      data: {name: toolCall.name, toolCallId: toolCall.id},
      fullData: {input: toolCall.input},
      level: 'info',
      type: 'tool.started',
    })
    if (started === undefined) {
      this.logger.info(
        {
          eventType: LogEventType.ToolCallStarted,
          iteration,
          name: toolCall.name,
          outcome: LogOutcome.Started,
          toolCallId: toolCall.id,
        },
        'tool call started',
      )
    }

    const startedAt = performance.now()
    let execution: ToolExecutionResult
    try {
      execution = await runWithLogContext({iteration, toolCallId: toolCall.id}, execute)
    } catch (error) {
      const failed = diagnostics?.emit({
        ...diagnosticContext,
        data: {
          durationMs: performance.now() - startedAt,
          error: String(error),
          name: toolCall.name,
          toolCallId: toolCall.id,
        },
        level: 'error',
        type: 'tool.completed',
      })
      if (failed === undefined) {
        this.logger.error(
          {
            durationMs: performance.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            eventType: LogEventType.ToolCallFailed,
            iteration,
            name: toolCall.name,
            outcome: LogOutcome.Failed,
            toolCallId: toolCall.id,
          },
          'tool call failed',
        )
      }

      throw error
    }

    throwIfAborted(options?.signal)
    const isError = execution.result.isError === true
    const completed = diagnostics?.emit({
      ...diagnosticContext,
      data: {durationMs: performance.now() - startedAt, isError, name: toolCall.name, toolCallId: toolCall.id},
      fullData: {input: toolCall.input, output: execution.result},
      level: isError ? 'error' : 'info',
      type: 'tool.completed',
    })
    if (completed === undefined) {
      this.logger[isError ? 'error' : 'info'](
        {
          durationMs: performance.now() - startedAt,
          eventType: isError ? LogEventType.ToolCallFailed : LogEventType.ToolCallCompleted,
          iteration,
          name: toolCall.name,
          outcome: isError ? LogOutcome.Failed : LogOutcome.Succeeded,
          toolCallId: toolCall.id,
        },
        isError ? 'tool call failed' : 'tool call completed',
      )
    }

    return execution
  }
}

function emitAgentEvent(handler: AgentEventHandler | undefined, event: AgentEvent): void {
  try {
    Promise.resolve(handler?.(event)).catch(() => {})
  } catch {
    /* Observers do not own execution. */
  }
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

function modelResponseMetadata(message: Message): ModelResponseMetadata | undefined {
  const {payload} = message
  if (typeof payload !== 'object' || payload === null || !('response' in payload)) return undefined
  const {response} = payload
  if (typeof response !== 'object' || response === null) return undefined
  return response as ModelResponseMetadata
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
  delete result.contextPolicy
  delete result.executionPolicy
  delete result.executionContext
  delete result.mcp
  delete result.requestId
  delete result.limits
  delete result.onRunSnapshot
  delete result.onEvent
  delete result.tools
  delete result.turnId
  return result as Partial<ModelInvokeOptions>
}
