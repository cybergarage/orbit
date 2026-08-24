// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogFields, Logger} from '../logger/index.js'

import {LogEventType, LogOutcome} from '../logs/index.js'

export const DiagnosticCapture = {
  Full: 'full',
  Metadata: 'metadata',
  Off: 'off',
} as const

export type DiagnosticCapture = (typeof DiagnosticCapture)[keyof typeof DiagnosticCapture]

export const DiagnosticLevel = {
  Debug: 'debug',
  Error: 'error',
  Info: 'info',
  Warn: 'warn',
} as const

export type DiagnosticLevel = (typeof DiagnosticLevel)[keyof typeof DiagnosticLevel]

export type DiagnosticData = Record<string, unknown>

export interface DiagnosticContext {
  iteration?: number
  runId?: string
  sessionId?: string
  threadId?: string
  turnId?: string
}

export interface DiagnosticEvent extends DiagnosticContext {
  data: DiagnosticData
  level: DiagnosticLevel
  sequence: number
  timestamp: string
  type: string
  version: 1
}

export interface DiagnosticEventInput extends DiagnosticContext {
  data?: DiagnosticData
  fullData?: DiagnosticData
  level?: DiagnosticLevel
  type: string
}

export type DiagnosticEventHandler = (event: DiagnosticEvent) => void

export interface DiagnosticEventBusOptions {
  capture?: DiagnosticCapture
  fullCaptureDurationMs?: number
  maxEvents?: number
  now?: () => number
}

export class DiagnosticEventBus {
  private capture: DiagnosticCapture
  private readonly events: DiagnosticEvent[] = []
  private readonly fullCaptureDurationMs: number
  private fullCaptureUntil?: number
  private readonly listeners = new Set<DiagnosticEventHandler>()
  private readonly maxEvents: number
  private readonly now: () => number
  private sequence = 0

  constructor(options: DiagnosticEventBusOptions = {}) {
    this.capture = options.capture ?? DiagnosticCapture.Metadata
    this.fullCaptureDurationMs = options.fullCaptureDurationMs ?? 15 * 60 * 1000
    this.maxEvents = options.maxEvents ?? 1000
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) {
      throw new Error('Diagnostic maxEvents must be a positive integer.')
    }

    if (!Number.isSafeInteger(this.fullCaptureDurationMs) || this.fullCaptureDurationMs <= 0) {
      throw new Error('Diagnostic fullCaptureDurationMs must be a positive integer.')
    }

    if (this.capture === DiagnosticCapture.Full) this.fullCaptureUntil = this.now() + this.fullCaptureDurationMs
  }

  emit(input: DiagnosticEventInput): DiagnosticEvent | undefined {
    const capture = this.getCapture()
    if (capture === DiagnosticCapture.Off) return undefined

    const event: DiagnosticEvent = {
      data: {
        ...input.data,
        ...(capture === DiagnosticCapture.Full ? input.fullData : {}),
      },
      level: input.level ?? DiagnosticLevel.Debug,
      ...(input.iteration === undefined ? {} : {iteration: input.iteration}),
      ...(input.runId === undefined ? {} : {runId: input.runId}),
      sequence: (this.sequence += 1),
      ...(input.sessionId === undefined ? {} : {sessionId: input.sessionId}),
      ...(input.threadId === undefined ? {} : {threadId: input.threadId}),
      timestamp: new Date().toISOString(),
      ...(input.turnId === undefined ? {} : {turnId: input.turnId}),
      type: input.type,
      version: 1,
    }
    this.events.push(event)
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    for (const listener of this.listeners) listener(event)
    return event
  }

  getCapture(): DiagnosticCapture {
    if (
      this.capture === DiagnosticCapture.Full &&
      this.fullCaptureUntil !== undefined &&
      this.now() >= this.fullCaptureUntil
    ) {
      this.capture = DiagnosticCapture.Metadata
      this.fullCaptureUntil = undefined
    }

    return this.capture
  }

  list(afterSequence = 0): DiagnosticEvent[] {
    return this.events.filter((event) => event.sequence > afterSequence)
  }

  setCapture(capture: DiagnosticCapture): void {
    this.capture = capture
    this.fullCaptureUntil = capture === DiagnosticCapture.Full ? this.now() + this.fullCaptureDurationMs : undefined
  }

  subscribe(handler: DiagnosticEventHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }
}

export function attachDiagnosticLogger(bus: DiagnosticEventBus, logger: Logger): () => void {
  return bus.subscribe((event) => {
    const eventType = diagnosticLogEventType(event)
    const fields = {
      ...event.data,
      diagnosticSequence: event.sequence,
      eventType,
      ...(event.iteration === undefined ? {} : {iteration: event.iteration}),
      ...(event.runId === undefined ? {} : {runId: event.runId}),
      ...(event.sessionId === undefined ? {} : {sessionId: event.sessionId}),
      ...(event.threadId === undefined ? {} : {threadId: event.threadId}),
      ...(event.turnId === undefined ? {} : {turnId: event.turnId}),
      ...diagnosticOutcome(eventType),
    } as LogFields
    logger[event.level](fields, event.type)
  })
}

function diagnosticLogEventType(event: DiagnosticEvent): string {
  switch (event.type) {
    case 'app.started': {
      return LogEventType.ApplicationStarted
    }

    case 'mcp.server.connected': {
      return LogEventType.McpConnectionSucceeded
    }

    case 'mcp.server.connecting': {
      return LogEventType.McpConnectionStarted
    }

    case 'mcp.server.failed': {
      return LogEventType.McpConnectionFailed
    }

    case 'model.response.completed': {
      return LogEventType.ModelRequestCompleted
    }

    case 'model.response.failed': {
      return LogEventType.ModelRequestFailed
    }

    case 'run-cancelled':
    case 'run.cancelled': {
      return LogEventType.TurnCancelled
    }

    case 'run-completed':
    case 'run.completed': {
      return LogEventType.TurnCompleted
    }

    case 'run-failed':
    case 'run.failed': {
      return LogEventType.TurnFailed
    }

    case 'run-started':
    case 'run.started': {
      return LogEventType.TurnStarted
    }

    case 'tool.completed': {
      return event.data.isError === true ? LogEventType.ToolCallFailed : LogEventType.ToolCallCompleted
    }

    case 'tool.started': {
      return LogEventType.ToolCallStarted
    }

    default: {
      return event.type
    }
  }
}

function diagnosticOutcome(eventType: string): {outcome?: LogOutcome} {
  if (eventType.endsWith('.started')) return {outcome: LogOutcome.Started}
  if (
    eventType.endsWith('.closed') ||
    eventType.endsWith('.completed') ||
    eventType.endsWith('.created') ||
    eventType.endsWith('.resumed') ||
    eventType.endsWith('.succeeded')
  ) {
    return {outcome: LogOutcome.Succeeded}
  }

  if (eventType.endsWith('.failed')) return {outcome: LogOutcome.Failed}
  if (eventType.endsWith('.cancelled')) return {outcome: LogOutcome.Cancelled}
  return {}
}
