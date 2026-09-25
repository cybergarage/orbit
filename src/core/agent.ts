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
import type {ExecutionLimit} from './execution/limits.js'
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
import type {CompiledProcessorGraph, GraphJSON} from './processor/graph-definition.js'
import type {GraphInvocation, GraphSnapshot, GraphValue} from './processor/graph-execution.js'
import type {Operator, OperatorOptions} from './processor/index.js'
import type {ProjectMemoryService} from './projects/memory-service.js'
import type {WorkflowContextProjector, WorkflowExpectation, WorkflowSubmission} from './selection/binding.js'
import type {ContextPolicy} from './session/context-policy.js'
import type {SessionContextBuilder as SessionContextBuilderType, SessionError} from './session/index.js'
import type {InterruptionPolicy} from './session/verified-context.js'
import type {WorkspaceSettings} from './settings.js'
import type {SkillCatalog, SkillSelection, SkillSnapshot} from './skills/index.js'
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
import {executionLimitValue, isExecutionLimit, parseRunLimits} from './execution/limits.js'
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
import {boundedGraphJSON, graphBinding} from './processor/graph-definition.js'
import {
  bindGraphJournal,
  executeProcessorGraph,
  graphHandle,
  graphSynchronize,
  validateGraphCatalog,
} from './processor/graph-execution.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {
  parseMemorySelection,
  parseProjectContext,
  type ProjectContextSnapshot,
  type ProjectMemorySelection,
} from './projects/memory-context.js'
import {encodeWorkflowSubmission, parseWorkflowSubmission} from './selection/binding.js'
import {immutable, selectionDigest} from './selection/validation.js'
import {budgetToolResults, continueBudgetRun} from './session/budget-continuation.js'
import {prepareSessionContext} from './session/context-policy.js'
import {Session, SessionContextBuilder, TurnPhase} from './session/index.js'
import {
  parseInterruptionPolicy,
  preflightInterruptedContext,
  prepareInterruptedContext,
  reverifyInterruptedContext,
} from './session/verified-context.js'
import {loadWorkspaceSettingsSync, mergeWorkspaceSettings} from './settings.js'
import {normalizeSkillSelections} from './skills/index.js'
import {skillPrefix} from './skills/record.js'
import {State} from './state.js'
import {adaptInvokableTool, createBuiltinTools, ToolProfile, ToolRegistry, ToolRuntime} from './tools/index.js'

export type AgentTool = InvokableTool

export interface AgentInvokeOptions extends OperatorOptions {
  continueFromRunId?: string
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  limits?: Partial<RunLimits>
  maxToolIterations?: ExecutionLimit
  memory?: ProjectMemorySelection

  onEvent?: AgentEventHandler
  onRunAdmitted?: () => void
  onRunSnapshot?: (snapshot: RunSnapshot) => void
  requestId?: string
  selection?: WorkflowSubmission
  signal?: AbortSignal
  skills?: SkillSelection[]
  tools?: AgentTool[]
  turnId?: string
}

interface ManagedInvokeOptions extends AgentInvokeOptions {
  activeSkills?: SkillSnapshot[]
  contextPolicy?: ContextPolicy
  executionContext?: RunContext
  executionPolicy?: ExecutionPolicy
  graph?: GraphInvocation
  mcp?: McpToolManager
  projectContext?: ProjectContextSnapshot
  skillReader?: SkillCatalog
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
  interruptionPolicy?: InterruptionPolicy

  logger?: Logger
  logStore?: SessionLogStore
  messages?: Message[]
  model?: {
    name?: string
    provider?: ProviderName
  }
  plugins?: import('./plugins/index.js').LoadedPlugins
  projectMemory?: ProjectMemoryService
  selectionProjector?: WorkflowContextProjector
  settings?: WorkspaceSettings
  skillCatalog?: SkillCatalog
  state?: State
  toolDefinitions?: ToolDefinition[]
  toolProfile?: ToolProfileName
  tools?: AgentTool[]
}

