// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import type {LogPage, LogQuery, LogRecord, LogRecordHandler} from './records.js'
import type {LogStoreHealth, SessionLogStore, SessionLogStoreOptions} from './store.js'

import {logsDir} from '../app.js'
import {matchesLogQuery, normalizeLogRecord, resolveLogQueryLimit} from './records.js'
import {reportLogStoreError} from './store.js'

const APPLICATION_PARTITION = '_application'
const SAFE_PARTITION = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,255}$/u
const ACTIVE_LOG_FILE = 'events.jsonl'
const SEGMENT_LOG_FILE = /^events-(\d{13})-(\d+)\.jsonl$/u
const DEFAULT_MAX_BYTES_PER_PARTITION = 10 * 1024 * 1024
const DEFAULT_MAX_RECORDS_PER_PARTITION = 10_000
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_PENDING_RECORDS = 2048
const DEFAULT_MAX_SEGMENT_BYTES = 1024 * 1024
const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000

interface SessionWriterState {
  activeBytes: number
  closed: boolean
  failure?: Error
  file: string
  initialized: boolean
  lastRetentionAt: number
  pending: Promise<void>
  pendingRecords: number
  segmentSequence: number
  totalBytes: number
  totalRecords: number
}

interface StoredLine {
  bytes: number
  file: string
  nextOffset: number
  offset: number
  raw: string
  record: LogRecord
}

interface LogCursor {
  id: string
  offset: number
  segment: string
  version: 1
}

export interface FileSessionLogStoreOptions extends SessionLogStoreOptions {
  maxAgeMs?: number
  maxBytesPerSession?: number
  maxPendingRecords?: number
  maxRecordsPerSession?: number
  maxSegmentBytes?: number
  now?: () => number
  rootDir?: string
}

export class FileSessionLogStore implements SessionLogStore {
  readonly rootDir: string
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
  private readonly maxAgeMs: number
  private readonly maxBytesPerSession: number
  private readonly maxPendingRecords: number
  private readonly maxRecordsPerSession: number
  private readonly maxSegmentBytes: number
  private readonly now: () => number
  private readonly onError?: (error: Error) => void
  private readonly tombstones = new Set<string>()
  private readonly writers = new Map<string, SessionWriterState>()

