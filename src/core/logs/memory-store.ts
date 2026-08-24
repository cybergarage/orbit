// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'
import type {SessionLogStore} from './store.js'

import {matchesLogQuery, resolveLogQueryLimit} from './records.js'

const APPLICATION_PARTITION = '\0application'

export interface MemorySessionLogStoreOptions {
  maxRecordsPerSession?: number
}

export class MemorySessionLogStore implements SessionLogStore {
  private closed = false
  private readonly handlers = new Set<LogRecordHandler>()
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
    const partition = record.sessionId ?? APPLICATION_PARTITION
    if (record.sessionId !== undefined && this.tombstones.has(record.sessionId)) {
      throw new Error(`Session log partition has been deleted: ${record.sessionId}`)
    }

    const records = this.partitions.get(partition) ?? []
    records.push(record)
    if (records.length > this.maxRecordsPerSession) records.splice(0, records.length - this.maxRecordsPerSession)
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

  subscribe(handler: LogRecordHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
}
