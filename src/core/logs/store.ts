// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'

export interface SessionLogStore {
  append(record: LogRecord): void
  close(): Promise<void>
  closeSession(sessionId: string): Promise<void>
  deleteSession(sessionId: string): Promise<boolean>
  flush(sessionId?: string): Promise<void>
  list(sessionId: string, query?: LogQuery): Promise<LogPage>
  subscribe(handler: LogRecordHandler): () => void
}

export interface SessionLogStoreOptions {
  onError?: (error: Error) => void
}

export function reportLogStoreError(handler: ((error: Error) => void) | undefined, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  if (handler !== undefined) {
    handler(normalized)
    return
  }

  process.stderr.write(`Orbit log store error: ${normalized.message}\n`)
}
