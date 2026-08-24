// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'
import type {LogStoreHealth, SessionLogStore} from './store.js'

import {matchesLogQuery, resolveLogQueryLimit} from './records.js'

const APPLICATION_PARTITION = '\0application'

export interface MemorySessionLogStoreOptions {
  maxRecordsPerSession?: number
}

export class MemorySessionLogStore implements SessionLogStore {
  private closed = false
  private readonly handlers = new Set<LogRecordHandler>()
  private readonly health: LogStoreHealth = {
    accepted: 0,
    dropped: 0,
    failed: 0,
    redacted: 0,
    rotated: 0,
    written: 0,
  }
  private readonly maxRecordsPerSession: number
  private readonly partitions = new Map<string, LogRecord[]>()
  private readonly tombstones = new Set<string>()

  constructor(options: MemorySessionLogStoreOptions = {}) {
    this.maxRecordsPerSession = options.maxRecordsPerSession ?? 1000
    if (!Number.isSafeInteger(this.maxRecordsPerSession) || this.maxRecordsPerSession < 1) {
      throw new Error('maxRecordsPerSession must be a positive integer.')
    }
  }

  append(record: LogRecord): void {
    if (this.closed) throw new Error('The session log store is closed.')
    const {sessionId} = record.correlation
    const partition = sessionId ?? APPLICATION_PARTITION
    if (sessionId !== undefined && this.tombstones.has(sessionId)) {
      throw new Error(`Session log partition has been deleted: ${sessionId}`)
    }

    this.health.accepted += 1
    const records = this.partitions.get(partition) ?? []
    records.push(record)
    if (records.length > this.maxRecordsPerSession) {
      const dropped = records.length - this.maxRecordsPerSession
      records.splice(0, dropped)
      this.health.dropped += dropped
    }

    this.health.written += 1
    this.partitions.set(partition, records)
    for (const handler of this.handlers) handler(record)
  }

  async close(): Promise<void> {
    this.closed = true
    this.handlers.clear()
  }

  async closeSession(_sessionId: string): Promise<void> {}

  async deleteSession(sessionId: string): Promise<boolean> {
    this.tombstones.add(sessionId)
    return this.partitions.delete(sessionId)
  }

  async flush(_sessionId?: string): Promise<void> {}

  getHealth(): LogStoreHealth {
    return {...this.health}
  }

  async list(sessionId: string, query: LogQuery = {}): Promise<LogPage> {
    const limit = resolveLogQueryLimit(query.limit)
    const records = this.partitions.get(sessionId) ?? []
    const afterIndex = query.after === undefined ? -1 : records.findIndex((record) => record.id === query.after)
    if (query.after !== undefined && afterIndex === -1) return {data: []}
    const eligible = records.slice(afterIndex + 1).filter((record) => matchesLogQuery(record, query))
    const data = query.after === undefined ? eligible.slice(-limit) : eligible.slice(0, limit)
    return {
      data: [...data],
      ...(query.after !== undefined && data.length === limit && data.length < eligible.length
        ? {next: data.at(-1)?.id}
        : {}),
    }
  }

  recordRedactions(count: number): void {
    this.health.redacted += count
  }

  subscribe(handler: LogRecordHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
}
