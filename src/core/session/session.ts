// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {JournalLevel} from '../execution/journal.js'
import type {ExecutionLimit} from '../execution/limits.js'
import type {Message} from '../message/index.js'
import type {ProviderName} from '../models/provider.js'
import type {SessionSkillEntry} from '../skills/record.js'
import type {SessionCompactionEntry} from './compaction.js'
import type {
  PersistedMessage,
  SessionEntry,
  SessionError,
  SessionMessageEntry,
  SessionMetadata,
  SessionTurnContextEntry,
  SessionTurnEventEntry,
  TurnPhase,
} from './entries.js'
import type {ContextProjectionEntry} from './interrupted-context.js'
import type {SessionRecorder} from './recorder.js'
import type {SessionWriterLease} from './writer-lease.js'

import {Message as CoreMessage} from '../message/index.js'
import {parseSkillEntry, validateSkillEntries} from '../skills/record.js'
import {parseSessionFile} from './codec.js'
import {validateCompactionEntries} from './compaction.js'
import {SessionEntryType} from './entries.js'
import {SessionHeader} from './header.js'
import {validateContextProjectionEntries} from './interrupted-context.js'

export interface AppendMessageOptions {
  iteration?: number
  turnId?: string
}

export interface RecordTurnContextOptions {
  cwd: string
  maxToolIterations: ExecutionLimit
  model: string
  provider: ProviderName
  turnId: string
}

export interface RecordTurnEventOptions {
  error?: SessionError
  phase: TurnPhase
  turnId: string
}

export interface SessionOptions {
  entries?: SessionEntry[]
  formatVersion?: 1 | 2 | 3
  journalRoot?: string
  messages?: Message[]
  metadata?: Partial<SessionMetadata>
  recorder?: SessionRecorder
}

export class Session {
  readonly formatVersion: 1 | 2 | 3
  readonly journalRoot?: string
  private activeCompaction?: SessionCompactionEntry
  private closePromise?: Promise<void>
  private closing = false
  private compactionSaving = false
  private readonly entries: SessionEntry[]
  private ephemeralLease = false
  private readonly messageIds = new Set<string>()
  private readonly messages: Message[] = []
  private readonly metadata: SessionMetadata
  private readonly recorder?: SessionRecorder
  private releaseEphemeral?: () => void

  // Metadata hydration keeps all optional persisted fields explicit at this public construction boundary.
  // eslint-disable-next-line complexity
  constructor(options: SessionOptions = {}) {
    const createdAt = options.metadata?.createdAt ?? new Date().toISOString()
    const id = options.metadata?.id ?? uuidv7()
    const rootMessageId = options.metadata?.rootMessageId ?? uuidv7()
    this.metadata = {
      createdAt,
      cwd: options.metadata?.cwd ?? process.cwd(),
      ...(options.metadata?.file === undefined ? {} : {file: options.metadata.file}),
      id,
      ...(options.metadata?.model === undefined ? {} : {model: options.metadata.model}),
      ...(options.metadata?.originator === undefined ? {} : {originator: options.metadata.originator}),
      ...(options.metadata?.provider === undefined ? {} : {provider: options.metadata.provider}),
      rootMessageId,
      ...(options.metadata?.systemPrompt === undefined ? {} : {systemPrompt: options.metadata.systemPrompt}),
    }
    if (
      options.recorder &&
      (options.recorder.scope.sessionId !== id ||
        options.recorder.file !== options.metadata?.file ||
        options.recorder.scope.journalRoot !== options.journalRoot)
    )
      throw new Error('Session metadata must match recorder identity and journal binding')
    this.recorder = options.recorder
    this.journalRoot = options.journalRoot
    this.entries = structuredClone(options.entries ?? [])
    this.formatVersion = options.formatVersion ?? (this.recorder ? 1 : 2)
    validateContextProjectionEntries(this.entries, id, this.formatVersion)
    validateSkillEntries(this.entries, id, this.formatVersion)
    this.activeCompaction = validateCompactionEntries(this.entries, id, this.formatVersion)

    const header = new SessionHeader({
      id: rootMessageId,
      payload: {sessionId: id},
      timestamp: createdAt,
    })
    this.messages.push(header)
    this.messageIds.add(header.id)
    for (const message of options.messages ?? []) {
      this.messages.push(message)
      this.messageIds.add(message.id)
    }
  }

