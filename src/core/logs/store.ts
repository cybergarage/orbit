// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'

export interface LogStoreHealth {
  accepted: number
  dropped: number
  failed: number
  redacted: number
  rotated: number
  written: number
}

export interface SessionLogStore {
  append(record: LogRecord): void
  close(): Promise<void>
  closeSession(sessionId: string): Promise<void>
  deleteSession(sessionId: string): Promise<boolean>
  flush(sessionId?: string): Promise<void>
  getHealth(): LogStoreHealth
  list(sessionId: string, query?: LogQuery): Promise<LogPage>
  recordRedactions(count: number): void
  subscribe(handler: LogRecordHandler): () => void
}

export interface SessionLogStoreOptions {
  onError?: (error: Error) => void
}

const ERROR_REPORT_INTERVAL_MS = 5000
let lastDefaultErrorMessage: string | undefined
let lastDefaultErrorAt = 0

export function reportLogStoreError(handler: ((error: Error) => void) | undefined, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  if (handler !== undefined) {
    handler(normalized)
    return
  }

  const now = Date.now()
  if (normalized.message === lastDefaultErrorMessage && now - lastDefaultErrorAt < ERROR_REPORT_INTERVAL_MS) return
  lastDefaultErrorMessage = normalized.message
  lastDefaultErrorAt = now
  process.stderr.write(`Orbit log store error: ${normalized.message}\n`)
}