export class Agent implements Operator<Message[], Message, AgentInvokeOptions> {
  public readonly contextPolicy: ContextPolicy
  public readonly interruptionPolicy: InterruptionPolicy
  public readonly logger: Logger
  public readonly messages: Message[]
  public readonly plugins?: import('./plugins/index.js').LoadedPlugins
  public readonly settings: WorkspaceSettings
  public readonly skillCatalog?: SkillCatalog
  public readonly state: State
  readonly supervisor = new RunSupervisor()
  public readonly tools: AgentTool[]
  private closePromise?: Promise<void>
  private readonly cwd: string
  private readonly diagnostics?: DiagnosticEventBus
  private readonly execution: NonNullable<AgentOptions['execution']>
  private readonly graphHandles = new Map<string, RunHandle<GraphValue>>()
  private readonly graphSnapshots = new Map<string, GraphSnapshot>()
  private readonly journals = new Map<string, Promise<ExecutionJournal>>()
  private readonly mcpFactory: NonNullable<NonNullable<AgentOptions['deps']>['createMcpToolManager']>
  private readonly model: Model
  private observerFailures = 0
  private readonly ownedLogStore?: SessionLogStore
  private readonly projectMemory?: ProjectMemoryService
  private readonly selectionProjector?: WorkflowContextProjector
  private readonly sessionContextBuilder: SessionContextBuilderType
  private readonly toolDefinitions: ToolDefinition[]

  // Model, session, diagnostics, and tool profile dependencies are resolved at one construction boundary.
  // eslint-disable-next-line complexity
  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.plugins = options.plugins
    this.skillCatalog = options.plugins?.skillCatalog ?? options.skillCatalog
    this.projectMemory = options.projectMemory
    this.settings = mergeWorkspaceSettings(loadWorkspaceSettingsSync(options.cwd), options.settings)
    if (this.plugins) {
      const {servers} = this.plugins.inspection
      for (const name of Object.keys(servers))
        if (Object.hasOwn(this.settings.mcp?.servers ?? {}, name))
          throw new Error('Plugin and native MCP server identity conflict')
      this.settings.mcp = {servers: {...this.settings.mcp?.servers, ...servers}}
    }

    this.interruptionPolicy = Object.freeze(
      parseInterruptionPolicy(options.interruptionPolicy ?? this.settings.interruptionPolicy ?? {mode: 'disabled'}),
    )
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
    this.state =
      options.state ??
      new State(
        this.interruptionPolicy.mode === 'verified-not-dispatched' ? new Session({formatVersion: 3}) : undefined,
      )
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
    this.execution = {...options.execution, limits: {...this.settings.executionLimits, ...options.execution?.limits}}
    this.selectionProjector = options.selectionProjector ? Object.freeze({...options.selectionProjector}) : undefined
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