  acquireManagedLease(): () => void {
    if (this.closing) throw new Error('Session is closing or closed')
    if (this.recorder) return this.recorder.acquireManagedLease()
    if (this.getFile()) throw new Error('Persistent Session must delegate its recorder writer lease')
    if (this.ephemeralLease) throw new Error('Session writer is already owned by an Agent')
    this.ephemeralLease = true
    let released = false
    return () => {
      if (!released) {
        released = true
        this.ephemeralLease = false
        this.releaseEphemeral?.()
      }
    }
  }

  acquireWriterLease(): SessionWriterLease {
    if (this.closing || !this.recorder) throw new Error('A live persistent Session recorder is required')
    return this.recorder.acquireManagedLease()
  }

  appendMessages(messages: Message[], options: AppendMessageOptions = {}): Message[] {
    if (this.compactionSaving) throw new Error('Compaction synchronization is pending')
    const pendingIds = new Set(this.messageIds)
    for (const message of messages) {
      if (pendingIds.has(message.id)) throw new Error(`Message already exists in session: ${message.id}`)
      pendingIds.add(message.id)
    }

    let parentId = this.getLastMessageId()
    const appendedMessages = messages.map((message) => {
      const appendedMessage = new CoreMessage(message.type, {
        contents: message.contents,
        id: message.id,
        parentid: parentId,
        ...(message.payload === undefined ? {} : {payload: message.payload}),
        role: message.role,
        timestamp: message.timestamp,
      })
      const entry: SessionMessageEntry = {
        ...(options.iteration === undefined ? {} : {iteration: options.iteration}),
        message: toPersistedMessage(appendedMessage),
        timestamp: new Date().toISOString(),
        ...(options.turnId === undefined ? {} : {turnId: options.turnId}),
        type: SessionEntryType.Message,
      }
      this.addEntry(entry)
      this.messages.push(appendedMessage)
      this.messageIds.add(appendedMessage.id)
      parentId = appendedMessage.id
      return appendedMessage
    })
    return appendedMessages
  }

  appendNewMessages(messages: Message[], options: AppendMessageOptions = {}): Message[] {
    return this.appendMessages(
      messages.filter((message) => !this.messageIds.has(message.id)),
      options,
    )
  }

  close(): Promise<void> {
    this.closing = true
    this.closePromise ??= (async () => {
      if (this.ephemeralLease)
        await new Promise<void>((resolve) => {
          this.releaseEphemeral = resolve
        })
      await this.recorder?.close()
    })()
    const pending = this.closePromise
    pending.catch(() => {
      if (this.closePromise === pending) this.closePromise = undefined
    })
    return pending
  }

  async commitCompaction(candidate: SessionCompactionEntry, level: JournalLevel): Promise<void> {
    if (!this.hasManagedLease() || this.compactionSaving || this.closing)
      throw new Error('Compaction requires exclusive live Session ownership')
    if (this.getFile() && level === 'memory') throw new Error('Persistent compaction requires synchronization')
    const entry = structuredClone(candidate)
    validateCompactionEntries([...this.entries, entry], this.getId(), this.formatVersion)
    this.compactionSaving = true
    try {
      this.addEntry(entry)
      await this.synchronize(level)
      this.activeCompaction = entry
    } finally {
      this.compactionSaving = false
    }
  }

  async commitProjection(entry: ContextProjectionEntry, level: JournalLevel): Promise<void> {
    if (!this.hasManagedLease() || this.compactionSaving || this.closing)
      throw new Error('Projection requires exclusive Session ownership')
    if (this.getFile() && level === 'memory') throw new Error('Persistent projection requires synchronization')
    const candidate = structuredClone(entry)
    validateContextProjectionEntries([...this.entries, candidate], this.getId(), this.formatVersion)
    this.compactionSaving = true
    try {
      this.addEntry(candidate)
      await this.synchronize(level)
    } finally {
      this.compactionSaving = false
    }
  }

