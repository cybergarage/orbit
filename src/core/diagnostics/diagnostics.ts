// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Logger} from '../logger/index.js'

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
  maxEvents?: number
}

export class DiagnosticEventBus {
  private capture: DiagnosticCapture
  private readonly events: DiagnosticEvent[] = []
  private readonly listeners = new Set<DiagnosticEventHandler>()
  private readonly maxEvents: number
  private sequence = 0

  constructor(options: DiagnosticEventBusOptions = {}) {
    this.capture = options.capture ?? DiagnosticCapture.Metadata
    this.maxEvents = options.maxEvents ?? 1000
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) {
      throw new Error('Diagnostic maxEvents must be a positive integer.')
    }
  }

  emit(input: DiagnosticEventInput): DiagnosticEvent | undefined {
    if (this.capture === DiagnosticCapture.Off) return undefined

    const event: DiagnosticEvent = {
      data: {
        ...input.data,
        ...(this.capture === DiagnosticCapture.Full ? input.fullData : {}),
      },
      level: input.level ?? DiagnosticLevel.Debug,
      ...(input.iteration === undefined ? {} : {iteration: input.iteration}),
      ...(input.runId === undefined ? {} : {runId: input.runId}),
      sequence: (this.sequence += 1),
      ...(input.sessionId === undefined ? {} : {sessionId: input.sessionId}),
      ...(input.threadId === undefined ? {} : {threadId: input.threadId}),
      timestamp: new Date().toISOString(),
      type: input.type,
      version: 1,
    }
    this.events.push(event)
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    for (const listener of this.listeners) listener(event)
    return event
  }

  getCapture(): DiagnosticCapture {
    return this.capture
  }

  list(afterSequence = 0): DiagnosticEvent[] {
    return this.events.filter((event) => event.sequence > afterSequence)
  }

  setCapture(capture: DiagnosticCapture): void {
    this.capture = capture
  }

  subscribe(handler: DiagnosticEventHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }
}

export function attachDiagnosticLogger(bus: DiagnosticEventBus, logger: Logger): () => void {
  return bus.subscribe((event) => {
    logger[event.level]({diagnosticEvent: JSON.stringify(event)}, event.type)
  })
}
