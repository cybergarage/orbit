// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHmac, randomBytes, randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {SessionWriterLease} from '../session/writer-lease.js'

import {consumeWriterLease} from '../session/writer-lease.js'

export type JournalLevel = 'file-and-directory-sync' | 'file-sync' | 'memory'
export type JournalKind =
  | 'approval-requested'
  | 'authorization-decided'
  | 'late-settlement'
  | 'operation-intent'
  | 'operation-result'
  | 'run-admitted'
  | 'run-ready'
  | 'run-terminal'
  | 'stop-requested'
export interface JournalRecord {
  data: Record<string, unknown>
  elapsedMs: number
  eventId: string
  kind: JournalKind
  runId: string
  sequence: number
  sessionId: string
  timestamp: string
  version: 1
}
export interface ExecutionJournal {
  append(
    runId: string,
    kind: JournalKind,
    data: Record<string, unknown>,
    elapsedMs?: number,
    eventId?: string,
  ): Promise<JournalRecord>
  close(): Promise<void>
  digest(value: unknown): string
  readonly level: JournalLevel
  readonly mode: 'file' | 'memory'
  records(): JournalRecord[]
}

/** Reject lossy JSON before binding an operation or accepting a replay key. */
export function canonicalJSON(value: unknown): string {
  const seen = new Set<object>()
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object' || item === null || seen.has(item)) throw new Error('Value is not canonical JSON')
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('Only plain JSON objects are supported')
    seen.add(item)
    const result = Array.isArray(item)
      ? `[${Array.from(item, encode).join(',')}]`
      : `{${Object.keys(item)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`)
          .join(',')}}`
    seen.delete(item)
    return result
  }

  return encode(value)
}

export function copyJSON<T>(value: T): T {
  return JSON.parse(canonicalJSON(value)) as T
}

export function safeIdentity(id: string): string {
  if (id === 'deletions' || !/^[A-Za-z0-9_-]{1,160}$/u.test(id)) throw new Error('Invalid execution identity')
  return id
}

export class MemoryExecutionJournal implements ExecutionJournal {
  protected entries: JournalRecord[] = []
  protected key = randomBytes(32)
  readonly level: JournalLevel = 'memory'
  readonly mode: 'file' | 'memory' = 'memory'
  protected queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private closePromise?: Promise<void>

  constructor(
    protected readonly sessionId: string,
    private readonly releaseMemoryLease?: () => void,
  ) {
    safeIdentity(sessionId)
  }

  append(
    runId: string,
    kind: JournalKind,
    data: Record<string, unknown>,
    elapsedMs = 0,
    eventId: string = randomUUID(),
  ): Promise<JournalRecord> {
    safeIdentity(runId)
    if (this.closed) return Promise.reject(new Error('Execution journal is closed'))
    const frozenData = copyJSON(data)
    const next = this.queue.then(async () => {
      const existing = this.entries.find((record) => record.eventId === eventId)
      if (existing) {
        if (
          existing.runId !== runId ||
          existing.kind !== kind ||
          canonicalJSON(existing.data) !== canonicalJSON(frozenData)
        )
          throw new Error('Conflicting journal event ID')
        return copyJSON(existing)
      }

      const record: JournalRecord = {
        data: frozenData,
        elapsedMs,
        eventId,
        kind,
        runId,
        sequence: this.entries.filter((entry) => entry.runId === runId).length + 1,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        version: 1,
      }
      validateNext(this.entries, record)
      await this.persist(record)
      this.entries.push(record)
      return copyJSON(record)
    })
    // A failed write poisons subsequent appends; attach a handler without clearing the failure.
    this.queue = next
    next.catch(() => {})
    return next
  }

  close(): Promise<void> {
    this.closed = true
    this.closePromise ??= this.queue.then(() => {}).finally(() => this.releaseMemoryLease?.())
    return this.closePromise
  }

  digest(value: unknown): string {
    return createHmac('sha256', this.key).update(canonicalJSON(value)).digest('hex')
  }

  protected async persist(_record: JournalRecord): Promise<void> {}

  records(): JournalRecord[] {
    return copyJSON(this.entries)
  }
}

export interface FileExecutionJournalOptions {
  io?: typeof fs
  /** Delegates the already-held SessionRecorder writer authority; no second lock. */
  lease: SessionWriterLease
  level?: Exclude<JournalLevel, 'memory'>
  root: string
}

export class FileExecutionJournal extends MemoryExecutionJournal {
  override readonly level: Exclude<JournalLevel, 'memory'>
  override readonly mode = 'file' as const
  private fileClosePromise?: Promise<void>
  private readonly io: typeof fs
  private released = false
  private readonly root: string

  private constructor(
    sessionId: string,
    options: FileExecutionJournalOptions,
    private readonly releaseWriter: () => void,
  ) {
    super(sessionId)
    this.root = path.resolve(options.root)
    this.level = options.level ?? 'file-and-directory-sync'
    if (!['file-and-directory-sync', 'file-sync'].includes(this.level))
      throw new Error('Unsupported journal acknowledgement level')
    this.io = options.io ?? fs
  }

  static async open(sessionId: string, options: FileExecutionJournalOptions): Promise<FileExecutionJournal> {
    const release = consumeWriterLease(options.lease, sessionId, options.root)
    try {
      const journal = new FileExecutionJournal(sessionId, options, release)
      await journal.load()
      return journal
    } catch (error) {
      release()
      throw error
    }
  }

  override close(): Promise<void> {
    this.fileClosePromise ??= super.close().finally(() => {
      if (!this.released) {
        this.released = true
        this.releaseWriter()
      }
    })
    return this.fileClosePromise
  }

  protected override async persist(record: JournalRecord): Promise<void> {
    const directory = path.join(this.root, this.sessionId, record.runId)
    await syncDirectories(directory, this.level, this.io)
    const file = path.join(directory, 'events.jsonl')
    const handle = await this.io.open(file, 'a', 0o600)
    try {
      const encoded = Buffer.from(`${canonicalJSON(record)}\n`)
      let offset = 0
      while (offset < encoded.length) {
        // Preserve ordered filesystem acknowledgements before continuing.
        // eslint-disable-next-line no-await-in-loop
        const {bytesWritten} = await handle.write(encoded, offset, encoded.length - offset)
        if (bytesWritten <= 0) throw new Error('Incomplete execution journal write')
        offset += bytesWritten
      }

      await handle.sync()
    } finally {
      await handle.close()
    }

    if (this.level === 'file-and-directory-sync') await syncDirectory(directory, this.io)
  }

  private async load(): Promise<void> {
    const marker = path.join(this.root, 'deletions', `${this.sessionId}.json`)
    if (await exists(marker, this.io)) throw new Error('Session deletion is recorded; create a new session')
    const directory = path.join(this.root, this.sessionId)
    await syncDirectories(directory, this.level, this.io)
    const children = await this.io.readdir(directory, {withFileTypes: true})
    const keyFile = path.join(directory, 'key')
    try {
      this.key = await this.io.readFile(keyFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (children.some((entry) => entry.isDirectory()))
        throw new Error('Journal key missing; read-only recovery required')
      const handle = await this.io.open(keyFile, 'wx', 0o600)
      try {
        await handle.writeFile(this.key)
        await handle.sync()
      } finally {
        await handle.close()
      }
    }

    if (this.key.length !== 32) throw new Error('Invalid journal key; read-only recovery required')
    // Re-sync existing keys too: existence does not establish a prior acknowledgement.
    const keyHandle = await this.io.open(keyFile, 'r+')
    try {
      await keyHandle.sync()
    } finally {
      await keyHandle.close()
    }

    if (this.level === 'file-and-directory-sync') await syncDirectory(directory, this.io)
    for (const child of children) {
      if (!child.isDirectory()) continue
      safeIdentity(child.name)
      const file = path.join(directory, child.name, 'events.jsonl')
      // Preserve ordered filesystem acknowledgements before continuing.
      // eslint-disable-next-line no-await-in-loop
      const contents = await this.io.readFile(file, 'utf8')
      // Preserve ordered filesystem acknowledgements before continuing.
      // eslint-disable-next-line no-await-in-loop
      const handle = await this.io.open(file, 'r+')
      try {
        // Preserve ordered filesystem acknowledgements before continuing.
        // eslint-disable-next-line no-await-in-loop
        await handle.sync()
      } finally {
        // Preserve ordered filesystem acknowledgements before continuing.
        // eslint-disable-next-line no-await-in-loop
        await handle.close()
      }

      if (!contents.endsWith('\n')) throw new Error('Torn execution journal; read-only recovery required')
      for (const line of contents.trimEnd().split('\n')) {
        const record = JSON.parse(line) as JournalRecord
        if (record.sessionId !== this.sessionId || record.runId !== child.name)
          throw new Error('Journal identity mismatch')
        validateNext(this.entries, record)
        this.entries.push(record)
      }
    }
  }
}

export function validateNext(entries: JournalRecord[], record: JournalRecord): void {
  if (Buffer.byteLength(canonicalJSON(record)) > 1_048_576)
    throw new Error('Execution metadata exceeds the record limit')
  const allowed: Record<JournalKind, string[]> = {
    'approval-requested': ['digest', 'expiresAt', 'operationId', 'policy', 'requestId', 'responderScope'],
    'authorization-decided': [
      'approve',
      'decision',
      'digest',
      'operationId',
      'policy',
      'reason',
      'requestId',
      'responderScope',
    ],
    'late-settlement': ['settled', 'operations'],
    'operation-intent': [
      'authorization',
      'budget',
      'catalog',
      'call',
      'source',
      'digest',
      'effect',
      'operationId',
      'variant',
    ],
    'operation-result': ['operationId', 'status', 'outputDigest'],
    'run-admitted': ['configuration', 'level', 'limits', 'mode', 'requestDigest', 'requestId'],
    'run-ready': ['catalog'],
    'run-terminal': [
      'cleanupErrors',
      'operations',
      'outcome',
      'quiescence',
      'reason',
      'recording',
      'runId',
      'sessionId',
      'stopRequest',
      'unresolved',
      'transcriptHighWater',
    ],
    'stop-requested': ['reason'],
  }
  if (
    !allowed[record.kind] ||
    !record.data ||
    Object.keys(record.data).some((key) => !allowed[record.kind].includes(key))
  )
    throw new Error('Unsupported execution metadata')
  safeIdentity(record.runId)
  safeIdentity(record.sessionId)
  safeIdentity(record.eventId)
  if (typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp)) || record.elapsedMs < 0)
    throw new Error('Invalid journal envelope')
  const run = entries.filter((entry) => entry.runId === record.runId)
  if (
    record.version !== 1 ||
    !Number.isFinite(record.elapsedMs) ||
    record.sequence !== run.length + 1 ||
    typeof record.eventId !== 'string' ||
    entries.some((entry) => entry.eventId === record.eventId)
  )
    throw new Error('Invalid journal ordering or version')
  if (record.kind === 'late-settlement' && !run.some((entry) => entry.kind === 'run-terminal'))
    throw new Error('Settlement evidence requires a terminal record')
  if (
    ['operation-intent', 'operation-result'].includes(record.kind) &&
    run.some((entry) => entry.kind === record.kind && entry.data.operationId === record.data.operationId)
  )
    throw new Error('Duplicate operation record')
  if (run.length === 0 && record.kind !== 'run-admitted') throw new Error('Admission must precede execution records')
  if (run.length > 0 && record.kind === 'run-admitted') throw new Error('Duplicate admission')
  if (record.kind === 'run-ready' && run.some((entry) => entry.kind === 'run-ready'))
    throw new Error('Duplicate ready record')
  if (record.kind === 'run-terminal' && run.some((entry) => entry.kind === 'run-terminal'))
    throw new Error('Duplicate terminal record')
  if (run.some((entry) => entry.kind === 'run-terminal') && record.kind !== 'late-settlement')
    throw new Error('Execution after terminal record')
  if (
    record.kind === 'operation-intent' &&
    record.data.variant === 'tool-call' &&
    !run.some((entry) => entry.kind === 'run-ready')
  )
    throw new Error('Tool intent before ready')
}

export async function exists(file: string, io = fs): Promise<boolean> {
  try {
    await io.stat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function syncDirectory(directory: string, io = fs): Promise<void> {
  const handle = await io.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function syncDirectories(directory: string, level: JournalLevel, io = fs): Promise<void> {
  const missing: string[] = []
  let current = path.resolve(directory)
  // Preserve ordered filesystem acknowledgements before continuing.
  // eslint-disable-next-line no-await-in-loop
  while (!(await exists(current, io))) {
    missing.push(current)
    current = path.dirname(current)
  }

  for (const next of missing.reverse()) {
    // Preserve ordered filesystem acknowledgements before continuing.
    // eslint-disable-next-line no-await-in-loop
    await io.mkdir(next, {mode: 0o700}).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    // Preserve ordered filesystem acknowledgements before continuing.
    // eslint-disable-next-line no-await-in-loop
    if (level === 'file-and-directory-sync') await syncDirectory(path.dirname(next), io)
  }

  if (level === 'file-and-directory-sync') {
    let ancestor = path.resolve(directory)
    while (true) {
      // Preserve ordered filesystem acknowledgements before continuing.
      // eslint-disable-next-line no-await-in-loop
      await syncDirectory(ancestor, io)
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }
  }
}
