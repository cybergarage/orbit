// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import type {AgentEvent} from './agent-events.js'
import type {AgentInvokeOptions, AgentOptions} from './agent.js'
import type {ApprovalReply, RunHandle, RunSnapshot} from './execution/run.js'
import type {SessionLoggerFactory} from './logs/index.js'
import type {Message, MessagePayload, MessageType} from './message/index.js'
import type {ModelToolCall, ProviderName, Role} from './models/index.js'
import type {ContextPreparationEvent} from './session/context-policy.js'
import type {ToolResult} from './tools/index.js'

import {AgentEventType} from './agent-events.js'
import {Agent} from './agent.js'
import {InvalidInputError, ModelAbortError, OrbitError} from './errors/index.js'
import {RunExecutionError} from './execution/run.js'
import {Message as CoreMessage, MessageType as CoreMessageType} from './message/index.js'
import {Session, type SessionRepository} from './session/index.js'
import {State} from './state.js'

export const ThreadStatus = {
  Idle: 'idle',
  Running: 'running',
} as const

export type ThreadStatus = (typeof ThreadStatus)[keyof typeof ThreadStatus]

export const ThreadEventType = {
  ContextPrepared: AgentEventType.ContextPrepared,
  MessageCompleted: AgentEventType.MessageCompleted,
  ModelStarted: AgentEventType.ModelStarted,
  RunCancelled: 'run-cancelled',
  RunCompleted: 'run-completed',
  RunFailed: 'run-failed',
  RunStarted: 'run-started',
  ToolCompleted: AgentEventType.ToolCompleted,
  ToolStarted: AgentEventType.ToolStarted,
  ToolUpdated: AgentEventType.ToolUpdated,
} as const

export type ThreadEventType = (typeof ThreadEventType)[keyof typeof ThreadEventType]

export interface ThreadMessage {
  content: string
  contents: string[]
  id: string
  parentid: null | string
  payload?: MessagePayload
  role: Role
  timestamp: string
  type: MessageType
}

export interface ThreadSnapshot {
  createdAt: string
  cwd: string
  file?: string
  id: string
  messages: ThreadMessage[]
  model?: string
  provider?: ProviderName
  run?: RunSnapshot
  status: ThreadStatus
  updatedAt: string
}

interface ThreadEventBase {
  runId: string
  threadId: string
  timestamp: string
  type: ThreadEventType
}

export interface ThreadRunStartedEvent extends ThreadEventBase {
  message: ThreadMessage
  type: typeof ThreadEventType.RunStarted
}

export interface ThreadModelStartedEvent extends ThreadEventBase {
  iteration: number
  type: typeof ThreadEventType.ModelStarted
}

export interface ThreadMessageCompletedEvent extends ThreadEventBase {
  iteration: number
  message: ThreadMessage
  type: typeof ThreadEventType.MessageCompleted
}

export interface ThreadToolStartedEvent extends ThreadEventBase {
  iteration: number
  toolCall: ModelToolCall
  type: typeof ThreadEventType.ToolStarted
}

export interface ThreadToolCompletedEvent extends ThreadEventBase {
  iteration: number
  message: ThreadMessage
  toolCall: ModelToolCall
  type: typeof ThreadEventType.ToolCompleted
}

export interface ThreadToolUpdatedEvent extends ThreadEventBase {
  iteration: number
  toolCall: ModelToolCall
  type: typeof ThreadEventType.ToolUpdated
  update: ToolResult
}

export interface ThreadRunCompletedEvent extends ThreadEventBase {
  message: ThreadMessage
  type: typeof ThreadEventType.RunCompleted
}

export interface ThreadRunCancelledEvent extends ThreadEventBase {
  type: typeof ThreadEventType.RunCancelled
}

export interface ThreadError {
  code?: string
  message: string
  name: string
}

export interface ThreadRunFailedEvent extends ThreadEventBase {
  error: ThreadError
  type: typeof ThreadEventType.RunFailed
}

export type ThreadEvent =
  | (ContextPreparationEvent & ThreadEventBase & {iteration: number; type: typeof ThreadEventType.ContextPrepared})
  | ThreadMessageCompletedEvent
  | ThreadModelStartedEvent
  | ThreadRunCancelledEvent
  | ThreadRunCompletedEvent
  | ThreadRunFailedEvent
  | ThreadRunStartedEvent
  | ThreadToolCompletedEvent
  | ThreadToolStartedEvent
  | ThreadToolUpdatedEvent

