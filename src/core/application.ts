// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type {AgentOptions as CoreAgentOptions} from './agent.js'
import type {Context} from './context.js'
import type {DiagnosticCapture, DiagnosticEvent, DiagnosticEventBus} from './diagnostics/index.js'
import type {ApprovalReply, RunSnapshot} from './execution/run.js'
import type {Logger, LogLevel} from './logger/index.js'
import type {LogPage, LogQuery, LogRecord, LogStoreHealth, SessionLoggerFactory, SessionLogStore} from './logs/index.js'
import type {ProviderName} from './models/index.js'
import type {CompiledProcessorGraph, GraphJSON, GraphValue} from './processor/index.js'
import type {WorkflowExpectation} from './selection/binding.js'
import type {WorkflowAuthority} from './selection/service.js'
import type {WorkflowStore} from './selection/store.js'
import type {SessionListOptions, SessionListResult, SessionRepository, SessionSummary} from './session/index.js'
import type {WorkspaceSettings, WorkspaceSettingsSource} from './settings.js'
import type {SkillSelection} from './skills/index.js'
import type {
  ThreadAgentFactory,
  ThreadEvent,
  ThreadMessage,
  ThreadRunHandle,
  ThreadRunOptions,
  ThreadSnapshot,
} from './thread.js'

import {Agent} from './agent.js'
import {sessionsDir} from './app.js'
import {resolveAgentOptions} from './chat.js'
import {loadSystemContexts} from './context.js'
import {
  attachDiagnosticLogger,
  DiagnosticCapture as Capture,
  DiagnosticEventBus as EventBus,
} from './diagnostics/index.js'
import {inspectExecutionJournal} from './execution/recovery.js'
import {recoveredRunSnapshot} from './execution/run.js'
import {createCompositeLogger} from './logger/index.js'
import {FileSessionLogStore, LogEventType, LogOutcome, StoreSessionLoggerFactory} from './logs/index.js'
import {Message, MessageType, Role} from './models/index.js'
import {inspectGraphRun} from './processor/graph-inspection.js'
import {WorkflowSelectionService} from './selection/service.js'
import {parseSessionFile} from './session/codec.js'
import {SessionRepository as Repository, SessionDeletionService} from './session/index.js'
import {loadWorkspaceSettingsWithSources} from './settings.js'
import {SkillCatalog} from './skills/index.js'
import {serializeMessage, ThreadEventType, ThreadManager} from './thread.js'
import {ToolProfile} from './tools/index.js'

const guiSlashCommandHelpItems = [
  {command: '/help', description: 'Show GUI slash commands'},
  {command: '/model', description: 'Show the current model'},
  {command: '/debug', description: 'Show debug logging state'},
  {command: '/debug on', description: 'Enable debug logging'},
  {command: '/debug off', description: 'Disable debug logging'},
]

export const guiSlashCommandHelpMessage = [
  'GUI slash commands:',
  ...guiSlashCommandHelpItems.map((item) => `${item.command} - ${item.description}`),
].join('\n')

export interface GuiPreferences {
  debugPanelVisible: boolean
  diagnosticCapture: DiagnosticCapture
}

export interface RuntimeContextSource {
  file?: string
  kind: string
  size: number
}

export interface RuntimeSettingsSource {
  file: string
  mcpServers: string[]
  model?: string
  provider?: ProviderName
  providers: string[]
}

export interface RuntimeSnapshot {
  contextMode?: 'budgeted' | 'disabled'
  contexts: RuntimeContextSource[]
  cwd: string
  model: string
  provider: ProviderName
  sessionRoot: string
  settingsSources: RuntimeSettingsSource[]
  version: string
}

