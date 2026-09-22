// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
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
import type {ProjectStore} from './projects/types.js'
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
import {parseProjectContext, type ProjectMemorySelection} from './projects/memory-context.js'
import {ProjectMemoryService} from './projects/memory-service.js'
import {ProjectService} from './projects/service.js'
import {ProjectStoreError} from './projects/types.js'
import {WorkflowSelectionService} from './selection/service.js'
import {parseSessionFile} from './session/codec.js'
import {SessionRepository as Repository, SessionDeletionService} from './session/index.js'
import {loadWorkspaceSettingsWithSources} from './settings.js'
import {SkillCatalog} from './skills/index.js'
import {State} from './state.js'
import {serializeMessage, ThreadEventType, ThreadManager} from './thread.js'
import {ToolProfile} from './tools/index.js'
import {LocalWorkspaceLocator} from './workspace.js'

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
  projectStore?: ProjectStore
  provider?: ProviderName
  repository?: SessionRepository
  resolveProjectRuntime?: (cwd: string) => Promise<CoreAgentOptions>
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
  readonly projectMemory?: ProjectMemoryService
  readonly projects?: ProjectService
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
  private readonly projectCreations = new Map<string, {projectId: string; promise: Promise<ThreadSnapshot>}>()
  private readonly resolveProjectRuntime: (cwd: string) => Promise<CoreAgentOptions>
  private readonly runListeners = new Set<(snapshot: RunSnapshot) => void>()
  private readonly selectedScopes = new Map<string, string>()
  private readonly settings: WorkspaceSettings
  private readonly systemPrompt?: string
  private readonly threadManager: ThreadManager
  private readonly threadRuntime = new Map<string, CoreAgentOptions>()

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
            contextPolicy: agentOptions.contextPolicy ?? agentOptions.settings?.contextPolicy ?? {mode: 'disabled'},
            defaultToolProfile: ToolProfile.Coding,
            diagnostics: this.diagnostics,
            execution: {...options.execution, ...agentOptions.execution, onApproval() {}, responderScope: 'local-gui'},
            projectMemory: this.projectMemory,
            selectionProjector: options.selectionProjector,
            skillCatalog: agentOptions.skillCatalog,
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
    this.resolveProjectRuntime =
      options.resolveProjectRuntime ??
      (async (cwd) => {
        const loaded = await loadWorkspaceSettingsWithSources(cwd)
        const contexts = await loadSystemContexts(cwd)
        const resolved = resolveAgentOptions(
          {
            model:
              loaded.settings.model ??
              (loaded.settings.provider && loaded.settings.provider !== this.runtime.provider
                ? undefined
                : this.runtime.model),
            provider: loaded.settings.provider ?? this.runtime.provider,
          },
          loaded.settings,
        )
        const workspace = (await new LocalWorkspaceLocator({start: cwd}).directories()).at(-1)
        const content = contexts.map((item) => item.content).join('\n\n')
        return {
          contextPolicy: resolved.settings.contextPolicy,
          cwd,
          diagnostics: this.diagnostics,
          execution: options.execution,
          messages: content ? [new Message(MessageType.Session, {content, role: Role.System})] : [],
          model: {name: resolved.model, provider: resolved.provider},
          settings: resolved.settings,
          skillCatalog: workspace
            ? new SkillCatalog([{directory: path.join(workspace, '.orbit', 'skills'), id: 'workspace'}])
            : undefined,
        }
      })
    if (options.projectStore) {
      const host = {
        closeThread: async (id: string) => {
          await this.threadManager.closeThread(id)
          await this.threadRuntime.get(id)?.skillCatalog?.settle()
          this.threadRuntime.delete(id)
        },
        getThread: (id: string) => this.threadManager.getThread(id),
      }
      this.projects = new ProjectService(options.projectStore, this.repository, host, options.cwd)
      this.projectMemory = new ProjectMemoryService(this.projects, host)
    }

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
      await Promise.allSettled([...this.projectCreations.values()].map((item) => item.promise))
      await this.threadManager.close()
      await Promise.all([...this.threadRuntime.values()].map((runtime) => runtime.skillCatalog?.settle()))
      await this.projectMemory?.close()
      await this.projects?.store.close()
      await this.skillCatalog?.settle()
      this.displayMessages.clear()
      this.detachDiagnosticLogger()
      if (this.ownsLogs) await this.logs.close()
    })()
    return this.closePromise
  }

  async createProjectThread(projectId: string, options: {operationId: string}): Promise<ThreadSnapshot> {
    if (this.closePromise) throw new Error('Application is closing')
    if (!this.projects) throw new ProjectStoreError('missing', 'Project catalog is not configured')
    const pending = this.projectCreations.get(options.operationId)
    if (pending) {
      if (pending.projectId !== projectId) throw new ProjectStoreError('conflict', 'Project creation operation changed')
      return pending.promise
    }

    const promise = this.createOwnedProjectThread(projectId, options.operationId)
    this.projectCreations.set(options.operationId, {projectId, promise})
    try {
      return await promise
    } finally {
      this.projectCreations.delete(options.operationId)
    }
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
        projectMemory: this.projectMemory,
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
    await this.projects?.markDeleting(sessionId)
    const deleted = await this.deletionService.delete(sessionId)
    await this.projects?.finishDeletion(sessionId)
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

  async listSkills(signal?: AbortSignal, threadId?: string) {
    const catalog = threadId ? this.catalogForThread(threadId) : this.skillCatalog
    return catalog ? catalog.list(signal) : {candidates: [], complete: true, issues: ['No Skill catalog configured']}
  }

  async previewProjectMemory(threadId: string, selection: ProjectMemorySelection) {
    if (!this.projectMemory) throw new ProjectStoreError('missing', 'Project memory is not configured')
    if (!this.threadManager.getThread(threadId)) await this.resumeSession(threadId)
    const runtime = this.threadRuntime.get(threadId)
    return this.projectMemory.prepare(threadId, randomUUID(), selection, {
      capture: false,
      contextPolicy: runtime?.contextPolicy ?? runtime?.settings?.contextPolicy ?? this.settings.contextPolicy,
    })
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

  async projectContextHistory(sessionId: string) {
    const summary = await this.repository.findById(sessionId)
    if (!summary) throw new ProjectStoreError('missing', 'Session not found')
    const inspection = await inspectExecutionJournal(this.repository.journalRoot, sessionId).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {runs: []}
      throw error
    })
    return inspection.runs.map((run) => ({
      issue: run.issue,
      preparationInterrupted:
        run.records[0]?.version === 3 && !run.records.some((record) => record.kind === 'project-context'),
      runId: run.runId,
      snapshots: run.records
        .filter((record) => record.kind === 'project-context')
        .map((record) => parseProjectContext(record.data.snapshot)),
    }))
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
    const runtime = this.projects
      ? await this.resolveProjectRuntime(summary.cwd)
      : {settings: this.settings, skillCatalog: this.skillCatalog}
    let thread: ThreadSnapshot
    try {
      thread = this.threadManager.resumeThread(summary.file, {
        agent: {
          ...runtime,
          diagnostics: this.diagnostics,
          messages: undefined,
          model: undefined,
          projectMemory: this.projectMemory,
        },
      })
      if (this.projects) this.threadRuntime.set(thread.id, runtime)
    } catch (error) {
      if (this.projects) await runtime.skillCatalog?.settle()
      throw error
    }

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
    request?: string | {memory?: ProjectMemorySelection; requestId?: string; skills?: SkillSelection[]},
  ): Promise<StartApplicationRunResult> {
    if (this.selectedScopes.has(threadId)) throw new Error('Thread requires its workflow selection coordinator')
    const {memory, requestId, skills} =
      typeof request === 'string' ? {memory: undefined, requestId: request, skills: undefined} : (request ?? {})
    if (this.projects && !this.threadManager.getThread(threadId)) await this.resumeSession(threadId)
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

    await this.projects?.requireActive(threadId)
    const handle = this.threadManager.startRun(threadId, content, {
      memory,
      requestId,
      skillCatalogRevision: this.catalogForThread(threadId)?.configuration,
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

  private catalogForThread(threadId: string): SkillCatalog | undefined {
    return this.threadRuntime.has(threadId) ? this.threadRuntime.get(threadId)?.skillCatalog : this.skillCatalog
  }

  private async createOwnedProjectThread(projectId: string, operationId: string): Promise<ThreadSnapshot> {
    const loaded = this.getThread(operationId)
    if (loaded) {
      const reservation = await this.projects!.store.query({id: operationId, kind: 'reservation'})
      if (reservation?.projectId !== projectId || reservation.state !== 'committed')
        throw new ProjectStoreError('conflict', 'Project creation operation changed')
      return loaded
    }

    let runtime: CoreAgentOptions | undefined
    const session = await this.projects!.createSession(projectId, operationId, async (cwd) => {
      runtime = await this.resolveProjectRuntime(cwd)
      return {
        formatVersion:
          (runtime.interruptionPolicy ?? runtime.settings?.interruptionPolicy)?.mode === 'verified-not-dispatched'
            ? 3
            : runtime.skillCatalog || runtime.contextPolicy?.mode === 'budgeted'
              ? 2
              : 1,
        model: runtime.model?.name,
        originator: 'orbit-project',
        provider: runtime.model?.provider,
        systemPrompt: runtime.messages?.map((message) => message.content).join('\n\n'),
      }
    }).catch(async (error: unknown) => {
      await runtime?.skillCatalog?.settle()
      throw error
    })
    try {
      const metadata = session.getMetadata()
      const agent = {
        ...runtime!,
        cwd: metadata.cwd,
        diagnostics: this.diagnostics,
        messages: undefined,
        model: {name: metadata.model, provider: metadata.provider},
        projectMemory: this.projectMemory,
        state: new State(session),
      }
      const thread = this.threadManager.createThread({agent, id: session.getId()})
      this.threadRuntime.set(thread.id, agent)
      this.diagnostics.emit({data: {projectId, revision: 1}, sessionId: thread.id, type: 'project.changed'})
      return thread
    } catch (error) {
      await session.close()
      await runtime?.skillCatalog?.settle()
      throw error
    }
  }

  private async dispatchSelectedGraph(
    threadId: string,
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: ThreadRunOptions,
  ) {
    await this.projects?.requireActive(threadId)
    const handle = this.threadManager.startGraphRun(threadId, graph, input, {
      ...options,
      skillCatalogRevision: this.catalogForThread(threadId)?.configuration,
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