export type ThreadEventHandler = (event: ThreadEvent) => void

export interface ThreadAgent {
  close(): Promise<void>
  getRun?(id: string): RunSnapshot | undefined
  /** Records new messages into its configured session and runs one turn. */
  invoke(newMessages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message>
  replyApproval?(id: string, reply: ApprovalReply): Promise<'recorded'>
  startRun?(messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<RunHandle<Message>>
}

export type ThreadAgentFactory = (options: AgentOptions) => ThreadAgent

export interface ThreadManagerOptions {
  createAgent?: ThreadAgentFactory
  loggerFactory?: SessionLoggerFactory
  onEvent?: ThreadEventHandler
  onRunSnapshot?: (snapshot: RunSnapshot) => void
  sessionRepository?: SessionRepository
}

export interface CreateThreadOptions {
  agent?: AgentOptions
  id?: string
}

export interface ThreadRunOptions {
  requestId?: string
  signal?: AbortSignal
}

export interface ThreadRunHandle {
  admitted: Promise<void>
  completion: Promise<ThreadMessage>
  id: string
  threadId: string
}

interface ManagedThread {
  agent: ThreadAgent
  createdAt: string
  id: string
  lastRunId?: string
  session: Session
  updatedAt: string
}

interface ActiveRun {
  admitted: Promise<void>
  controller: AbortController
  done: Promise<void>
  id: string
  rejectAdmission(error: unknown): void
  resolveAdmission(): void
  resolveDone: () => void
  threadId: string
}

export class ThreadManager {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private closed = false
  private closePromise?: Promise<void>
  private readonly createAgent: ThreadAgentFactory
  private readonly eventHandlers = new Set<ThreadEventHandler>()
  private readonly loggerFactory?: SessionLoggerFactory
  private readonly onRunSnapshot?: (snapshot: RunSnapshot) => void
  private readonly runThreads = new Map<string, string>()
  private readonly sessionRepository?: SessionRepository
  private readonly submissions = new Map<string, {content: string; handle: ThreadRunHandle}>()
  private readonly threads = new Map<string, ManagedThread>()

  constructor(options: ThreadManagerOptions = {}) {
    this.onRunSnapshot = options.onRunSnapshot
    this.createAgent = options.createAgent ?? ((agentOptions) => new Agent(agentOptions))
    if (options.onEvent !== undefined) this.eventHandlers.add(options.onEvent)
    this.loggerFactory = options.loggerFactory
    this.sessionRepository = options.sessionRepository
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId)
    if (run === undefined) return false
    run.controller.abort()
    return true
  }

  close(): Promise<void> {
    this.closed = true
    this.closePromise ??= Promise.allSettled(
      [...this.threads.keys()].map((threadId) => this.closeThread(threadId)),
    ).then((results) => {
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (errors.length > 0)
        throw new AggregateError(
          errors.map((result) => result.reason),
          'Thread manager close incomplete',
        )
    })
    return this.closePromise
  }

  async closeThread(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId)
    if (thread === undefined) return false

    const run = this.getActiveRunForThread(threadId)
    if (run !== undefined) {
      run.controller.abort()
      await run.done
    }

    await thread.agent.close()
    await thread.session.close()

    this.threads.delete(threadId)
    return true
  }

