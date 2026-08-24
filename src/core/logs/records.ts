// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogFields, LogLevel} from '../logger/index.js'

export interface LogRecord {
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
  after?: string
  levels?: LogLevel[]
  limit?: number
  search?: string
}

export interface LogPage {
  data: LogRecord[]
  next?: string
}

export type LogRecordHandler = (record: LogRecord) => void

export const DEFAULT_LOG_QUERY_LIMIT = 200
export const MAX_LOG_QUERY_LIMIT = 1000

export function resolveLogQueryLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LOG_QUERY_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOG_QUERY_LIMIT) {
    throw new Error(`Log query limit must be between 1 and ${MAX_LOG_QUERY_LIMIT}.`)
  }

  return limit
}

export function matchesLogQuery(record: LogRecord, query: LogQuery): boolean {
  if (query.levels !== undefined && !query.levels.includes(record.level)) return false
  if (query.search === undefined || query.search.length === 0) return true
  const needle = query.search.toLowerCase()
  return record.message.toLowerCase().includes(needle) || JSON.stringify(record.fields).toLowerCase().includes(needle)
}