  constructor(options: FileSessionLogStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? logsDir())
    this.onError = options.onError
    this.maxBytesPerSession = positiveInteger(
      options.maxBytesPerSession ?? DEFAULT_MAX_BYTES_PER_PARTITION,
      'maxBytesPerSession',
    )
    this.maxRecordsPerSession = positiveInteger(
      options.maxRecordsPerSession ?? DEFAULT_MAX_RECORDS_PER_PARTITION,
      'maxRecordsPerSession',
    )
    this.maxAgeMs = positiveInteger(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS, 'maxAgeMs')
    this.maxPendingRecords = positiveInteger(
      options.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS,
      'maxPendingRecords',
    )
    this.maxSegmentBytes = positiveInteger(options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES, 'maxSegmentBytes')
    this.now = options.now ?? Date.now
  }

  append(record: LogRecord): void {
    if (this.closed) throw new Error('The session log store is closed.')
    const {sessionId} = record.correlation
    const partition = this.partition(sessionId)
    if (sessionId !== undefined && this.tombstones.has(sessionId)) {
      throw new Error(`Session log partition has been deleted: ${sessionId}`)
    }

    const state = this.writer(partition)
    if (state.pendingRecords >= this.maxPendingRecords) {
      this.health.dropped += 1
      return
    }

    this.health.accepted += 1
    state.pendingRecords += 1
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line)
    const operation = state.pending.then(async () => {
      await this.initializeState(partition, state)
      if (state.activeBytes > 0 && state.activeBytes + bytes > this.maxSegmentBytes) {
        await this.rotate(partition, state)
      }

      await fs.mkdir(path.dirname(state.file), {mode: 0o700, recursive: true})
      await fs.appendFile(state.file, line, {encoding: 'utf8', mode: 0o600})
      state.activeBytes += bytes
      state.totalBytes += bytes
      state.totalRecords += 1
      this.health.written += 1
      if (
        state.totalBytes > this.maxBytesPerSession ||
        state.totalRecords > this.maxRecordsPerSession ||
        this.now() - state.lastRetentionAt >= RETENTION_CHECK_INTERVAL_MS
      ) {
        await this.enforceRetention(partition, state)
      }
    })
    state.pending = operation
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        state.failure ??= normalized
        this.health.failed += 1
        reportLogStoreError(this.onError, normalized)
      })
      .finally(() => {
        state.pendingRecords -= 1
      })
    for (const handler of this.handlers) handler(record)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await Promise.all([...this.writers.values()].map((state) => state.pending))
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

  getHealth(): LogStoreHealth {
    return {...this.health}
  }

  async list(sessionId: string, query: LogQuery = {}): Promise<LogPage> {
    const partition = this.partition(sessionId)
    await this.flush(sessionId)
    const entries = await this.readPartition(partition)
    const limit = resolveLogQueryLimit(query.limit)
    const start = findCursorIndex(entries, query.after)
    if (query.after !== undefined && start === undefined) return {data: []}
    const eligible = entries.slice((start ?? -1) + 1).filter((entry) => matchesLogQuery(entry.record, query))
    const selected = query.after === undefined ? eligible.slice(-limit) : eligible.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map((entry) => entry.record),
      ...(last === undefined ? {} : {next: encodeCursor(last)}),
    }
  }

  recordRedactions(count: number): void {
    this.health.redacted += count
  }

  subscribe(handler: LogRecordHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private async enforceRetention(partition: string, state: SessionWriterState): Promise<void> {
    const entries = await this.readPartition(partition)
    const cutoff = this.now() - this.maxAgeMs
    const keptNewest: StoredLine[] = []
    let keptBytes = 0
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (Date.parse(entry.record.timestamp) < cutoff) continue
      if (keptNewest.length >= this.maxRecordsPerSession) continue
      if (keptBytes + entry.bytes > this.maxBytesPerSession && keptNewest.length > 0) continue
      keptNewest.push(entry)
      keptBytes += entry.bytes
    }

    const kept = keptNewest.reverse()
    const dropped = entries.length - kept.length
    if (dropped > 0 || (await this.segmentFiles(partition)).length > 1) {
      const directory = this.partitionDirectory(partition)
      await fs.mkdir(directory, {mode: 0o700, recursive: true})
      const content = kept.map((entry) => entry.raw).join('')
      await Promise.all(
        (await this.segmentFiles(partition)).map((file) => fs.rm(path.join(directory, file), {force: true})),
      )
      await fs.writeFile(state.file, content, {encoding: 'utf8', mode: 0o600})
      this.health.dropped += dropped
      state.activeBytes = Buffer.byteLength(content)
      state.totalBytes = state.activeBytes
      state.totalRecords = kept.length
    }

    state.lastRetentionAt = this.now()
  }

  private async initializeState(partition: string, state: SessionWriterState): Promise<void> {
    if (state.initialized) return
    await repairIncompleteFinalLine(state.file)
    const segmentFiles = await this.segmentFiles(partition)
    state.segmentSequence = nextSegmentSequence(segmentFiles)
    const entries = await this.readPartition(partition)
    state.totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0)
    state.totalRecords = entries.length
    state.activeBytes = await fileSize(state.file)
    state.initialized = true
  }

  private logFile(partition: string): string {
    return path.join(this.partitionDirectory(partition), ACTIVE_LOG_FILE)
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

  private async readPartition(partition: string): Promise<StoredLine[]> {
    const directory = this.partitionDirectory(partition)
    const entries: StoredLine[] = []
    for (const file of await this.segmentFiles(partition)) {
      const fullPath = path.join(directory, file)
      // Segments are read sequentially to preserve their stable file order.
      // eslint-disable-next-line no-await-in-loop
      const buffer = await fs.readFile(fullPath)
      let offset = 0
      while (offset < buffer.length) {
        const newline = buffer.indexOf(0x0a, offset)
        if (newline === -1) break
        const nextOffset = newline + 1
        if (newline > offset) {
          const raw = buffer.subarray(offset, nextOffset).toString('utf8')
          try {
            entries.push({
              bytes: nextOffset - offset,
              file,
              nextOffset,
              offset,
              raw,
              record: normalizeLogRecord(JSON.parse(raw)),
            })
          } catch (error) {
            throw new Error(`Invalid record in session log file ${fullPath} at byte ${offset}.`, {cause: error})
          }
        }

        offset = nextOffset
      }
    }

    return entries
  }

  private async rotate(partition: string, state: SessionWriterState): Promise<void> {
    if (!(await pathExists(state.file))) return
    const directory = this.partitionDirectory(partition)
    const segment = `events-${String(this.now()).padStart(13, '0')}-${String(state.segmentSequence).padStart(
      6,
      '0',
    )}.jsonl`
    state.segmentSequence += 1
    await fs.rename(state.file, path.join(directory, segment))
    state.activeBytes = 0
    this.health.rotated += 1
  }

  private async segmentFiles(partition: string): Promise<string[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.partitionDirectory(partition))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }

    const rotated = names.filter((name) => SEGMENT_LOG_FILE.test(name)).sort()
    return [...rotated, ...(names.includes(ACTIVE_LOG_FILE) ? [ACTIVE_LOG_FILE] : [])]
  }

  private writer(partition: string): SessionWriterState {
    const existing = this.writers.get(partition)
    if (existing !== undefined && !existing.closed) return existing
    const state: SessionWriterState = {
      activeBytes: 0,
      closed: false,
      file: this.logFile(partition),
      initialized: false,
      lastRetentionAt: 0,
      pending: Promise.resolve(),
      pendingRecords: 0,
      segmentSequence: 0,
      totalBytes: 0,
      totalRecords: 0,
    }
    this.writers.set(partition, state)
    return state
  }
}