  createThread(options: CreateThreadOptions = {}): ThreadSnapshot {
    if (this.closed) throw new Error('Thread manager is closed')
    const id = options.id ?? uuidv7()
    if (this.threads.has(id)) {
      throw new InvalidInputError(`Thread already exists: ${id}`)
    }

    const session =
      options.agent?.state?.getSession() ??
      (this.sessionRepository === undefined
        ? new Session({metadata: {cwd: options.agent?.cwd, id}})
        : this.sessionRepository.create({
            cwd: options.agent?.cwd,
            formatVersion:
              (options.agent?.contextPolicy ?? options.agent?.settings?.contextPolicy)?.mode === 'budgeted' ? 2 : 1,
            id,
            model: options.agent?.model?.name,
            originator: 'orbit-thread-manager',
            provider: options.agent?.model?.provider,
            systemPrompt: sessionSystemPrompt(options.agent?.messages),
          }))
    const metadata = session.getMetadata()
    const agentOptions: AgentOptions = {
      ...options.agent,
      ...(options.agent?.messages === undefined && metadata.systemPrompt !== undefined
        ? {messages: [new CoreMessage(CoreMessageType.Session, {content: metadata.systemPrompt})]}
        : {}),
      state: new State(session),
      ...this.sessionLoggerOptions(id, options.agent),
    }
    let agent: ThreadAgent
    try {
      agent = this.createAgent(agentOptions)
    } catch (error) {
      session.close().catch(() => {})
      throw error
    }

    const thread: ManagedThread = {
      agent,
      createdAt: metadata.createdAt,
      id,
      session,
      updatedAt: metadata.createdAt,
    }
    this.threads.set(id, thread)
    return this.snapshot(thread)
  }

  getRun(id: string): RunSnapshot | undefined {
    const threadId = this.runThreads.get(id)
    return threadId ? this.threads.get(threadId)?.agent.getRun?.(id) : undefined
  }

  getThread(id: string): ThreadSnapshot | undefined {
    const thread = this.threads.get(id)
    return thread === undefined ? undefined : this.snapshot(thread)
  }

  listThreads(): ThreadSnapshot[] {
    return [...this.threads.values()].map((thread) => this.snapshot(thread))
  }

  replyApproval(id: string, reply: ApprovalReply): Promise<'recorded'> {
    const threadId = this.runThreads.get(id)
    const agent = threadId ? this.threads.get(threadId)?.agent : undefined
    return agent?.replyApproval ? agent.replyApproval(id, reply) : Promise.reject(new Error('Unknown managed run'))
  }

  resumeThread(file: string, options: Omit<CreateThreadOptions, 'id'> = {}): ThreadSnapshot {
    if (this.closed) throw new Error('Thread manager is closed')
    if (this.sessionRepository === undefined) {
      throw new InvalidInputError('A session repository is required to resume a thread.')
    }

    const summary = this.sessionRepository.readSummary(file)
    const {id} = summary
    if (this.threads.has(id)) {
      throw new InvalidInputError(`Thread already exists: ${id}`)
    }

    const session = this.sessionRepository.open(file)
    const metadata = session.getMetadata()
    const persistedModel =
      metadata.model === undefined && metadata.provider === undefined
        ? undefined
        : {
            ...(metadata.model === undefined ? {} : {name: metadata.model}),
            ...(metadata.provider === undefined ? {} : {provider: metadata.provider}),
            ...options.agent?.model,
          }
    const agentOptions: AgentOptions = {
      cwd: metadata.cwd,
      ...options.agent,
      ...(persistedModel === undefined ? {} : {model: persistedModel}),
      ...(options.agent?.messages === undefined && metadata.systemPrompt !== undefined
        ? {messages: [new CoreMessage(CoreMessageType.Session, {content: metadata.systemPrompt})]}
        : {}),
      state: new State(session),
      ...this.sessionLoggerOptions(id, options.agent),
    }
    let agent: ThreadAgent
    try {
      agent = this.createAgent(agentOptions)
    } catch (error) {
      session.close().catch(() => {})
      throw error
    }

    const thread: ManagedThread = {
      agent,
      createdAt: metadata.createdAt,
      id,
      session,
      updatedAt: session.getConversationMessages().at(-1)?.timestamp ?? metadata.createdAt,
    }
    this.threads.set(id, thread)
    return this.snapshot(thread)
  }

  sendMessage(threadId: string, content: string, options: ThreadRunOptions = {}): Promise<ThreadMessage> {
    return this.startRun(threadId, content, options).completion
  }