export interface OrbitApplicationServiceOptions {
  contextPolicy?: CoreAgentOptions['contextPolicy']
  contexts?: Context[]
  createAgent?: ThreadAgentFactory
  cwd?: string
  diagnostics?: DiagnosticEventBus
  execution?: CoreAgentOptions['execution']
  logger?: Logger
  logLevel?: LogLevel
  logStore?: SessionLogStore
  model?: string
  provider?: ProviderName
  repository?: SessionRepository
  selectionProjector?: CoreAgentOptions['selectionProjector']
  settings?: WorkspaceSettings
  settingsSources?: WorkspaceSettingsSource[]
  skillCatalog?: SkillCatalog
  version?: string
}

export type StartApplicationRunResult =
  | {kind: 'command'; response: string; runId?: never; threadId: string}
  | {kind: 'run'; runId: string; threadId: string}

export class OrbitApplicationService {
  readonly diagnostics: DiagnosticEventBus
  readonly logs: SessionLogStore
  readonly repository: SessionRepository
  readonly runtime: RuntimeSnapshot
  readonly skillCatalog?: SkillCatalog
  private closePromise?: Promise<void>
  private readonly deletionService: SessionDeletionService
  private readonly detachDiagnosticLogger: () => void
  private readonly displayMessages = new Map<string, ThreadMessage[]>()
  private readonly logger: Logger
  private readonly loggerFactory: SessionLoggerFactory
  private readonly ownsLogs: boolean
  private preferences: GuiPreferences
  private readonly runListeners = new Set<(snapshot: RunSnapshot) => void>()
  private readonly selectedScopes = new Map<string, string>()
  private readonly settings: WorkspaceSettings
  private readonly systemPrompt?: string
  private readonly threadManager: ThreadManager

  constructor(
    options: OrbitApplicationServiceOptions &
      Required<Pick<OrbitApplicationServiceOptions, 'contexts' | 'cwd' | 'settingsSources'>>,
  ) {
    this.skillCatalog = options.skillCatalog
    const resolved = resolveAgentOptions(
      {
        model: options.model,
        provider: options.provider,
        settings: options.settings,
      },
      options.settings,
    )
    this.settings = resolved.settings
    this.ownsLogs = options.logStore === undefined
    this.logs = options.logStore ?? new FileSessionLogStore()
    this.loggerFactory = new StoreSessionLoggerFactory(this.logs, {level: options.logLevel ?? 'info'})
    this.logger = createCompositeLogger([
      this.loggerFactory.forApplication(),
      ...(options.logger === undefined ? [] : [options.logger]),
    ])
    this.diagnostics = options.diagnostics ?? new EventBus({capture: Capture.Metadata})
    this.detachDiagnosticLogger = attachDiagnosticLogger(
      this.diagnostics,
      this.logger.child({component: 'diagnostics'}),
    )
    this.repository = options.repository ?? new Repository()
    this.systemPrompt = options.contexts
      .map((context) => context.content)
      .filter((content) => content.length > 0)
      .join('\n\n')
    const contextPolicy = options.contextPolicy ?? this.settings.contextPolicy
    if (contextPolicy) this.settings.contextPolicy = contextPolicy
    this.runtime = {
      contextMode: contextPolicy?.mode ?? 'disabled',
      contexts: options.contexts.map((context) => ({
        ...(context.source.kind === 'none' ? {} : {file: context.source.file}),
        kind: context.source.kind,
        size: context.content.length,
      })),
      cwd: options.cwd,
      model: resolved.model,
      provider: resolved.provider,
      sessionRoot: this.repository.rootDir ?? sessionsDir(),
      settingsSources: options.settingsSources.map((source) => summarizeSettingsSource(source)),
      version: options.version ?? 'unknown',
    }
    this.preferences = {
      debugPanelVisible: true,
      diagnosticCapture: this.diagnostics.getCapture(),
    }
    this.threadManager = new ThreadManager({
      createAgent:
        options.createAgent ??
        ((agentOptions) =>
          new Agent({
            ...agentOptions,
            contextPolicy,
            defaultToolProfile: ToolProfile.Coding,
            diagnostics: this.diagnostics,
            execution: {...options.execution, onApproval() {}, responderScope: 'local-gui'},
            selectionProjector: options.selectionProjector,
            skillCatalog: this.skillCatalog,
          })),
      loggerFactory: this.loggerFactory,
      onEvent: (event) => this.handleThreadEvent(event),
      onRunSnapshot: (snapshot) => {
        for (const listener of this.runListeners) {
          try {
            Promise.resolve(listener(structuredClone(snapshot))).catch(() => {})
          } catch {
            /* Optional transport observer. */
          }
        }
      },
      sessionRepository: this.repository,
    })
    this.deletionService = new SessionDeletionService(
      this.repository,
      this.logs,
      this.threadManager,
      options.execution?.journalLevel,
    )
    this.emitStartupDiagnostics(options.contexts, options.settingsSources)
  }

