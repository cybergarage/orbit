// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import type {LogFields, Logger, LoggerBindings, LogLevel, LogMethod, LogValue} from '../logger/index.js'
import type {LogCorrelation, LogOutcome, LogUsage} from './records.js'
import type {SessionLogStore} from './store.js'

import {getLogContext} from './context.js'
import {
  categoryForEventType,
  eventTypeFromMessage,
  isLogCategory,
  isLogOutcome,
  LogOutcome as Outcome,
} from './records.js'
import {reportLogStoreError} from './store.js'

const LEVEL_VALUES: Record<LogLevel, number> = {debug: 20, error: 50, fatal: 60, info: 30, trace: 10, warn: 40}
const MAX_LOG_STRING_LENGTH = 4096
const MAX_LOG_STACK_LENGTH = 16_384
const MAX_LOG_VALUE_DEPTH = 12
const CORRELATION_KEYS = [
  'iteration',
  'messageId',
  'parentOperationId',
  'requestId',
  'runId',
  'sessionId',
  'threadId',
  'toolCallId',
  'turnId',
] as const

interface NormalizationStats {
  redacted: number
}

export interface SessionLoggerFactory {
  forApplication(bindings?: LoggerBindings): Logger
  forSession(sessionId: string, bindings?: LoggerBindings): Logger
}

export interface StoreSessionLoggerFactoryOptions {
  level?: LogLevel
  onError?: (error: Error) => void
}

interface LogLevelController {
  level: LogLevel
}

export class StoreSessionLoggerFactory implements SessionLoggerFactory {
  private readonly controller: LogLevelController

  constructor(
    private readonly store: SessionLogStore,
    private readonly options: StoreSessionLoggerFactoryOptions = {},
  ) {
    this.controller = {level: options.level ?? 'info'}
  }

  forApplication(bindings: LoggerBindings = {}): Logger {
    return new SessionStoreLogger(this.store, bindings, this.controller, this.options.onError)
  }

  forSession(sessionId: string, bindings: LoggerBindings = {}): Logger {
    return new SessionStoreLogger(
      this.store,
      {...bindings, sessionId, threadId: sessionId},
      this.controller,
      this.options.onError,
    )
  }
}

class SessionStoreLogger implements Logger {
  constructor(
    private readonly store: SessionLogStore,
    private readonly bindings: LoggerBindings,
    private readonly controller: LogLevelController,
    private readonly onError?: (error: Error) => void,
  ) {}

  get debug(): LogMethod {
    return this.method('debug')
  }

  get error(): LogMethod {
    return this.method('error')
  }

  get fatal(): LogMethod {
    return this.method('fatal')
  }

  get info(): LogMethod {
    return this.method('info')
  }

  get trace(): LogMethod {
    return this.method('trace')
  }

  get warn(): LogMethod {
    return this.method('warn')
  }

  child(bindings: LoggerBindings): Logger {
    return new SessionStoreLogger(this.store, {...this.bindings, ...bindings}, this.controller, this.onError)
  }

  isDebugEnabled(): boolean {
    return LEVEL_VALUES[this.controller.level] <= LEVEL_VALUES.debug
  }

  setDebugEnabled(enabled: boolean): void {
    this.controller.level = enabled ? 'debug' : 'info'
  }

  private method(level: LogLevel): LogMethod {
    return ((fieldsOrMessage: Error | LogFields | string, message?: string) => {
      if (LEVEL_VALUES[level] < LEVEL_VALUES[this.controller.level]) return
      const text =
        typeof fieldsOrMessage === 'string'
          ? fieldsOrMessage
          : (message ?? (fieldsOrMessage instanceof Error ? fieldsOrMessage.message : ''))
      const suppliedFields =
        typeof fieldsOrMessage === 'string'
          ? {}
          : fieldsOrMessage instanceof Error
            ? {error: fieldsOrMessage}
            : fieldsOrMessage
      const stats: NormalizationStats = {redacted: 0}
      const fields = normalizeFields({...this.bindings, ...suppliedFields}, stats)
      const eventType = typeof fields.eventType === 'string' ? fields.eventType : eventTypeFromMessage(text)
      const category = isLogCategory(fields.category) ? fields.category : categoryForEventType(eventType)
      const correlation = extractCorrelation({...getLogContext(), ...fields})
      const outcome = isLogOutcome(fields.outcome) ? fields.outcome : outcomeForEventType(eventType)
      const durationMs =
        typeof fields.durationMs === 'number' && Number.isFinite(fields.durationMs) && fields.durationMs >= 0
          ? fields.durationMs
          : undefined
      const usage = normalizeUsage(fields.usage)
      const component = typeof fields.component === 'string' ? fields.component : undefined
      const record = {
        category,
        ...(component === undefined ? {} : {component}),
        correlation,
        ...(durationMs === undefined ? {} : {durationMs}),
        eventType,
        fields: withoutEnvelopeFields(fields),
        id: uuidv7(),
        level,
        message: redactString(text, stats, MAX_LOG_STRING_LENGTH),
        ...(outcome === undefined ? {} : {outcome}),
        timestamp: new Date().toISOString(),
        ...(usage === undefined ? {} : {usage}),
        version: 2 as const,
      }
      try {
        this.store.recordRedactions(stats.redacted)
        this.store.append(record)
      } catch (error) {
        reportLogStoreError(this.onError, error)
      }
    }) as LogMethod
  }
}