  async commitSkills(entry: SessionSkillEntry, level: JournalLevel): Promise<void> {
    if (!this.hasManagedLease() || this.closing) throw new Error('Skill snapshot requires managed ownership')
    if (this.getFile() && level === 'memory') throw new Error('Persistent Skill snapshots require synchronization')
    const validated = parseSkillEntry(entry)
    validateSkillEntries([...this.entries, validated], this.getId(), this.formatVersion)
    this.addEntry(validated)
    await this.synchronize(level)
  }

  async flush(): Promise<void> {
    await this.recorder?.flush()
  }

  getCompaction(): SessionCompactionEntry | undefined {
    return this.activeCompaction ? structuredClone(this.activeCompaction) : undefined
  }

  getConversationMessages(): Message[] {
    return this.messages.slice(1)
  }

  getEntries(): SessionEntry[] {
    return [...this.entries]
  }

  getFile(): string | undefined {
    return this.metadata.file
  }

  getFirstMessageId(): null | string {
    return this.messages[0]?.id ?? null
  }

  getId(): string {
    return this.metadata.id
  }

  getLastMessageId(): null | string {
    return this.messages.at(-1)?.id ?? null
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getMetadata(): SessionMetadata {
    return {...this.metadata}
  }

  getSkillContexts(): SessionSkillEntry[] {
    return structuredClone(this.entries.filter((entry): entry is SessionSkillEntry => entry.type === 'skill_context'))
  }

  hasManagedLease(): boolean {
    return this.recorder?.hasManagedLease() ?? this.ephemeralLease
  }

  hasMessage(id: string): boolean {
    return this.messageIds.has(id)
  }

  recordTurnContext(options: RecordTurnContextOptions): void {
    const entry: SessionTurnContextEntry = {
      cwd: options.cwd,
      maxToolIterations: options.maxToolIterations,
      model: options.model,
      provider: options.provider,
      timestamp: new Date().toISOString(),
      turnId: options.turnId,
      type: SessionEntryType.TurnContext,
    }
    this.addEntry(entry)
  }

  recordTurnEvent(options: RecordTurnEventOptions): void {
    if (options.phase === 'failed' && options.error === undefined) {
      throw new Error('A failed turn event must include an error.')
    }

    if (options.phase !== 'failed' && options.error !== undefined) {
      throw new Error('Only a failed turn event may include an error.')
    }

    const entry: SessionTurnEventEntry = {
      ...(options.error === undefined ? {} : {error: options.error}),
      phase: options.phase,
      timestamp: new Date().toISOString(),
      turnId: options.turnId,
      type: SessionEntryType.TurnEvent,
    }
    this.addEntry(entry)
  }

  /** Retry retained evidence handles without granting a new Run. */
  async settleContextEvidence(): Promise<void> {
    await this.recorder?.settleContextEvidence()
  }

  async synchronize(level: JournalLevel): Promise<number> {
    if (level === 'memory') await this.flush()
    else if (this.recorder) await this.recorder.synchronize(level)
    else throw new Error('Session has no durable synchronization capability')
    return this.entries.length
  }

  /** Read-only evidence inspection, requiring the current managed lease. */
  async verifyContextSource(maxBytes: number): Promise<number> {
    if (!this.hasManagedLease()) throw new Error('Context source ownership required')
    if (!this.recorder) return Buffer.byteLength(JSON.stringify(this.entries))
    const text = await this.recorder.verifyContextSource(maxBytes)
    const parsed = parseSessionFile(text, this.recorder.file)
    if (
      parsed.recovered ||
      parsed.header.id !== this.getId() ||
      parsed.header.version !== this.formatVersion ||
      JSON.stringify(parsed.entries.slice(1)) !== JSON.stringify(this.entries)
    )
      throw new Error('Context transcript differs from owned entries')
    return Buffer.byteLength(text)
  }

  private addEntry(entry: SessionEntry): void {
    this.recorder?.append(entry)
    this.entries.push(entry)
  }
}

function toPersistedMessage(message: Message): PersistedMessage {
  return {
    contents: [...message.contents],
    id: message.id,
    parentid: message.parentid,
    ...(message.payload === undefined ? {} : {payload: message.payload}),
    role: message.role,
    timestamp: message.timestamp,
    type: message.type,
  }
}
