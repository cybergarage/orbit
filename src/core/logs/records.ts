// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogFields, LogLevel} from '../logger/index.js'

export const LogCategory = {
  Lifecycle: 'lifecycle',
  Mcp: 'mcp',
  Model: 'model',
  Runtime: 'runtime',
  Security: 'security',
  Storage: 'storage',
  Tool: 'tool',
} as const

export type LogCategory = (typeof LogCategory)[keyof typeof LogCategory]

export const LogOutcome = {
  Cancelled: 'cancelled',
  Denied: 'denied',
  Failed: 'failed',
  Started: 'started',
  Succeeded: 'succeeded',
} as const

export type LogOutcome = (typeof LogOutcome)[keyof typeof LogOutcome]

/** Stable metadata-only events emitted by the Orbit runtime. */
export const LogEventType = {
  ApplicationStarted: 'application.started',
  CommandSubmitted: 'command.submitted',
  McpConnectionFailed: 'mcp.connection.failed',
  McpConnectionStarted: 'mcp.connection.started',
  McpConnectionSucceeded: 'mcp.connection.succeeded',
  ModelRequestCompleted: 'model.request.completed',
  ModelRequestFailed: 'model.request.failed',
  ModelRequestStarted: 'model.request.started',
  RuntimeEvent: 'runtime.event',
  SessionClosed: 'session.closed',
  SessionCreated: 'session.created',
  SessionResumed: 'session.resumed',
  StorageFailed: 'storage.failed',
  ToolCallCompleted: 'tool.call.completed',
  ToolCallFailed: 'tool.call.failed',
  ToolCallStarted: 'tool.call.started',
  TurnCancelled: 'turn.cancelled',
  TurnCompleted: 'turn.completed',
  TurnFailed: 'turn.failed',
  TurnStarted: 'turn.started',
} as const

export type LogEventType = (typeof LogEventType)[keyof typeof LogEventType]

export interface LogCorrelation {
  iteration?: number
  messageId?: string
  parentOperationId?: string
  requestId?: string
  runId?: string
  sessionId?: string
  threadId?: string
  toolCallId?: string
  turnId?: string
}

export interface LogUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** Current normalized record written by Orbit log stores. */
export interface LogRecord {
  category: LogCategory
  component?: string
  correlation: LogCorrelation
  durationMs?: number
  eventType: string
  fields: LogFields
  id: string
  level: LogLevel
  message: string
  outcome?: LogOutcome
  timestamp: string
  usage?: LogUsage
  version: 2
}

/** Version 1 is accepted on read so existing session logs remain usable. */
export interface LegacyLogRecord {
  component?: string
  fields: LogFields
  id: string
  iteration?: number
  level: LogLevel
  message: string
  runId?: string
  sessionId?: string
  threadId?: string
  timestamp: string
  version: 1
}

export interface LogQuery {
  /** Opaque cursor returned by a previous query. Legacy record IDs are also accepted. */
  after?: string
  categories?: LogCategory[]
  eventTypes?: string[]
  levels?: LogLevel[]
  limit?: number
  outcomes?: LogOutcome[]
  search?: string
}

export interface LogPage {
  data: LogRecord[]
  next?: string
}

export type LogRecordHandler = (record: LogRecord) => void

export const DEFAULT_LOG_QUERY_LIMIT = 200
export const MAX_LOG_QUERY_LIMIT = 1000

const LOG_CATEGORIES = new Set<LogCategory>(Object.values(LogCategory))
const LOG_OUTCOMES = new Set<LogOutcome>(Object.values(LogOutcome))

export function resolveLogQueryLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LOG_QUERY_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOG_QUERY_LIMIT) {
    throw new Error(`Log query limit must be between 1 and ${MAX_LOG_QUERY_LIMIT}.`)
  }

  return limit
}

