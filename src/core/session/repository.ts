// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {ProviderName} from '../models/provider.js'
import type {SessionEntry, SessionHeaderEntry, SessionMetadata, SessionTurnEventEntry} from './entries.js'

import {sessionsDir} from '../app.js'
import {Message} from '../message/index.js'
import {encodeSessionEntry, parseSessionFile} from './codec.js'
import {SESSION_FORMAT_VERSION, SessionEntryType} from './entries.js'
import {sessionFilePath} from './paths.js'
import {SessionRecorder} from './recorder.js'
import {Session} from './session.js'

export interface CreateSessionOptions {
  createdAt?: string
  cwd?: string
  id?: string
  model?: string
  originator?: string
  provider?: ProviderName
  systemPrompt?: string
}

export interface SessionRepositoryOptions {
  rootDir?: string
}

export interface SessionSummary {
  createdAt: string
  cwd: string
  file: string
  id: string
  model?: string
  originator?: string
  provider?: ProviderName
  status: 'cancelled' | 'completed' | 'failed' | 'interrupted' | 'new'
  updatedAt: string
}

export class SessionRepository {
  public readonly rootDir: string

  constructor(options: SessionRepositoryOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? sessionsDir())
  }

  create(options: CreateSessionOptions = {}): Session {
    const createdAt = new Date(options.createdAt ?? Date.now()).toISOString()
    const id = options.id ?? uuidv7()
    const rootMessageId = uuidv7()
    const file = sessionFilePath(this.rootDir, id, createdAt)
    const header: SessionHeaderEntry = {
      cwd: path.resolve(options.cwd ?? process.cwd()),
      id,
      ...(options.model === undefined ? {} : {model: options.model}),
      ...(options.originator === undefined ? {} : {originator: options.originator}),
      ...(options.provider === undefined ? {} : {provider: options.provider}),
      rootMessageId,
      ...(options.systemPrompt === undefined ? {} : {systemPrompt: options.systemPrompt}),
      timestamp: createdAt,
      type: SessionEntryType.Session,
      version: SESSION_FORMAT_VERSION,
    }
    const recorder = SessionRecorder.create(file, header)
    return new Session({metadata: metadataFromHeader(header, file), recorder})
  }

  list(): SessionSummary[] {
    if (!fs.existsSync(this.rootDir)) return []
    return findSessionFiles(this.rootDir)
      .map((file) => this.readSummary(file))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  open(file: string): Session {
    const resolvedFile = path.resolve(file)
    const parsed = parseSessionFile(fs.readFileSync(resolvedFile, 'utf8'), resolvedFile)
    if (parsed.recovered) {
      fs.writeFileSync(resolvedFile, parsed.entries.map((entry) => encodeSessionEntry(entry)).join(''), {mode: 0o600})
    }

    const messages = parsed.entries
      .filter((entry) => entry.type === SessionEntryType.Message)
      .map(
        (entry) =>
          new Message(entry.message.type, {
            contents: entry.message.contents,
            id: entry.message.id,
            parentid: entry.message.parentid,
            ...(entry.message.payload === undefined ? {} : {payload: entry.message.payload}),
            role: entry.message.role,
            timestamp: entry.message.timestamp,
          }),
      )
    const recorder = SessionRecorder.open(resolvedFile)
    return new Session({
      entries: parsed.entries.slice(1),
      messages,
      metadata: metadataFromHeader(parsed.header, resolvedFile),
      recorder,
    })
  }

  readSummary(file: string): SessionSummary {
    const resolvedFile = path.resolve(file)
    const parsed = parseSessionFile(fs.readFileSync(resolvedFile, 'utf8'), resolvedFile)
    const lastEntry = parsed.entries.at(-1)
    const lastTurnEvent = findLastTurnEvent(parsed.entries)
    return {
      createdAt: parsed.header.timestamp,
      cwd: parsed.header.cwd,
      file: resolvedFile,
      id: parsed.header.id,
      ...(parsed.header.model === undefined ? {} : {model: parsed.header.model}),
      ...(parsed.header.originator === undefined ? {} : {originator: parsed.header.originator}),
      ...(parsed.header.provider === undefined ? {} : {provider: parsed.header.provider}),
      status: summaryStatus(parsed.entries, lastTurnEvent),
      updatedAt: lastEntry?.timestamp ?? parsed.header.timestamp,
    }
  }
}

function metadataFromHeader(header: SessionHeaderEntry, file: string): SessionMetadata {
  return {
    createdAt: header.timestamp,
    cwd: header.cwd,
    file,
    id: header.id,
    ...(header.model === undefined ? {} : {model: header.model}),
    ...(header.originator === undefined ? {} : {originator: header.originator}),
    ...(header.provider === undefined ? {} : {provider: header.provider}),
    rootMessageId: header.rootMessageId,
    ...(header.systemPrompt === undefined ? {} : {systemPrompt: header.systemPrompt}),
  }
}

function findSessionFiles(rootDir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(rootDir, {withFileTypes: true})) {
    const item = path.join(rootDir, entry.name)
    if (entry.isDirectory()) files.push(...findSessionFiles(item))
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(item)
  }

  return files
}

function findLastTurnEvent(entries: SessionEntry[]): SessionTurnEventEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === SessionEntryType.TurnEvent) return entry
  }
}

function summaryStatus(
  entries: SessionEntry[],
  lastTurnEvent: SessionTurnEventEntry | undefined,
): SessionSummary['status'] {
  if (lastTurnEvent?.phase === 'cancelled') return 'cancelled'
  if (lastTurnEvent?.phase === 'completed') return 'completed'
  if (lastTurnEvent?.phase === 'failed') return 'failed'
  if (entries.length > 1) return 'interrupted'
  return 'new'
}