  bindGraph(graph: CompiledProcessorGraph) {
    graphBinding(graph, graph.descriptor.entry)
    return {
      getGraphSnapshot: (runId: string) => this.getGraphSnapshot(runId),
      startRun: (input: GraphJSON, options: Partial<AgentInvokeOptions> = {}) =>
        this.startGraphRun(graph, input, options),
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

  getExecutionLimits(): RunLimits {
    return {...DEFAULT_RUN_LIMITS, ...this.execution.limits}
  }

  getGraphSnapshot(runId: string): GraphSnapshot | undefined {
    const snapshot = this.graphSnapshots.get(runId)
    return snapshot ? copyJSON(snapshot) : undefined
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

  /** Pure preview on an already-created Agent. Never discovers tools or reads Skills. */
  previewGraphSubmission(
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: Partial<AgentInvokeOptions>,
    expectation: WorkflowExpectation,
  ): string {
    input = boundedGraphJSON(input, graph.profile.valueBytes)
    const messages = [
      new Message(MessageType.User, {content: typeof input === 'string' ? input : JSON.stringify(input)}),
    ]
    return encodeWorkflowSubmission(this.managedSubmission(messages, options, {graph, input}), expectation)
  }

  replyApproval(id: string, reply: ApprovalReply): Promise<'recorded'> {
    return this.supervisor.replyApproval(id, reply)
  }

  /** Runs one turn from new input and derives prior model context from the supplied session. */
  async run(session: Session, messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message> {
    return this.invokeSession(session, messages, options)
  }

  async startGraphRun(
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: Partial<AgentInvokeOptions> = {},
    session = this.getSession(),
  ): Promise<RunHandle<GraphValue>> {
    graphBinding(graph, graph.descriptor.entry)
    if (![2, 3].includes(session.formatVersion)) throw new Error('Graph requires explicit transcript v2 migration')
    input = boundedGraphJSON(input, graph.profile.valueBytes)
    const invocation: GraphInvocation = {
      graph,
      input,
      observe: (snapshot) => this.graphSnapshots.set(snapshot.runId, snapshot),
    }
    const handle = await this.startManagedRun<GraphValue>(
      [new Message(MessageType.User, {content: typeof input === 'string' ? input : JSON.stringify(input)})],
      options,
      session,
      invocation,
    )
    let wrapped = this.graphHandles.get(handle.id)
    if (!wrapped) {
      wrapped = graphHandle(handle)
      this.graphHandles.set(handle.id, wrapped)
    }

    if (!this.graphSnapshots.has(handle.id) && handle.getSnapshot().result?.recording.status === 'recovered') {
      const records = (await this.getJournal(session)).records().filter((record) => record.runId === handle.id)
      const bound = records.find((record) => record.kind === 'graph-bound')
      const starts = records.filter((record) => record.kind === 'graph-node-started')
      const last = [...records].reverse().find((record) => record.kind === 'graph-node-completed')
      this.graphSnapshots.set(handle.id, {
        graph: String(bound?.data.graph ?? graph.identity),
        recovered: true,
        runId: handle.id,
        visits: starts.length,
        ...(last ? {outputDigest: String(last.data.outputDigest)} : {}),
      })
    }

    return wrapped
  }

  async startRun(
    messages: Message[],
    options: Partial<AgentInvokeOptions> = {},
    session = this.getSession(),
  ): Promise<RunHandle<Message>> {
    return this.startManagedRun<Message>(messages, options, session)
  }

  workflowContext(): string {
    return selectionDigest(this.workflowDeclaration())
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
    try {
      options?.onRunAdmitted?.()
    } catch {
      /* Admission observers cannot alter execution. */
    }

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
  ): Promise<GraphValue | Message> {
    const graph = options?.graph
    const maxToolIterations = options?.maxToolIterations ?? options!.executionContext!.limits.toolRounds
    if (!isExecutionLimit(maxToolIterations)) throw new Error('Invalid maxToolIterations')
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
      if (options?.skills?.length) {
        if (![2, 3].includes(session.formatVersion))
          throw new Error('Skill selection requires explicit transcript v2 migration')
        const activeSkills = await options.executionContext!.wait(
          'skill-resolution',
          options.skillReader!.resolve(options.skills, options.signal),
        )
        options.executionContext!.check()
        const snapshot = {
          id: uuidv7(),
          sessionId: session.getId(),
          skills: activeSkills,
          timestamp: new Date().toISOString(),
          turnId,
          type: 'skill_context' as const,
          version: 1 as const,
        }
        try {
          await options.executionContext!.wait(
            'skill-save',
            session.commitSkills(snapshot, options.executionContext!.journal.level),
          )
        } catch (error) {
          // A stop can win the caller wait while the owned append/sync is still
          // completing. Keep it pending for late settlement; only an actual
          // persistence rejection marks recording as failed.
          if (!(error instanceof RunStoppedError)) {
            options.executionContext!.recordingFailed = true
            options.executionContext!.requestStop('recording-failed')
          }

          throw error
        }

        options.executionContext!.check()
        options = {...options, activeSkills}
        options.executionContext!.setSkillResolution(snapshot.id, activeSkills)
      }

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
      // Diagnostic counts do not acquire model-input authority.
      const sessionMessageCount =
        this.interruptionPolicy.mode === 'verified-not-dispatched'
          ? session.getConversationMessages().length
          : this.sessionContextBuilder.build(session).messages.length
      this.logger.debug(
        {
          initialMessageCount: this.messages.length,
          newMessageCount: messages.length,
          sessionMessageCount,
        },
        'agent invoke started',
      )
      const mcpTools = await run.wait('mcp-discovery', options!.mcp!.getTools())
      if (run.operations.some((operation) => operation.status === 'unknown')) {
        run.requestStop('unknown-operation')
        throw new Error('Plugin startup has an unknown outcome; execution requires reconciliation')
      }

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
      if (graph) validateGraphCatalog(graph.graph, toolSnapshot)
      if (options?.selection) {
        run.check()
        const snapshot = immutable({
          catalog: copyJSON(toolSnapshot.specs()),
          declaration: this.workflowDeclaration(),
          skills: copyJSON(options.activeSkills ?? []),
        })
        const prepared = selectionDigest(this.selectionProjector!.project(snapshot))
        run.check()
        if (prepared !== options.selection.expectation.prepared) throw new Error('Selected prepared context mismatch')
      }

      await run.ready(toolSnapshot.specs(), graph ? await graphSynchronize(run, session) : undefined)
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

      let graphIteration = 0
      const runAgentStage = async (stageMax = maxToolIterations): Promise<Message> => {
        for (let localIteration = 0; localIteration <= executionLimitValue(stageMax); localIteration += 1) {
          const iteration = graph ? graphIteration++ : localIteration
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
          // Verification is sequential and precedes every ordinary provider preparation.

          const verifiedContext =
            this.interruptionPolicy.mode === 'verified-not-dispatched'
              ? // Sequential evidence verification precedes this iteration's preparation.
                // eslint-disable-next-line no-await-in-loop
                await prepareInterruptedContext(session, run, this.interruptionPolicy)
              : undefined
          const context = verifiedContext ?? this.sessionContextBuilder.build(session)
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
                    verifiedContext,
                    ...(verifiedContext ? {reverify: () => reverifyInterruptedContext(session, run)} : {}),
                    model: this.model,
                    modelOptions: iterationOptions,
                    onEvent: (event) =>
                      emitAgentEvent(options?.onEvent, {iteration, type: AgentEventType.ContextPrepared, ...event}),
                    policy: options.contextPolicy,
                    prefix: [
                      ...this.messages,
                      ...projectContextPrefix(options?.projectContext),
                      ...skillPrefix(options?.activeSkills ?? []).map(
                        (content) => new Message(MessageType.User, {content}),
                      ),
                    ],
                    run,
                    session,
                  })
                : verifiedContext
                  ? this.model.prepare!(
                      [
                        ...this.messages,
                        ...projectContextPrefix(options?.projectContext),
                        ...skillPrefix(options?.activeSkills ?? []).map(
                          (content) => new Message(MessageType.User, {content}),
                        ),
                        ...verifiedContext.messages,
                      ],
                      iterationOptions,
                    )
                  : undefined
            // Recheck retained proof after summaries and immediately before ordinary dispatch.
            // eslint-disable-next-line no-await-in-loop
            if (verifiedContext) await reverifyInterruptedContext(session, run)
            run.consume('modelCalls')
            // The next model iteration depends on these results.
            // eslint-disable-next-line no-await-in-loop
            modelMessage = await run.wait(
              'model',
              prepared
                ? prepared.invoke()
                : this.model.invoke(
                    [
                      ...this.messages,
                      ...projectContextPrefix(options?.projectContext),
                      ...skillPrefix(options?.activeSkills ?? []).map(
                        (content) => new Message(MessageType.User, {content}),
                      ),
                      ...context.messages,
                    ],
                    iterationOptions,
                  ),
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
          const callIds = new Set<string>()
          for (const call of toolCalls) {
            if (typeof call.id !== 'string' || call.id.length === 0 || callIds.has(call.id))
              throw new InvalidInputError('Tool call IDs must be unique within a model response')
            callIds.add(call.id)
          }

          const reserveTools = () => {
            run.consume('toolRequests', toolCalls.length)
            if (toolCalls.length === 0) return
            if (stageMax !== 'unlimited' && localIteration === stageMax) {
              run.exhaust('toolRounds', localIteration, 1, stageMax)
              run.check()
            }

            run.consume('toolRounds')
          }

          try {
            reserveTools()
          } catch (error) {
            if (run.stopReason === 'budget-exceeded' && toolCalls.length > 0) {
              const notices = session.appendMessages(budgetToolResults(toolCalls), {iteration, turnId})
              for (const message of notices)
                emitAgentEvent(options?.onEvent, {iteration, message, type: AgentEventType.MessageCompleted})
            }

            throw error
          }

          this.logger.debug({iteration, toolCallCount: toolCalls.length}, 'agent tool calls received')
          if (toolCalls.length === 0) {
            if (!graph) {
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
            }

            return storedModelMessage
          }

          // Tool execution for one model turn can run in parallel before the next model call.
          const signal = options?.signal ?? new AbortController().signal

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

        throw new Error(`Agent exceeded maximum tool iterations: ${stageMax}`)
      }

      if (!graph) return await runAgentStage()
      const value = await executeProcessorGraph(graph, run, session, {
        async agent(input, configuration) {
          const config = configuration as null | {instruction?: string; maxToolIterations?: ExecutionLimit}
          const stageMax = config?.maxToolIterations ?? maxToolIterations
          if (!isExecutionLimit(stageMax) || executionLimitValue(stageMax) > executionLimitValue(maxToolIterations))
            throw new Error('Invalid graph Agent iteration limit')
          if (
            graphIteration > 0 ||
            graph.graph.descriptor.nodes.find((node) => node.id === graph.graph.descriptor.entry)?.kind !== 'agent' ||
            config?.instruction !== undefined
          )
            session.appendMessages(
              [
                new Message(MessageType.User, {
                  content: [config?.instruction, typeof input === 'string' ? input : JSON.stringify(input)]
                    .filter((value) => value !== undefined)
                    .join('\n'),
                }),
              ],
              {turnId},
            )
          await run.wait('graph-step-input', session.flush())
          const message = await runAgentStage(stageMax)
          return {
            contents: copyJSON(message.contents),
            role: message.role,
            type: message.type,
            ...(message.payload === undefined ? {} : {payload: copyJSON(message.payload)}),
          } as GraphJSON
        },
        tool: async (name, input) => {
          const definition = toolSnapshot.get(name)!
          const before = run.operations.length
          const result = await executeManagedTool(
            run,
            definition,
            input,
            {callId: uuidv7(), cwd: this.cwd, emitUpdate() {}, signal: run.signal},
            managed,
          )
          if (
            run.operations
              .slice(before)
              .some((operation) => ['cancelled-before-start', 'denied', 'invalid'].includes(operation.status))
          )
            throw new Error('Graph tool was not admitted')
          return copyJSON(result) as unknown as GraphJSON
        },
      })
      recordTerminal(TurnPhase.Completed)
      await session.flush()
      this.emitTurnTerminal(
        diagnostics,
        session,
        turnId,
        LogEventType.TurnCompleted,
        LogOutcome.Succeeded,
        turnStartedAt,
      )
      return value
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

  private managedSubmission(
    messages: Message[],
    options: Partial<AgentInvokeOptions>,
    graph?: Pick<GraphInvocation, 'graph' | 'input'>,
  ): unknown {
    const skills = normalizeSkillSelections(options.skills)
    const serialized = messages.map((message) => ({
      contents: message.contents,
      role: message.role,
      type: message.type,
      ...(message.payload === undefined ? {} : {payload: message.payload}),
    }))
    return {
      ...(graph
        ? {
            graph: graph.graph.identity,
            graphConfiguration: graph.graph.configuration,
            graphInput: graph.input,
            graphProfile: graph.graph.profile,
          }
        : {}),
      ...(skills.length > 0 ? {skillCatalog: this.skillCatalog?.configuration, skills} : {}),
      ...(options.memory ? {memory: parseMemorySelection(options.memory)} : {}),
      ...(this.interruptionPolicy.mode === 'verified-not-dispatched'
        ? {interruptionPolicy: this.interruptionPolicy}
        : {}),
      ...(options.continueFromRunId ? {continueFromRunId: options.continueFromRunId} : {}),
      limits: options.limits ?? {},
      maxToolIterations: options.maxToolIterations ?? null,
      messages: serialized,
      tools: (options.tools ?? []).map((tool) => ({
        name: tool.name,
        ...(graph
          ? {description: tool.description, scheduling: tool.scheduling ?? 'serial', source: tool.source ?? null}
          : {}),
        schema:
          tool.inputSchema ?? adaptInvokableTool(tool, tool.source ?? {id: tool.name, kind: 'custom'}).spec.inputSchema,
      })),
    }
  }

  // Session recording, tool iteration, and terminal-state handling intentionally share one lifecycle boundary.

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

  private async startManagedRun<T>(
    messages: Message[],
    options: Partial<AgentInvokeOptions>,
    session: Session,
    graph?: GraphInvocation,
  ): Promise<RunHandle<T>> {
    const skills = normalizeSkillSelections(options.skills)
    if (skills.length > 0 && !this.skillCatalog) throw new Error('Skill catalog is not configured')
    if (options.continueFromRunId !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,160}$/u.test(options.continueFromRunId)) throw new Error('Invalid continuation run ID')
      if (graph || options.selection) throw new Error('Budget continuation requires an ordinary unselected Agent run')
    }

    options = {
      ...options,
      ...(options.limits === undefined ? {} : {limits: parseRunLimits(options.limits)}),
      skills,
      tools: options.tools ? [...options.tools] : undefined,
    }
    if (graph && options.tools)
      options.tools = options.tools.map((tool) =>
        Object.freeze({
          description: tool.description,
          getName: tool.getName.bind(tool),
          inputSchema: tool.inputSchema ? copyJSON(tool.inputSchema) : undefined,
          invoke: tool.invoke.bind(tool),
          name: tool.name,
          scheduling: tool.scheduling,
          schema: tool.schema,
          source: tool.source ? copyJSON(tool.source) : undefined,
        }),
      )
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
    const memory = options.memory ? parseMemorySelection(options.memory) : undefined
    if (memory?.mode === 'curated' && !this.projectMemory) throw new Error('Project memory service is not configured')
    const requestId = options.requestId ?? options.turnId ?? uuidv7()
    let evidenceJournal: ExecutionJournal | undefined
    let manager: McpToolManager | undefined
    let skillReader = graph ? undefined : this.skillCatalog?.createReader()
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
    if (options.selection) {
      options = {...options, selection: parseWorkflowSubmission(options.selection)}
      if (!graph) throw new Error('Selection requires Graph execution')
      const expected = encodeWorkflowSubmission(
        this.managedSubmission(messages, options, graph),
        options.selection!.expectation,
      )
      if (expected !== options.selection!.input) throw new Error('Selected submission mismatch')
    }

    return this.supervisor.startRun<T>({
      async cleanup() {
        const results = await Promise.allSettled([
          manager?.close(),
          skillReader?.settle(),
          session.settleContextEvidence(),
          evidenceJournal?.settleContextEvidence?.(),
        ])
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('Managed resource cleanup remains unconfirmed')
      },
      configuration: {
        contextPolicy: contextConfiguration,
        ...(this.interruptionPolicy.mode === 'verified-not-dispatched'
          ? {interruptionPolicy: this.interruptionPolicy}
          : {}),
        cwd: this.cwd,
        model: this.model.getModel(),
        policy: {generation: policy.generation, profile: policy.profile, roots: [...policy.roots]},
        provider: this.model.getProvider(),
        skillCatalog: this.skillCatalog?.configuration ?? null,
        sources: this.settings.mcp ?? {},
      },
      execute: async (run) => {
        evidenceJournal = run.journal
        if (options.continueFromRunId) {
          if (graph) throw new Error('Budget continuation is only supported for ordinary Agent runs')
          await continueBudgetRun(session, run, options.continueFromRunId)
        }

        if (this.plugins) await run.wait('plugin-validation', this.plugins.validate())
        if (this.interruptionPolicy.mode === 'verified-not-dispatched' && !this.model.prepare)
          throw new Error('model-does-not-support-verified-context')
        await preflightInterruptedContext(session, run, this.interruptionPolicy)
        const projectContext =
          memory?.mode === 'curated'
            ? parseProjectContext(
                run.journal.records().find((record) => record.runId === run.id && record.kind === 'project-context')
                  ?.data.snapshot,
              )
            : undefined
        run.check()
        if (options.selection) {
          const e = options.selection.expectation
          if (
            !this.selectionProjector ||
            this.selectionProjector.id !== e.projector ||
            this.workflowContext() !== e.context
          )
            throw new Error('Selected declared context mismatch')
        }

        if (graph) {
          await bindGraphJournal(graph, run)
          run.check()
          // Check locally known capabilities before managed MCP discovery.
          const known = new ToolRegistry()
          for (const definition of this.toolDefinitions) known.register(definition)
          for (const [index, tool] of [...this.tools, ...(options.tools ?? [])].entries())
            known.register(adaptInvokableTool(tool, tool.source ?? {id: `agent:${index}`, kind: 'custom'}))
          validateGraphCatalog(graph.graph, known.snapshot(), true)
          skillReader = this.skillCatalog?.createReader()
        }

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
              ...(graph ? {graph} : {}),
              contextPolicy,
              executionContext: run,
              executionPolicy: frozenPolicy,
              mcp: manager,
              projectContext,
              signal: run.signal,
              skillReader,
            }) as Promise<T>,
        )
      },
      input: options.selection ? JSON.parse(options.selection.input) : this.managedSubmission(messages, options, graph),
      journal: () => this.getJournal(session),
      ...(graph ? {journalVersion: 2 as const} : {}),
      limits: parseRunLimits({...this.execution.limits, ...options.limits}),
      onApproval: this.execution.onApproval,
      onSnapshot: options.onRunSnapshot,
      requestedSkills: skills,
      ...(memory?.mode === 'curated'
        ? {
            prepareProjectContext: (signal: AbortSignal) =>
              this.projectMemory!.prepare(session.getId(), requestId, memory, {
                contextPolicy,
                execution: graph ? 'graph' : 'agent',
                signal,
              }),
          }
        : {}),
      requestId,
      responderScope: this.execution.responderScope,
      runId: options.turnId,
      sessionId: session.getId(),
      signal: options.signal,
      synchronize: async () => session.synchronize((await this.getJournal(session)).level),
    })
  }