  startRun(threadId: string, content: string, options: ThreadRunOptions = {}): ThreadRunHandle {
    if (this.closed) throw new Error('Thread manager is closed')
    if (content.trim().length === 0) {
      throw new InvalidInputError('Message content cannot be empty.')
    }

    const thread = this.requireThread(threadId)
    const requestKey = options.requestId ? `${threadId}:${options.requestId}` : undefined
    const prior = requestKey ? this.submissions.get(requestKey) : undefined
    if (prior) {
      if (prior.content !== content) throw new InvalidInputError('Conflicting request ID')
      return prior.handle
    }

    if (this.getActiveRunForThread(threadId) !== undefined) {
      throw new InvalidInputError(`Thread is already running: ${threadId}`)
    }

    const run = createActiveRun(threadId)
    this.activeRuns.set(run.id, run)
    thread.lastRunId = run.id
    this.runThreads.set(run.id, threadId)
    const completion = this.executeRun(thread, content, options, run)
    completion.catch(() => {})
    const handle = {
      admitted: run.admitted,
      completion,
      get id() {
        return run.id
      },
      threadId,
    }
    if (requestKey) this.submissions.set(requestKey, {content, handle})
    return handle
  }

  subscribe(handler: ThreadEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emit(event: ThreadEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        Promise.resolve(handler(event)).catch(() => {})
      } catch {
        /* Optional observer. */
      }
    }
  }

  private async executeRun(
    thread: ManagedThread,
    content: string,
    options: ThreadRunOptions,
    run: ActiveRun,
  ): Promise<ThreadMessage> {
    const {threadId} = run
    const forwardAbort = () => run.controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', forwardAbort, {once: true})
    if (options.signal?.aborted) forwardAbort()

    const userMessage = new CoreMessage(CoreMessageType.User, {
      content,
      parentid: thread.session.getLastMessageId(),
    })
    try {
      thread.updatedAt = userMessage.timestamp

      const invokeOptions: Partial<AgentInvokeOptions> = {
        onEvent: (event) => this.handleAgentEvent(thread, run.id, event),
        onRunSnapshot: this.onRunSnapshot,
        requestId: options.requestId ?? run.id,
        signal: run.controller.signal,
        turnId: run.id,
      }
      let response: Message
      if (thread.agent.startRun) {
        const handle = await thread.agent.startRun([userMessage], invokeOptions)
        if (handle.id !== run.id) {
          this.activeRuns.delete(run.id)
          this.runThreads.delete(run.id)
          run.id = handle.id
          this.activeRuns.set(run.id, run)
          this.runThreads.set(run.id, threadId)
          thread.lastRunId = run.id
        }

        this.emit({
          message: serializeMessage(userMessage),
          runId: run.id,
          threadId,
          timestamp: new Date().toISOString(),
          type: ThreadEventType.RunStarted,
        })
        run.resolveAdmission()
        const result = await handle.finished
        if (result.outcome !== 'completed') throw new RunExecutionError(result)
        const value = handle.value()
        if (!value) throw new RunExecutionError({...result, reason: 'Recovered run; query its recorded result'})
        response = value
      } else {
        this.emit({
          message: serializeMessage(userMessage),
          runId: run.id,
          threadId,
          timestamp: new Date().toISOString(),
          type: ThreadEventType.RunStarted,
        })
        run.resolveAdmission()
        response = await thread.agent.invoke([userMessage], invokeOptions)
      }

      const message = serializeMessage(response)
      this.emit({
        message,
        runId: run.id,
        threadId,
        timestamp: new Date().toISOString(),
        type: ThreadEventType.RunCompleted,
      })
      return message
    } catch (error) {
      run.rejectAdmission(error)
      if (
        (error instanceof RunExecutionError && error.result.outcome === 'cancelled') ||
        (!(error instanceof RunExecutionError) && (run.controller.signal.aborted || error instanceof ModelAbortError))
      ) {
        const abortError =
          error instanceof ModelAbortError
            ? error
            : new ModelAbortError('Thread run aborted.', {cause: run.controller.signal.reason ?? error})
        this.emit({
          runId: run.id,
          threadId,
          timestamp: new Date().toISOString(),
          type: ThreadEventType.RunCancelled,
        })
        throw abortError
      }

      this.emit({
        error: serializeError(error),
        runId: run.id,
        threadId,
        timestamp: new Date().toISOString(),
        type: ThreadEventType.RunFailed,
      })
      throw error
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort)
      this.activeRuns.delete(run.id)
      run.resolveDone()
    }
  }

  private getActiveRunForThread(threadId: string): ActiveRun | undefined {
    return [...this.activeRuns.values()].find((run) => run.threadId === threadId)
  }

  private handleAgentEvent(thread: ManagedThread, runId: string, event: AgentEvent): void {
    const base = {
      runId,
      threadId: thread.id,
      timestamp: new Date().toISOString(),
    }

    switch (event.type) {
      case AgentEventType.ContextPrepared: {
        this.emit({...base, ...event})
        return
      }

      case AgentEventType.MessageCompleted: {
        thread.updatedAt = event.message.timestamp
        this.emit({...base, iteration: event.iteration, message: serializeMessage(event.message), type: event.type})
        return
      }

      case AgentEventType.ModelStarted: {
        this.emit({...base, iteration: event.iteration, type: event.type})
        return
      }

      case AgentEventType.ToolCompleted: {
        thread.updatedAt = event.message.timestamp
        this.emit({
          ...base,
          iteration: event.iteration,
          message: serializeMessage(event.message),
          toolCall: event.toolCall,
          type: event.type,
        })
        return
      }

      case AgentEventType.ToolStarted: {
        this.emit({...base, iteration: event.iteration, toolCall: event.toolCall, type: event.type})
        return
      }

      case AgentEventType.ToolUpdated: {
        this.emit({
          ...base,
          iteration: event.iteration,
          toolCall: event.toolCall,
          type: event.type,
          update: event.update,
        })
      }
    }
  }

  private requireThread(id: string): ManagedThread {
    const thread = this.threads.get(id)
    if (thread === undefined) {
      throw new InvalidInputError(`Unknown thread: ${id}`)
    }

    return thread
  }

  private sessionLoggerOptions(id: string, options: AgentOptions | undefined): Partial<Pick<AgentOptions, 'logger'>> {
    if (options?.logger !== undefined || this.loggerFactory === undefined) return {}
    return {logger: this.loggerFactory.forSession(id)}
  }

  private snapshot(thread: ManagedThread): ThreadSnapshot {
    const metadata = thread.session.getMetadata()
    return {
      createdAt: thread.createdAt,
      cwd: metadata.cwd,
      ...(thread.session.getFile() === undefined ? {} : {file: thread.session.getFile()}),
      id: thread.id,
      messages: thread.session.getConversationMessages().map((message) => serializeMessage(message)),
      ...(metadata.model === undefined ? {} : {model: metadata.model}),
      ...(metadata.provider === undefined ? {} : {provider: metadata.provider}),
      ...(thread.lastRunId && thread.agent.getRun?.(thread.lastRunId)
        ? {run: thread.agent.getRun(thread.lastRunId)}
        : {}),
      status: this.getActiveRunForThread(thread.id) === undefined ? ThreadStatus.Idle : ThreadStatus.Running,
      updatedAt: thread.updatedAt,
    }
  }
}