  static async create(options: OrbitApplicationServiceOptions = {}): Promise<OrbitApplicationService> {
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const resolvedSettings =
      options.settingsSources === undefined
        ? await loadWorkspaceSettingsWithSources(cwd)
        : {settings: options.settings ?? {}, sources: options.settingsSources}
    const contexts = options.contexts ?? (await loadSystemContexts(cwd))
    return new OrbitApplicationService({
      ...options,
      contexts,
      cwd,
      settings: options.settings ?? resolvedSettings.settings,
      settingsSources: resolvedSettings.sources,
    })
  }

  cancelRun(runId: string): boolean {
    return this.threadManager.cancelRun(runId)
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      await this.threadManager.close()
      await this.skillCatalog?.settle()
      this.displayMessages.clear()
      this.detachDiagnosticLogger()
      if (this.ownsLogs) await this.logs.close()
    })()
    return this.closePromise
  }

  createThread(options: {formatVersion?: 1 | 2 | 3} = {}): ThreadSnapshot {
    const systemMessages =
      this.systemPrompt === undefined || this.systemPrompt.length === 0
        ? undefined
        : [new Message(MessageType.Session, {content: this.systemPrompt, role: Role.System})]
    const thread = this.threadManager.createThread({
      agent: {
        contextPolicy: this.settings.contextPolicy,
        cwd: this.runtime.cwd,
        diagnostics: this.diagnostics,
        messages: systemMessages,
        model: {name: this.runtime.model, provider: this.runtime.provider},
        settings: this.settings,
        skillCatalog: this.skillCatalog,
      },
      formatVersion: options.formatVersion,
    })
    const event = this.diagnostics.emit({
      data: {cwd: this.runtime.cwd, model: this.runtime.model, provider: this.runtime.provider},
      level: 'info',
      sessionId: thread.id,
      threadId: thread.id,
      type: LogEventType.SessionCreated,
    })
    if (event === undefined) {
      this.logger.info(
        {
          cwd: this.runtime.cwd,
          eventType: LogEventType.SessionCreated,
          model: this.runtime.model,
          outcome: LogOutcome.Succeeded,
          provider: this.runtime.provider,
          sessionId: thread.id,
          threadId: thread.id,
        },
        LogEventType.SessionCreated,
      )
    }

    return thread
  }

  /** Host explicitly binds a scope, its authority/store and one existing Thread. */
  createWorkflowSelection(
    threadId: string,
    configuration: {
      authority: WorkflowAuthority
      context: string
      mapping: string
      projector: string
      scope: string
      storage: string
      store: WorkflowStore
    },
  ) {
    if (!this.threadManager.getThread(threadId)) throw new Error('Unknown selected Thread')
    const oldScope = this.selectedScopes.get(threadId)
    if (oldScope && oldScope !== configuration.scope)
      throw new Error('Thread already assigned to another selection scope')
    this.selectedScopes.set(threadId, configuration.scope)
    return new WorkflowSelectionService<ThreadRunHandle<GraphValue>>(
      configuration.scope,
      configuration.store,
      configuration.authority,
      {
        availability: () => ({
          available: this.threadManager.getThread(threadId)?.status === 'idle',
          reason: 'Thread is already running',
        }),
        context: configuration.context,
        encode: (graph, input, skills, expectation) =>
          this.previewSelectedGraph(threadId, graph, input, {skills: skills as SkillSelection[]}, expectation),
        identify: (handle) => handle.id,
        mapping: configuration.mapping,
        projector: configuration.projector,
        session: threadId,
        start: (graph, input, options) =>
          this.dispatchSelectedGraph(threadId, graph, input, {...options, skills: options.skills as SkillSelection[]}),
        storage: configuration.storage,
      },
    )
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = await this.deletionService.delete(sessionId)
    if (deleted === undefined) return false

    this.displayMessages.delete(sessionId)
    this.diagnostics.emit({
      data: {deletedSessionId: sessionId, file: deleted.file},
      type: 'session.deleted',
    })
    return true
  }

  getEvents(afterSequence = 0): DiagnosticEvent[] {
    return this.diagnostics.list(afterSequence)
  }

  getGraphSnapshot(runId: string) {
    return this.threadManager.getGraphSnapshot(runId)
  }

  getLogHealth(): LogStoreHealth {
    return this.logs.getHealth()
  }

  getPreferences(): GuiPreferences {
    this.preferences.diagnosticCapture = this.diagnostics.getCapture()
    return {...this.preferences}
  }

  getRun(id: string): RunSnapshot | undefined {
    return this.threadManager.getRun(id)
  }

  async getSessionLogs(sessionId: string, query: LogQuery = {}): Promise<LogPage | undefined> {
    const known =
      this.threadManager.getThread(sessionId) !== undefined || (await this.findSession(sessionId)) !== undefined
    return known ? this.logs.list(sessionId, query) : undefined
  }

  getThread(threadId: string): ThreadSnapshot | undefined {
    const thread = this.threadManager.getThread(threadId)
    return thread === undefined ? undefined : this.withDisplayMessages(thread)
  }

  async listSessions(options: SessionListOptions = {}): Promise<SessionListResult> {
    return this.repository.listPage(options)
  }

  async listSkills(signal?: AbortSignal) {
    return this.skillCatalog
      ? this.skillCatalog.list(signal)
      : {candidates: [], complete: true, issues: ['No Skill catalog configured']}
  }

  previewSelectedGraph(
    threadId: string,
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: ThreadRunOptions,
    expectation: WorkflowExpectation,
  ): string {
    return this.threadManager.previewSelectedGraph(threadId, graph, input, options, expectation)
  }

  async queryGraphRun(id: string) {
    const root = this.repository.journalRoot
    const children = await fs.readdir(root, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const child of children) {
      if (!child.isDirectory() || child.name === 'deletions') continue
      // eslint-disable-next-line no-await-in-loop
      const inspection = await inspectExecutionJournal(root, child.name)
      const run = inspection.runs.find((item) => item.runId === id)
      if (!run) continue
      const result = inspectGraphRun(run.records)
      if (run.issue || !inspection.keyAvailable) return {...result, issue: run.issue ?? 'Missing journal key'}
      try {
        // eslint-disable-next-line no-await-in-loop
        const summary = await this.repository.findById(child.name)
        if (!summary) return result
        // eslint-disable-next-line no-await-in-loop
        const parsed = parseSessionFile(await fs.readFile(summary.file, 'utf8'), summary.file)
        return inspectGraphRun(run.records, {
          entries: parsed.entries.slice(1),
          formatVersion: parsed.header.version,
          sessionId: parsed.header.id,
        })
      } catch {
        return {...result, issue: 'Transcript unavailable or invalid'}
      }
    }
  }

  async queryRun(id: string): Promise<RunSnapshot | undefined> {
    const live = this.getRun(id)
    if (live) return live
    const root = this.repository.journalRoot
    const children = await fs.readdir(root, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const child of children) {
      if (!child.isDirectory() || child.name === 'deletions') continue
      // Search saved session partitions without acquiring a writer or dispatching work.
      // eslint-disable-next-line no-await-in-loop
      const inspection = await inspectExecutionJournal(root, child.name)
      const run = inspection.runs.find((entry) => entry.runId === id)
      if (!run) continue
      const level = run.records[0]?.data.level === 'file-and-directory-sync' ? 'file-and-directory-sync' : 'file-sync'
      const snapshot = recoveredRunSnapshot(id, child.name, run.records, {level, mode: 'file'})
      if (run.issue || !inspection.keyAvailable) {
        snapshot.quarantined = true
        snapshot.unresolved = [...snapshot.unresolved, run.issue ? 'invalid-journal' : 'missing-key']
        if (snapshot.result) snapshot.result.recording.status = 'failed'
      }

      return snapshot
    }

    return undefined
  }

  replyApproval(id: string, reply: Omit<ApprovalReply, 'responderScope'>): Promise<'recorded'> {
    return this.threadManager.replyApproval(id, {...reply, responderScope: 'local-gui'})
  }

  async resumeSession(sessionId: string): Promise<ThreadSnapshot> {
    const loaded = this.threadManager.getThread(sessionId)
    if (loaded !== undefined) return this.withDisplayMessages(loaded)

    const summary = await this.findSession(sessionId)
    if (summary === undefined) throw new Error(`Unknown session: ${sessionId}`)
    const thread = this.threadManager.resumeThread(summary.file, {
      agent: {
        diagnostics: this.diagnostics,
        settings: this.settings,
        skillCatalog: this.skillCatalog,
      },
    })
    const event = this.diagnostics.emit({
      data: {cwd: summary.cwd, model: summary.model, provider: summary.provider},
      level: 'info',
      sessionId: thread.id,
      threadId: thread.id,
      type: LogEventType.SessionResumed,
    })
    if (event === undefined) {
      this.logger.info(
        {
          cwd: summary.cwd,
          eventType: LogEventType.SessionResumed,
          model: summary.model,
          outcome: LogOutcome.Succeeded,
          provider: summary.provider,
          sessionId: thread.id,
          threadId: thread.id,
        },
        LogEventType.SessionResumed,
      )
    }

    return thread
  }

  async skillHistory(sessionId: string) {
    const summary = await this.repository.findById(sessionId)
    if (!summary) throw new Error('Session not found')
    return parseSessionFile(await fs.readFile(summary.file, 'utf8'), summary.file).entries.filter(
      (entry) => entry.type === 'skill_context',
    )
  }

  async startGraphRun(
    threadId: string,
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: ThreadRunOptions = {},
  ) {
    if (this.selectedScopes.has(threadId)) throw new Error('Thread requires its workflow selection coordinator')
    return this.dispatchSelectedGraph(threadId, graph, input, options)
  }

  async startRun(
    threadId: string,
    content: string,
    request?: string | {requestId?: string; skills?: SkillSelection[]},
  ): Promise<StartApplicationRunResult> {
    if (this.selectedScopes.has(threadId)) throw new Error('Thread requires its workflow selection coordinator')
    const {requestId, skills} = typeof request === 'string' ? {requestId: request, skills: undefined} : (request ?? {})
    if (content.startsWith('/')) {
      const thread = this.threadManager.getThread(threadId)
      if (thread === undefined) throw new Error(`Unknown thread: ${threadId}`)
      const response = this.handleGuiSlashCommand(thread, content)
      this.appendLocalCommandMessages(thread, content, response)
      const event = this.diagnostics.emit({
        data: {
          commandLength: content.length,
          commandName: content.split(/\s+/u)[0],
          responseLength: response.length,
        },
        fullData: {command: content, response},
        level: 'info',
        sessionId: threadId,
        threadId,
        type: 'command.submitted',
      })
      if (event === undefined) {
        this.logger.info(
          {
            commandLength: content.length,
            commandName: content.split(/\s+/u)[0],
            eventType: 'command.submitted',
            responseLength: response.length,
            sessionId: threadId,
            threadId,
          },
          'command.submitted',
        )
      }

      return {kind: 'command', response, threadId}
    }

    const handle = this.threadManager.startRun(threadId, content, {
      requestId,
      skillCatalogRevision: this.skillCatalog?.configuration,
      skills,
    })
    handle.completion.catch(() => {})
    await handle.admitted
    return {kind: 'run', runId: handle.id, threadId: handle.threadId}
  }

  subscribe(handler: (event: DiagnosticEvent) => void): () => void {
    return this.diagnostics.subscribe(handler)
  }

  subscribeLogs(handler: (record: LogRecord) => void): () => void {
    return this.logs.subscribe(handler)
  }

  subscribeRunSnapshots(handler: (snapshot: RunSnapshot) => void): () => void {
    this.runListeners.add(handler)
    return () => this.runListeners.delete(handler)
  }

  updatePreferences(update: Partial<GuiPreferences>): GuiPreferences {
    if (update.diagnosticCapture !== undefined) {
      this.diagnostics.setCapture(update.diagnosticCapture)
      if (update.diagnosticCapture === Capture.Full) {
        this.logger.warn(
          {
            captureDurationMinutes: 15,
            eventType: 'security.full-capture.enabled',
            logDestination:
              this.logs instanceof FileSessionLogStore ? this.logs.rootDir : 'configured session log store',
          },
          'full diagnostic capture enabled temporarily',
        )
      }
    }

    this.preferences = {
      ...this.preferences,
      ...update,
      diagnosticCapture: this.diagnostics.getCapture(),
    }
    return this.getPreferences()
  }

  workflowContext(threadId: string): string {
    return this.threadManager.workflowContext(threadId)
  }

  private appendLocalCommandMessages(thread: ThreadSnapshot, command: string, response: string): void {
    const displayMessages = this.withDisplayMessages(thread).messages
    const commandMessage = new Message(MessageType.User, {
      content: command,
      parentid: displayMessages.at(-1)?.id ?? null,
      role: Role.User,
    })
    const responseMessage = new Message(MessageType.Assistant, {content: response, previousMessage: commandMessage})
    this.displayMessages.set(thread.id, [
      ...displayMessages,
      serializeMessage(commandMessage),
      serializeMessage(responseMessage),
    ])
  }

  private async dispatchSelectedGraph(
    threadId: string,
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: ThreadRunOptions,
  ) {
    const handle = this.threadManager.startGraphRun(threadId, graph, input, {
      ...options,
      skillCatalogRevision: this.skillCatalog?.configuration,
    })
    await handle.admitted
    return handle
  }

  private emitStartupDiagnostics(contexts: Context[], settingsSources: WorkspaceSettingsSource[]): void {
    this.diagnostics.emit({
      data: {
        cwd: this.runtime.cwd,
        model: this.runtime.model,
        provider: this.runtime.provider,
        sessionRoot: this.runtime.sessionRoot,
        version: this.runtime.version,
      },
      level: 'info',
      type: 'app.started',
    })
    for (const source of settingsSources) {
      this.diagnostics.emit({
        data: {...summarizeSettingsSource(source)},
        type: 'settings.source.loaded',
      })
    }

    this.diagnostics.emit({
      data: {model: this.runtime.model, provider: this.runtime.provider},
      type: 'settings.resolved',
    })
    for (const context of contexts) {
      this.diagnostics.emit({
        data: {
          ...(context.source.kind === 'none' ? {} : {file: context.source.file}),
          kind: context.source.kind,
          size: context.content.length,
        },
        fullData: {content: context.content},
        type: 'context.source.loaded',
      })
    }
  }

  private async findSession(sessionId: string): Promise<SessionSummary | undefined> {
    return this.repository.findById(sessionId)
  }

  private handleGuiSlashCommand(thread: ThreadSnapshot, input: string): string {
    const [commandName] = input.split(/\s+/u)
    if (commandName === '/help') return guiSlashCommandHelpMessage
    if (commandName === '/model') {
      if (input !== '/model') return 'Model switching is only available in interactive CLI mode.'
      return `Current model: ${thread.provider ?? this.runtime.provider}:${thread.model ?? this.runtime.model}`
    }

    if (commandName === '/debug') {
      const args = input.split(/\s+/u).slice(1)
      if (args.length === 0) return `Debug logging is ${this.logger.isDebugEnabled() ? 'on' : 'off'}`
      if (args.length === 1 && args[0] === 'on') {
        this.logger.setDebugEnabled(true)
        return 'Debug logging enabled'
      }

      if (args.length === 1 && args[0] === 'off') {
        this.logger.setDebugEnabled(false)
        return 'Debug logging disabled'
      }

      return 'Invalid debug command. Use /debug, /debug on, or /debug off'
    }

    if (commandName === '/exit') return 'The /exit command is only available in interactive CLI mode.'
    return `Unknown command: ${commandName}`
  }

  private handleThreadEvent(event: ThreadEvent): void {
    this.diagnostics.emit({
      data: threadEventMetadata(event),
      fullData: {event},
      ...(event.type === ThreadEventType.RunFailed ? {level: 'error' as const} : {}),
      ...(event.type === ThreadEventType.RunCancelled ? {level: 'warn' as const} : {}),
      ...(event.type === ThreadEventType.RunStarted || event.type === ThreadEventType.RunCompleted
        ? {level: 'info' as const}
        : {}),
      ...eventContext(event),
      type: event.type.replaceAll('-', '.'),
    })
  }

  private withDisplayMessages(thread: ThreadSnapshot): ThreadSnapshot {
    const displayed = this.displayMessages.get(thread.id)
    if (displayed === undefined) return thread

    const displayedIds = new Set(displayed.map((message) => message.id))
    const messages = [...displayed, ...thread.messages.filter((message) => !displayedIds.has(message.id))]
    this.displayMessages.set(thread.id, messages)
    return {
      ...thread,
      messages,
      updatedAt: messages.at(-1)?.timestamp ?? thread.updatedAt,
    }
  }
}