  private workflowDeclaration(): unknown {
    return copyJSON({
      allowLegacyTools: this.execution.allowLegacyTools ?? false,
      cwd: this.cwd,
      legacyTools: this.tools.map((t) => ({
        description: t.description,
        name: t.name,
        spec: 'spec' in t ? t.spec : null,
      })),
      limits: this.execution.limits ?? {},
      messages: this.messages.map((m) => ({contents: m.contents, role: m.role})),
      model: this.model.getModel(),
      policy: this.execution.policy ?? {
        generation: 'workspace-confirm-v1',
        profile: 'workspace-confirm',
        roots: [this.cwd],
      },
      projector: this.selectionProjector?.id ?? null,
      provider: this.model.getProvider(),
      settings: {
        ...this.settings,
        ...(this.interruptionPolicy.mode === 'verified-not-dispatched'
          ? {interruptionPolicy: this.interruptionPolicy}
          : {}),
        contextPolicy:
          this.contextPolicy.mode === 'budgeted'
            ? {mode: 'budgeted', profile: this.contextPolicy.profile}
            : {mode: 'disabled'},
      },
      skillCatalog: this.skillCatalog?.configuration ?? null,
      tools: this.toolDefinitions.map((t) => t.spec),
    })
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
  delete result.memory
  delete result.projectContext
  delete result.graph
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

function projectContextPrefix(snapshot: ProjectContextSnapshot | undefined): Message[] {
  return snapshot ? [new Message(MessageType.User, {content: snapshot.rendered})] : []
}
