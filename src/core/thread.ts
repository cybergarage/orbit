// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import type {AgentEvent} from './agent-events.js'
import type {AgentInvokeOptions, AgentOptions} from './agent.js'
import type {Message, MessagePayload, MessageType} from './message/index.js'
import type {ModelToolCall, Role} from './models/index.js'

import {AgentEventType} from './agent-events.js'
import {Agent} from './agent.js'
import {InvalidInputError, ModelAbortError, OrbitError} from './errors/index.js'
import {Message as CoreMessage, MessageType as CoreMessageType} from './message/index.js'

export const ThreadStatus = {
  Idle: 'idle',
  Running: 'running',
} as const

export type ThreadStatus = (typeof ThreadStatus)[keyof typeof ThreadStatus]

export const ThreadEventType = {
  MessageCompleted: AgentEventType.MessageCompleted,
  ModelStarted: AgentEventType.ModelStarted,
  RunCancelled: 'run-cancelled',
  RunCompleted: 'run-completed',
  RunFailed: 'run-failed',
  RunStarted: 'run-started',
  ToolCompleted: AgentEventType.ToolCompleted,
  ToolStarted: AgentEventType.ToolStarted,
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
  id: string
  messages: ThreadMessage[]
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
  | ThreadMessageCompletedEvent
  | ThreadModelStartedEvent
  | ThreadRunCancelledEvent
  | ThreadRunCompletedEvent
  | ThreadRunFailedEvent
  | ThreadRunStartedEvent
  | ThreadToolCompletedEvent
  | ThreadToolStartedEvent

export type ThreadEventHandler = (event: ThreadEvent) => void

export interface ThreadAgent {
  close(): Promise<void>
  invoke(messages: Message[], options?: Partial<AgentInvokeOptions>): Promise<Message>
}

export type ThreadAgentFactory = (options: AgentOptions) => ThreadAgent

export interface ThreadManagerOptions {
  createAgent?: ThreadAgentFactory
  onEvent?: ThreadEventHandler
}

export interface CreateThreadOptions {
  agent?: AgentOptions
  id?: string
}

export interface ThreadRunOptions {
  signal?: AbortSignal
}

interface ManagedThread {
  agent: ThreadAgent
  createdAt: string
  id: string
  messages: Message[]
  updatedAt: string
}

interface ActiveRun {
  controller: AbortController
  done: Promise<void>
  id: string
  resolveDone: () => void
  threadId: string
}

export class ThreadManager {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly createAgent: ThreadAgentFactory
  private readonly onEvent?: ThreadEventHandler
  private readonly threads = new Map<string, ManagedThread>()

  constructor(options: ThreadManagerOptions = {}) {
    this.createAgent = options.createAgent ?? ((agentOptions) => new Agent(agentOptions))
    this.onEvent = options.onEvent
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId)
    if (run === undefined) return false
    run.controller.abort()
    return true
  }

  async close(): Promise<void> {
    await Promise.all([...this.threads.keys()].map((threadId) => this.closeThread(threadId)))
  }

  async closeThread(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId)
    if (thread === undefined) return false

    this.threads.delete(threadId)
    const run = this.getActiveRunForThread(threadId)
    if (run !== undefined) {
      run.controller.abort()
      await run.done
    }

    await thread.agent.close()
    return true
  }

  createThread(options: CreateThreadOptions = {}): ThreadSnapshot {
    const id = options.id ?? uuidv7()
    if (this.threads.has(id)) {
      throw new InvalidInputError(`Thread already exists: ${id}`)
    }

    const timestamp = new Date().toISOString()
    const thread: ManagedThread = {
      agent: this.createAgent(options.agent ?? {}),
      createdAt: timestamp,
      id,
      messages: [],
      updatedAt: timestamp,
    }
    this.threads.set(id, thread)
    return this.snapshot(thread)
  }

  getThread(id: string): ThreadSnapshot | undefined {
    const thread = this.threads.get(id)
    return thread === undefined ? undefined : this.snapshot(thread)
  }

  listThreads(): ThreadSnapshot[] {
    return [...this.threads.values()].map((thread) => this.snapshot(thread))
  }

  async sendMessage(threadId: string, content: string, options: ThreadRunOptions = {}): Promise<ThreadMessage> {
    if (content.trim().length === 0) {
      throw new InvalidInputError('Message content cannot be empty.')
    }

    const thread = this.requireThread(threadId)
    if (this.getActiveRunForThread(threadId) !== undefined) {
      throw new InvalidInputError(`Thread is already running: ${threadId}`)
    }

    const run = createActiveRun(threadId)
    this.activeRuns.set(run.id, run)
    const forwardAbort = () => run.controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', forwardAbort, {once: true})
    if (options.signal?.aborted) forwardAbort()

    const userMessage = new CoreMessage(CoreMessageType.User, {content})
    try {
      thread.messages.push(userMessage)
      thread.updatedAt = userMessage.timestamp
      this.emit({
        message: serializeMessage(userMessage),
        runId: run.id,
        threadId,
        timestamp: new Date().toISOString(),
        type: ThreadEventType.RunStarted,
      })

      const requestMessages = [...thread.messages]
      const response = await thread.agent.invoke(requestMessages, {
        onEvent: (event) => this.handleAgentEvent(thread, run.id, event),
        signal: run.controller.signal,
      })
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
      if (run.controller.signal.aborted || error instanceof ModelAbortError) {
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

  private emit(event: ThreadEvent): void {
    this.onEvent?.(event)
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
      case AgentEventType.MessageCompleted: {
        thread.messages.push(event.message)
        thread.updatedAt = event.message.timestamp
        this.emit({...base, iteration: event.iteration, message: serializeMessage(event.message), type: event.type})
        return
      }

      case AgentEventType.ModelStarted: {
        this.emit({...base, iteration: event.iteration, type: event.type})
        return
      }

      case AgentEventType.ToolCompleted: {
        thread.messages.push(event.message)
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

  private snapshot(thread: ManagedThread): ThreadSnapshot {
    return {
      createdAt: thread.createdAt,
      id: thread.id,
      messages: thread.messages.map((message) => serializeMessage(message)),
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
  let resolveDone = noop
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  return {
    controller: new AbortController(),
    done,
    id: uuidv7(),
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