export function serializeMessage(message: Message): ThreadMessage {
  return {
    content: message.content,
    contents: [...message.contents],
    id: message.id,
    parentid: message.parentid,
    ...(message.payload === undefined ? {} : {payload: message.payload}),
    role: message.role,
    timestamp: message.timestamp,
    type: message.type,
  }
}

function createActiveRun(threadId: string): ActiveRun {
  let resolveAdmission!: () => void
  let rejectAdmission!: (error: unknown) => void
  const admitted = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  admitted.catch(() => {})
  let resolveDone = noop
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  return {
    admitted,
    controller: new AbortController(),
    done,
    id: uuidv7(),
    rejectAdmission,
    resolveAdmission,
    resolveDone,
    threadId,
  }
}

function noop(): void {}

function serializeError(error: unknown): ThreadError {
  if (error instanceof OrbitError) {
    return {
      ...(error.code === undefined ? {} : {code: error.code}),
      message: error.message,
      name: error.name,
    }
  }

  if (error instanceof Error) {
    return {message: error.message, name: error.name}
  }

  return {message: String(error), name: 'Error'}
}

function sessionSystemPrompt(messages: Message[] | undefined): string | undefined {
  const contents = messages
    ?.filter((message) => message.type === CoreMessageType.Session)
    .flatMap((message) => message.contents)
    .filter((content) => content.length > 0)
  return contents === undefined || contents.length === 0 ? undefined : contents.join('\n\n')
}