function encodeCursor(entry: StoredLine): string {
  const cursor: LogCursor = {
    id: entry.record.id,
    offset: entry.nextOffset,
    segment: entry.file,
    version: 1,
  }
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(value: string): LogCursor | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<LogCursor>
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== 'string' ||
      typeof parsed.segment !== 'string' ||
      typeof parsed.offset !== 'number'
    ) {
      return undefined
    }

    return parsed as LogCursor
  } catch {
    return undefined
  }
}

function findCursorIndex(entries: StoredLine[], after: string | undefined): number | undefined {
  if (after === undefined) return -1
  const cursor = decodeCursor(after)
  if (cursor !== undefined) {
    const located = entries.findIndex(
      (entry) => entry.file === cursor.segment && entry.nextOffset === cursor.offset && entry.record.id === cursor.id,
    )
    if (located !== -1) return located
  }

  const legacy = entries.findIndex((entry) => entry.record.id === after || entry.record.id === cursor?.id)
  return legacy === -1 ? undefined : legacy
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
  return value
}

function nextSegmentSequence(files: string[]): number {
  let maximum = 0
  for (const file of files) {
    const match = SEGMENT_LOG_FILE.exec(file)
    if (match !== null) maximum = Math.max(maximum, Number(match[2]) + 1)
  }

  return maximum
}

async function repairIncompleteFinalLine(file: string): Promise<void> {
  let buffer: Buffer
  try {
    buffer = await fs.readFile(file)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }

  if (buffer.length === 0 || buffer.at(-1) === 0x0a) return
  const newline = buffer.lastIndexOf(0x0a)
  await fs.truncate(file, newline + 1)
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return 0
    throw error
  }
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
