// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import process from 'node:process'

import type {Context} from './context.js'
import type {DiagnosticCapture, DiagnosticEvent, DiagnosticEventBus} from './diagnostics/index.js'
import type {Logger} from './logger/index.js'
import type {ProviderName} from './models/index.js'
import type {SessionListOptions, SessionListResult, SessionRepository, SessionSummary} from './session/index.js'
import type {WorkspaceSettings, WorkspaceSettingsSource} from './settings.js'
import type {ThreadAgentFactory, ThreadEvent, ThreadSnapshot} from './thread.js'

import {Agent} from './agent.js'
import {sessionsDir} from './app.js'
import {resolveAgentOptions} from './chat.js'
import {loadSystemContexts} from './context.js'
import {
  attachDiagnosticLogger,
  DiagnosticCapture as Capture,
  DiagnosticEventBus as EventBus,
} from './diagnostics/index.js'
import {createNoopLogger} from './logger/index.js'
import {Message, MessageType, Role} from './models/index.js'
import {SessionRepository as Repository} from './session/index.js'
import {loadWorkspaceSettingsWithSources} from './settings.js'
import {ThreadEventType, ThreadManager} from './thread.js'

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
  contexts: RuntimeContextSource[]
  cwd: string
  model: string
  provider: ProviderName
  sessionRoot: string
  settingsSources: RuntimeSettingsSource[]
  version: string
}

export interface OrbitApplicationServiceOptions {
  contexts?: Context[]
  createAgent?: ThreadAgentFactory
  cwd?: string
  diagnostics?: DiagnosticEventBus
  logger?: Logger
  model?: string
  provider?: ProviderName
  repository?: SessionRepository
  settings?: WorkspaceSettings
  settingsSources?: WorkspaceSettingsSource[]
  version?: string
}

export interface StartApplicationRunResult {
  runId: string
  threadId: string
}

export class OrbitApplicationService {
  readonly diagnostics: DiagnosticEventBus
  readonly repository: SessionRepository
  readonly runtime: RuntimeSnapshot
  private readonly detachDiagnosticLogger: () => void
  private readonly logger: Logger
  private preferences: GuiPreferences
  private readonly settings: WorkspaceSettings
  private readonly systemPrompt?: string
  private readonly threadManager: ThreadManager

  constructor(
    options: OrbitApplicationServiceOptions &
      Required<Pick<OrbitApplicationServiceOptions, 'contexts' | 'cwd' | 'settingsSources'>>,
  ) {
    const resolved = resolveAgentOptions(
      {
        model: options.model,
        provider: options.provider,
        settings: options.settings,
      },
      options.settings,
    )
    this.settings = resolved.settings
    this.logger = options.logger ?? createNoopLogger()
    this.diagnostics = options.diagnostics ?? new EventBus({capture: Capture.Full})
    this.detachDiagnosticLogger = attachDiagnosticLogger(
      this.diagnostics,
      this.logger.child({component: 'diagnostics'}),
    )
    this.repository = options.repository ?? new Repository()
    this.systemPrompt = options.contexts
      .map((context) => context.content)
      .filter((content) => content.length > 0)
      .join('\n\n')
    this.runtime = {
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
            diagnostics: this.diagnostics,
            logger: this.logger,
          })),
      onEvent: (event) => this.handleThreadEvent(event),
      sessionRepository: this.repository,
    })
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

  async close(): Promise<void> {
    try {
      await this.threadManager.close()
    } finally {
      this.detachDiagnosticLogger()
    }
  }

  createThread(): ThreadSnapshot {
    const systemMessages =
      this.systemPrompt === undefined || this.systemPrompt.length === 0
        ? undefined
        : [new Message(MessageType.Session, {content: this.systemPrompt, role: Role.System})]
    const thread = this.threadManager.createThread({
      agent: {
        cwd: this.runtime.cwd,
        diagnostics: this.diagnostics,
        logger: this.logger,
        messages: systemMessages,
        model: {name: this.runtime.model, provider: this.runtime.provider},
        settings: this.settings,
      },
    })
    this.diagnostics.emit({
      data: {cwd: this.runtime.cwd, model: this.runtime.model, provider: this.runtime.provider},
      sessionId: thread.id,
      threadId: thread.id,
      type: 'session.created',
    })
    return thread
  }

  getEvents(afterSequence = 0): DiagnosticEvent[] {
    return this.diagnostics.list(afterSequence)
  }

  getPreferences(): GuiPreferences {
    return {...this.preferences}
  }

  getThread(threadId: string): ThreadSnapshot | undefined {
    return this.threadManager.getThread(threadId)
  }

  async listSessions(options: SessionListOptions = {}): Promise<SessionListResult> {
    return this.repository.listPage(options)
  }

  async resumeSession(sessionId: string): Promise<ThreadSnapshot> {
    const loaded = this.threadManager.getThread(sessionId)
    if (loaded !== undefined) return loaded

    const summary = await this.findSession(sessionId)
    if (summary === undefined) throw new Error(`Unknown session: ${sessionId}`)
    const thread = this.threadManager.resumeThread(summary.file, {
      agent: {
        diagnostics: this.diagnostics,
        logger: this.logger,
        settings: this.settings,
      },
    })
    this.diagnostics.emit({
      data: {cwd: summary.cwd, model: summary.model, provider: summary.provider},
      sessionId: thread.id,
      threadId: thread.id,
      type: 'session.resumed',
    })
    return thread
  }

  startRun(threadId: string, content: string): StartApplicationRunResult {
    const handle = this.threadManager.startRun(threadId, content)
    handle.completion.catch(() => {})
    return {runId: handle.id, threadId: handle.threadId}
  }

  subscribe(handler: (event: DiagnosticEvent) => void): () => void {
    return this.diagnostics.subscribe(handler)
  }

  updatePreferences(update: Partial<GuiPreferences>): GuiPreferences {
    if (update.diagnosticCapture !== undefined) this.diagnostics.setCapture(update.diagnosticCapture)
    this.preferences = {
      ...this.preferences,
      ...update,
      diagnosticCapture: update.diagnosticCapture ?? this.diagnostics.getCapture(),
    }
    return this.getPreferences()
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
    let cursor: string | undefined
    do {
      // Pages are sequential because the next cursor is returned by the previous page.
      // eslint-disable-next-line no-await-in-loop
      const page = await this.repository.listPage({cursor, limit: 200})
      const summary = page.data.find((item) => item.id === sessionId)
      if (summary !== undefined) return summary
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  private handleThreadEvent(event: ThreadEvent): void {
    this.diagnostics.emit({
      data: threadEventMetadata(event),
      fullData: {event},
      ...(event.type === ThreadEventType.RunFailed ? {level: 'error' as const} : {}),
      ...(event.type === ThreadEventType.RunCancelled ? {level: 'warn' as const} : {}),
      ...eventContext(event),
      type: event.type.replaceAll('-', '.'),
    })
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

function eventContext(event: ThreadEvent): {iteration?: number; runId: string; sessionId: string; threadId: string} {
  return {
    ...('iteration' in event ? {iteration: event.iteration} : {}),
    runId: event.runId,
    sessionId: event.threadId,
    threadId: event.threadId,
  }
}

function threadEventMetadata(event: ThreadEvent): Record<string, unknown> {
  if (event.type === ThreadEventType.RunFailed) return {error: event.error}
  if ('message' in event) return {messageId: event.message.id, messageType: event.message.type}
  if ('toolCall' in event) return {toolCallId: event.toolCall.id, toolName: event.toolCall.name}
  return {}
}
