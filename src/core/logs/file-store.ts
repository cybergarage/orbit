// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createReadStream} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'
import type {SessionLogStore, SessionLogStoreOptions} from './store.js'

import {logsDir} from '../app.js'
import {matchesLogQuery, resolveLogQueryLimit} from './records.js'
import {reportLogStoreError} from './store.js'

const APPLICATION_PARTITION = '_application'
const SAFE_PARTITION = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,255}$/u

interface SessionWriterState {
  closed: boolean
  failure?: Error
  file: string
  pending: Promise<void>
}

export interface FileSessionLogStoreOptions extends SessionLogStoreOptions {
  rootDir?: string
}

export class FileSessionLogStore implements SessionLogStore {
  readonly rootDir: string
  private closed = false
  private readonly handlers = new Set<LogRecordHandler>()
  private readonly onError?: (error: Error) => void
  private readonly tombstones = new Set<string>()
  private readonly writers = new Map<string, SessionWriterState>()

  constructor(options: FileSessionLogStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? logsDir())
    this.onError = options.onError
  }

  append(record: LogRecord): void {
    if (this.closed) throw new Error('The session log store is closed.')
    const partition = this.partition(record.sessionId)
    if (record.sessionId !== undefined && this.tombstones.has(record.sessionId)) {
      throw new Error(`Session log partition has been deleted: ${record.sessionId}`)
    }

    const state = this.writer(partition)
    const line = `${JSON.stringify(record)}\n`
    const operation = state.pending.then(async () => {
      await fs.mkdir(path.dirname(state.file), {mode: 0o700, recursive: true})
      await fs.appendFile(state.file, line, {encoding: 'utf8', mode: 0o600})
    })
    state.pending = operation.catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      state.failure ??= normalized
      reportLogStoreError(this.onError, normalized)
    })
    for (const handler of this.handlers) handler(record)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.flush()
    } finally {
      this.writers.clear()
      this.handlers.clear()
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const partition = this.partition(sessionId)
    const state = this.writers.get(partition)
    if (state === undefined) return
    state.closed = true
    await state.pending
    if (state.failure !== undefined) throw state.failure
    this.writers.delete(partition)
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const partition = this.partition(sessionId)
    this.tombstones.add(sessionId)
    await this.closeSession(sessionId)
    const directory = this.partitionDirectory(partition)
    const existed = await pathExists(directory)
    await fs.rm(directory, {force: true, recursive: true})
    return existed
  }

  async flush(sessionId?: string): Promise<void> {
    const states =
      sessionId === undefined
        ? [...this.writers.values()]
        : [this.writers.get(this.partition(sessionId))].filter(
            (state): state is SessionWriterState => state !== undefined,
          )
    await Promise.all(states.map((state) => state.pending))
    const failure = states.find((state) => state.failure !== undefined)?.failure
    if (failure !== undefined) throw failure
  }

  async list(sessionId: string, query: LogQuery = {}): Promise<LogPage> {
    const partition = this.partition(sessionId)
    await this.flush(sessionId)
    const file = this.logFile(partition)
    const limit = resolveLogQueryLimit(query.limit)
    const data: LogRecord[] = []
    let afterFound = query.after === undefined
    let hasMore = false
    try {
      const lines = readline.createInterface({crlfDelay: Infinity, input: createReadStream(file, {encoding: 'utf8'})})
      for await (const line of lines) {
        if (line.length === 0) continue
        const record = parseLogRecord(line, file)
        if (!afterFound) {
          afterFound = record.id === query.after
          continue
        }

        if (!matchesLogQuery(record, query)) continue
        if (query.after === undefined) {
          data.push(record)
          if (data.length > limit) data.shift()
        } else if (data.length < limit) {
          data.push(record)
        } else {
          hasMore = true
          break
        }
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return {data: []}
      throw error
    }

    return {...(hasMore ? {next: data.at(-1)?.id} : {}), data}
  }

  subscribe(handler: LogRecordHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private logFile(partition: string): string {
    return path.join(this.partitionDirectory(partition), 'events.jsonl')
  }

  private partition(sessionId: string | undefined): string {
    const partition = sessionId ?? APPLICATION_PARTITION
    if (sessionId === APPLICATION_PARTITION) throw new Error(`Reserved session log identifier: ${sessionId}`)
    if (!SAFE_PARTITION.test(partition)) throw new Error(`Invalid session log identifier: ${partition}`)
    return partition
  }

  private partitionDirectory(partition: string): string {
    const directory = path.resolve(this.rootDir, partition)
    if (path.dirname(directory) !== this.rootDir) throw new Error(`Invalid session log identifier: ${partition}`)
    return directory
  }

  private writer(partition: string): SessionWriterState {
    const existing = this.writers.get(partition)
    if (existing !== undefined && !existing.closed) return existing
    const state: SessionWriterState = {
      closed: false,
      file: this.logFile(partition),
      pending: Promise.resolve(),
    }
    this.writers.set(partition, state)
    return state
  }
}

function parseLogRecord(line: string, file: string): LogRecord {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new Error(`Invalid JSON in session log file ${file}.`, {cause: error})
  }

  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1) {
    throw new Error(`Unsupported record in session log file ${file}.`)
  }

  return value as LogRecord
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