function summarizeSettingsSource(source: WorkspaceSettingsSource): RuntimeSettingsSource {
  return {
    file: source.file,
    mcpServers: Object.keys(source.settings.mcp?.servers ?? {}),
    ...(source.settings.model === undefined ? {} : {model: source.settings.model}),
    ...(source.settings.provider === undefined ? {} : {provider: source.settings.provider}),
    providers: Object.keys(source.settings.providers ?? {}),
  }
}

function eventContext(event: ThreadEvent): {
  iteration?: number
  runId: string
  sessionId: string
  threadId: string
  turnId: string
} {
  return {
    ...('iteration' in event ? {iteration: event.iteration} : {}),
    runId: event.runId,
    sessionId: event.threadId,
    threadId: event.threadId,
    turnId: event.runId,
  }
}

function threadEventMetadata(event: ThreadEvent): Record<string, unknown> {
  if (event.type === ThreadEventType.ContextPrepared)
    return {
      beforeTokens: event.beforeTokens,
      outcome: event.outcome,
      ...(event.afterTokens === undefined ? {} : {afterTokens: event.afterTokens}),
      ...(event.reason === undefined ? {} : {reason: event.reason}),
    }
  if (event.type === ThreadEventType.RunFailed) return {error: event.error}
  if ('message' in event) return {messageId: event.message.id, messageType: event.message.type}
  if ('toolCall' in event) return {toolCallId: event.toolCall.id, toolName: event.toolCall.name}
  return {}
}