export function matchesLogQuery(record: LogRecord, query: LogQuery): boolean {
  if (query.levels !== undefined && !query.levels.includes(record.level)) return false
  if (query.categories !== undefined && !query.categories.includes(record.category)) return false
  if (query.eventTypes !== undefined && !query.eventTypes.includes(record.eventType)) return false
  if (query.outcomes !== undefined && (record.outcome === undefined || !query.outcomes.includes(record.outcome))) {
    return false
  }

  if (query.search === undefined || query.search.length === 0) return true
  const needle = query.search.toLowerCase()
  return (
    record.message.toLowerCase().includes(needle) ||
    record.eventType.toLowerCase().includes(needle) ||
    JSON.stringify(record.fields).toLowerCase().includes(needle)
  )
}

export function categoryForEventType(eventType: string): LogCategory {
  if (eventType.startsWith('session.') || eventType.startsWith('turn.') || eventType.startsWith('run.')) {
    return LogCategory.Lifecycle
  }

  if (eventType.startsWith('model.')) return LogCategory.Model
  if (eventType.startsWith('tool.')) return LogCategory.Tool
  if (eventType.startsWith('mcp.')) return LogCategory.Mcp
  if (eventType.startsWith('storage.')) return LogCategory.Storage
  if (eventType.startsWith('security.')) return LogCategory.Security
  return LogCategory.Runtime
}

export function normalizeLogRecord(value: unknown): LogRecord {
  if (!isRecord(value)) throw new Error('Log record must be an object.')
  if (value.version === 2) return validateCurrentLogRecord(value)
  if (value.version === 1) return upgradeLegacyLogRecord(value)
  throw new Error('Unsupported log record version.')
}

function validateCurrentLogRecord(value: Record<string, unknown>): LogRecord {
  if (
    typeof value.id !== 'string' ||
    typeof value.timestamp !== 'string' ||
    typeof value.level !== 'string' ||
    typeof value.eventType !== 'string' ||
    typeof value.message !== 'string' ||
    !isRecord(value.correlation) ||
    !isRecord(value.fields) ||
    typeof value.category !== 'string' ||
    !LOG_CATEGORIES.has(value.category as LogCategory)
  ) {
    throw new Error('Invalid version 2 log record.')
  }

  return value as unknown as LogRecord
}

function upgradeLegacyLogRecord(value: Record<string, unknown>): LogRecord {
  if (
    typeof value.id !== 'string' ||
    typeof value.timestamp !== 'string' ||
    typeof value.level !== 'string' ||
    typeof value.message !== 'string' ||
    !isRecord(value.fields)
  ) {
    throw new Error('Invalid version 1 log record.')
  }

  const fields = {...value.fields} as LogFields
  const eventType = typeof fields.eventType === 'string' ? fields.eventType : eventTypeFromMessage(value.message)
  delete fields.eventType
  return {
    category: categoryForEventType(eventType),
    ...(typeof value.component === 'string' ? {component: value.component} : {}),
    correlation: {
      ...(typeof value.iteration === 'number' ? {iteration: value.iteration} : {}),
      ...(typeof value.runId === 'string' ? {runId: value.runId, turnId: value.runId} : {}),
      ...(typeof value.sessionId === 'string' ? {sessionId: value.sessionId} : {}),
      ...(typeof value.threadId === 'string' ? {threadId: value.threadId} : {}),
    },
    eventType,
    fields,
    id: value.id,
    level: value.level as LogLevel,
    message: value.message,
    timestamp: value.timestamp,
    version: 2,
  }
}

export function eventTypeFromMessage(message: string): string {
  const normalized = message
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9.]+/gu, '.')
    .replaceAll(/^\.+|\.+$/gu, '')
  return normalized.length === 0 ? LogEventType.RuntimeEvent : normalized
}

export function isLogCategory(value: unknown): value is LogCategory {
  return typeof value === 'string' && LOG_CATEGORIES.has(value as LogCategory)
}

export function isLogOutcome(value: unknown): value is LogOutcome {
  return typeof value === 'string' && LOG_OUTCOMES.has(value as LogOutcome)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
