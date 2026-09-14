// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHmac, randomBytes, randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {SessionWriterLease} from '../session/writer-lease.js'

import {consumeWriterLease} from '../session/writer-lease.js'
import {validateGraphRecord} from './graph-journal.js'

export type JournalLevel = 'file-and-directory-sync' | 'file-sync' | 'memory'
export type JournalKind =
  | 'approval-requested'
  | 'authorization-decided'
  | 'graph-bound'
  | 'graph-node-completed'
  | 'graph-node-started'
  | 'graph-transition'
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
  version: 1 | 2
}
export interface ExecutionJournal {
  append(
    runId: string,
    kind: JournalKind,
    data: Record<string, unknown>,
    elapsedMs?: number,
    eventId?: string,
    version?: 1 | 2,
  ): Promise<JournalRecord>
  close(): Promise<void>
  digest(value: unknown): string
  readonly level: JournalLevel
  readonly mode: 'file' | 'memory'
  records(): JournalRecord[]
  verifyContextEvidence?(maxBytes: number): Promise<JournalRecord[]>
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
    version?: 1 | 2,
  ): Promise<JournalRecord> {
    safeIdentity(runId)
    if (this.closed) return Promise.reject(new Error('Execution journal is closed'))
    const frozenData = copyJSON(data)
    const next = this.queue.then(async () => {
      const existing = this.entries.find((record) => record.eventId === eventId)
      if (existing) {
        if (
          (version !== undefined && existing.version !== version) ||
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
        version: version ?? this.entries.find((entry) => entry.runId === runId)?.version ?? 1,
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

  async verifyContextEvidence(maxBytes: number): Promise<JournalRecord[]> {
    if (this.closed) throw new Error('Context evidence journal is closed')
    await this.queue
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || Buffer.byteLength(canonicalJSON(this.entries)) > maxBytes)
      throw new Error('Context evidence exceeds the read limit')
    const records = this.records()
    const checked: JournalRecord[] = []
    for (const record of records) {
      validateNext(checked, record)
      checked.push(record)
    }

    return records
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

  override async verifyContextEvidence(maxBytes: number): Promise<JournalRecord[]> {
    const expected = await super.verifyContextEvidence(maxBytes)
    let remaining = maxBytes
    const read = async (file: string): Promise<Buffer> => {
      // O_NOFOLLOW prevents evidence from being replaced with a symbolic link.
      // eslint-disable-next-line no-bitwise
      const handle = await this.io.open(file, constants.O_RDWR | constants.O_NOFOLLOW)
      try {
        const before = await handle.stat()
        if (!before.isFile() || before.nlink !== 1 || before.size > remaining)
          throw new Error('Invalid bounded context evidence file')
        const chunks: Buffer[] = []
        for (;;) {
          const buffer = Buffer.alloc(Math.min(65_536, remaining + 1))
          // Ordered bounded reads belong to one owned evidence operation.
          // eslint-disable-next-line no-await-in-loop
          const {bytesRead} = await handle.read(buffer, 0, buffer.length, null)
          if (!bytesRead) break
          remaining -= bytesRead
          if (remaining < 0) throw new Error('Context evidence exceeds the read limit')
          chunks.push(buffer.subarray(0, bytesRead))
        }

        const after = await handle.stat()
        const named = await this.io.lstat(file)
        if (
          named.isSymbolicLink() ||
          named.dev !== before.dev ||
          named.ino !== before.ino ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs
        )
          throw new Error('Context evidence changed during read')
        await handle.sync()
        return Buffer.concat(chunks)
      } finally {
        await handle.close()
      }
    }

    const directory = path.join(this.root, this.sessionId)
    const key = await read(path.join(directory, 'key'))
    if (!key.equals(this.key)) throw new Error('Context evidence key changed')
    const records: JournalRecord[] = []
    for (const child of await this.io.readdir(directory, {withFileTypes: true})) {
      if (child.name === 'key') continue
      if (!child.isDirectory()) throw new Error('Ambiguous context evidence directory')
      safeIdentity(child.name)
      const dir = path.join(directory, child.name)
      // Each file and directory acknowledgement precedes evidence use.
      // eslint-disable-next-line no-await-in-loop
      const bytes = await read(path.join(dir, 'events.jsonl'))
      const contents = new TextDecoder('utf8', {fatal: true}).decode(bytes)
      if (!contents.endsWith('\n')) throw new Error('Torn context evidence')
      for (const line of contents.trimEnd().split('\n')) {
        const record = JSON.parse(line) as JournalRecord
        if (record.sessionId !== this.sessionId || record.runId !== child.name)
          throw new Error('Context evidence identity mismatch')
        validateNext(records, record)
        records.push(record)
      }

      // eslint-disable-next-line no-await-in-loop
      if (this.level === 'file-and-directory-sync') await syncDirectory(dir, this.io)
    }

    if (this.level === 'file-and-directory-sync') await syncDirectory(directory, this.io)
    const ordered = (value: JournalRecord[]) =>
      [...value].sort((a, b) => a.runId.localeCompare(b.runId) || a.sequence - b.sequence)
    if (canonicalJSON(ordered(records)) !== canonicalJSON(ordered(expected)))
      throw new Error('Context evidence diverged from journal')
    return records
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
    'graph-bound': ['graph', 'descriptor', 'configuration', 'profile', 'turnId'],
    'graph-node-completed': [
      'graph',
      'nodeId',
      'visitId',
      'outputDigest',
      'outcome',
      'operations',
      'messages',
      'transcriptHighWater',
    ],
    'graph-node-started': ['graph', 'nodeId', 'visitId', 'visit', 'inputDigest', 'budget', 'transcriptHighWater'],
    'graph-transition': ['graph', 'visitId', 'edgeId', 'destination', 'label', 'outputDigest'],
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
    'run-admitted': ['configuration', 'level', 'limits', 'mode', 'requestDigest', 'requestId', 'skills'],
    'run-ready': ['catalog', 'skills'],
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
    Object.keys(record.data).some(
      (key) =>
        !allowed[record.kind].includes(key) &&
        !(
          record.version === 2 &&
          ((['operation-intent', 'operation-result'].includes(record.kind) && key === 'visitId') ||
            (record.kind === 'run-ready' && key === 'transcriptHighWater'))
        ),
    )
  )
    throw new Error('Unsupported execution metadata')
  safeIdentity(record.runId)
  safeIdentity(record.sessionId)
  safeIdentity(record.eventId)
  if (typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp)) || record.elapsedMs < 0)
    throw new Error('Invalid journal envelope')
  const run = entries.filter((entry) => entry.runId === record.runId)
  validateGraphRecord(entries, record)
  validateSkillEvidence(record, run)
  if (
    ![1, 2].includes(record.version) ||
    (run.length > 0 && run[0].version !== record.version) ||
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

function validateSkillEvidence(record: JournalRecord, run: JournalRecord[]): void {
  const selected = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid journal Skill selections')
    const ids = new Set<string>()
    for (const item of value) {
      if (
        !item ||
        Object.keys(item).sort().join(',') !== 'digest,id' ||
        typeof item.id !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(item.id) ||
        typeof item.digest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(item.digest) ||
        ids.has(item.id)
      )
        throw new Error('Invalid journal Skill identity')
      ids.add(item.id)
    }

    return value
  }

  if (record.kind === 'run-admitted' && record.data.skills !== undefined) selected(record.data.skills)
  if (record.kind !== 'run-ready') return
  const requested = run.find((entry) => entry.kind === 'run-admitted')?.data.skills
  if (requested === undefined && record.data.skills === undefined) return
  const evidence = record.data.skills as undefined | {resolved: unknown; snapshotId: string}
  if (
    !evidence ||
    Object.keys(evidence).sort().join(',') !== 'resolved,snapshotId' ||
    typeof evidence.snapshotId !== 'string' ||
    !evidence.snapshotId ||
    canonicalJSON(selected(evidence.resolved)) !== canonicalJSON(selected(requested))
  )
    throw new Error('Skill readiness must match the admitted ordered selection')
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