function normalizeFields(value: Error | LogFields, stats: NormalizationStats): LogFields {
  if (value instanceof Error) {
    return {error: normalizeError(value, stats)}
  }

  const normalized = normalizeValue(value, new Set(), stats, 0)
  return isLogFields(normalized) ? normalized : {}
}

function normalizeValue(value: unknown, seen: Set<object>, stats: NormalizationStats, depth: number): LogValue {
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return redactString(value, stats, MAX_LOG_STRING_LENGTH)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return normalizeError(value, stats)
  if (typeof value !== 'object') return String(value)
  if (depth >= MAX_LOG_VALUE_DEPTH) return '[MaxDepth]'
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.slice(0, 100).map((item) => normalizeValue(item, seen, stats, depth + 1))
    if (value.length > 100) result.push(`[Truncated ${value.length - 100} items]`)
    seen.delete(value)
    return result
  }

  const result: LogFields = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = isSensitiveLogKey(key)
      ? redactSensitiveValue(item, stats)
      : normalizeValue(item, seen, stats, depth + 1)
    if (normalized !== undefined) result[key] = normalized
  }

  seen.delete(value)
  return result
}

function redactSensitiveValue(value: unknown, stats: NormalizationStats): string {
  if (value !== undefined) stats.redacted += 1
  return '[REDACTED]'
}

function redactString(value: string, stats: NormalizationStats, limit: number): string {
  let result = value
  result = result.replaceAll(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/giu, (_match, scheme: string) => {
    stats.redacted += 1
    return `${scheme} [REDACTED]`
  })
  result = result.replaceAll(/\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/gu, () => {
    stats.redacted += 1
    return '[REDACTED]'
  })

  return result.length <= limit ? result : `${result.slice(0, limit)}…[TRUNCATED]`
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'environment' ||
    normalized === 'env' ||
    normalized === 'setcookie' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  )
}

function normalizeError(error: Error, stats: NormalizationStats): LogFields {
  return {
    message: redactString(error.message, stats, MAX_LOG_STRING_LENGTH),
    name: error.name,
    ...(error.stack === undefined ? {} : {stack: redactString(error.stack, stats, MAX_LOG_STACK_LENGTH)}),
  }
}

function extractCorrelation(fields: LogFields): LogCorrelation {
  const correlation: LogCorrelation = {}
  for (const key of CORRELATION_KEYS) {
    const value = fields[key]
    if (key === 'iteration') {
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) correlation.iteration = value
    } else if (typeof value === 'string') {
      correlation[key] = value
    }
  }

  if (correlation.turnId === undefined && correlation.runId !== undefined) correlation.turnId = correlation.runId
  if (correlation.requestId === undefined && typeof fields.responseId === 'string') {
    correlation.requestId = fields.responseId
  }

  return correlation
}

function normalizeUsage(value: LogValue | undefined): LogUsage | undefined {
  if (!isLogFields(value)) return undefined
  const usage: LogUsage = {}
  if (typeof value.inputTokens === 'number') usage.inputTokens = value.inputTokens
  if (typeof value.outputTokens === 'number') usage.outputTokens = value.outputTokens
  if (typeof value.totalTokens === 'number') usage.totalTokens = value.totalTokens
  return Object.keys(usage).length === 0 ? undefined : usage
}

function outcomeForEventType(eventType: string): LogOutcome | undefined {
  if (eventType.endsWith('.started')) return Outcome.Started
  if (
    eventType.endsWith('.closed') ||
    eventType.endsWith('.completed') ||
    eventType.endsWith('.created') ||
    eventType.endsWith('.resumed') ||
    eventType.endsWith('.succeeded')
  ) {
    return Outcome.Succeeded
  }

  if (eventType.endsWith('.failed')) return Outcome.Failed
  if (eventType.endsWith('.cancelled')) return Outcome.Cancelled
  if (eventType.endsWith('.denied')) return Outcome.Denied
  return undefined
}

function isLogFields(value: LogValue): value is LogFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Error)
}

function withoutEnvelopeFields(fields: LogFields): LogFields {
  const result = {...fields}
  delete result.category
  delete result.component
  delete result.durationMs
  delete result.eventType
  delete result.outcome
  delete result.usage
  for (const key of CORRELATION_KEYS) delete result[key]
  return result
}
