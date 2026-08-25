// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {v7 as uuidv7} from 'uuid'

import type {ProviderName} from '../models/provider.js'
import type {SessionHeaderEntry, SessionMetadata} from './entries.js'
import type {SessionInformation} from './information.js'

import {sessionsDir} from '../app.js'
import {Message} from '../message/index.js'
import {encodeSessionEntry, parseSessionFile} from './codec.js'
import {SESSION_FORMAT_VERSION, SessionEntryType} from './entries.js'
import {createSessionInformationFromSource} from './information.js'
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

export interface SessionSummary extends SessionInformation {
  file: string
}

export interface SessionListError {
  file: string
  message: string
}

export interface SessionListOptions {
  cursor?: string
  limit?: number
}

export interface FindLatestSessionOptions {
  cwd?: string
  originators?: string[]
}

export interface SessionListResult {
  data: SessionSummary[]
  errors: SessionListError[]
  nextCursor?: string
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

  async delete(sessionId: string): Promise<SessionSummary | undefined> {
    const summary = await this.findById(sessionId)
    if (summary === undefined) return
    let guard: SessionRecorder
    try {
      guard = SessionRecorder.open(summary.file)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Session file is already open for writing:')) {
        throw new Error(`Session is open for writing: ${sessionId}`)
      }

      throw error
    }

    try {
      try {
        await fsPromises.unlink(summary.file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
    } finally {
      await guard.close()
    }

    return summary
  }

  async findById(sessionId: string): Promise<SessionSummary | undefined> {
    let cursor: string | undefined
    do {
      // Pages are sequential because the next cursor is returned by the previous page.
      // eslint-disable-next-line no-await-in-loop
      const page = await this.listPage({cursor, limit: 200})
      const summary = page.data.find((item) => item.id === sessionId)
      if (summary !== undefined) return summary
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  async findLatest(options: FindLatestSessionOptions = {}): Promise<SessionSummary | undefined> {
    const cwd = options.cwd === undefined ? undefined : path.resolve(options.cwd)
    const originators = options.originators === undefined ? undefined : new Set(options.originators)
    let cursor: string | undefined
    do {
      // Pages are sequential because the next cursor is returned by the previous page.
      // eslint-disable-next-line no-await-in-loop
      const page = await this.listPage({cursor, limit: 200})
      const summary = page.data.find(
        (item) =>
          (cwd === undefined || path.resolve(item.cwd) === cwd) &&
          (originators === undefined || (item.originator !== undefined && originators.has(item.originator))),
      )
      if (summary !== undefined) return summary
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  list(): SessionSummary[] {
    if (!fs.existsSync(this.rootDir)) return []
    return findSessionFiles(this.rootDir)
      .map((file) => this.readSummary(file))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async listPage(options: SessionListOptions = {}): Promise<SessionListResult> {
    const limit = options.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 200) {
      throw new Error('Session list limit must be an integer between 1 and 200.')
    }

    const offset = parseCursor(options.cursor)
    try {
      await fsPromises.access(this.rootDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {data: [], errors: []}
      throw error
    }

    const files = await findSessionFilesAsync(this.rootDir)
    const errors: SessionListError[] = []
    const summaries = (
      await Promise.all(
        files.map(async (file) => {
          try {
            const source = await fsPromises.readFile(file, 'utf8')
            return summaryFromParsed(parseSessionFile(source, file), file)
          } catch (error) {
            errors.push({file, message: error instanceof Error ? error.message : String(error)})
          }
        }),
      )
    )
      .filter((summary): summary is SessionSummary => summary !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const data = summaries.slice(offset, offset + limit)
    const nextOffset = offset + data.length
    return {
      data,
      errors,
      ...(nextOffset < summaries.length ? {nextCursor: String(nextOffset)} : {}),
    }
  }

  open(file: string): Session {
    const resolvedFile = path.resolve(file)
    let parsed: ReturnType<typeof parseSessionFile> | undefined
    const recorder = SessionRecorder.open(resolvedFile, () => {
      parsed = parseSessionFile(fs.readFileSync(resolvedFile, 'utf8'), resolvedFile)
      if (parsed.recovered) {
        fs.writeFileSync(resolvedFile, parsed.entries.map((entry) => encodeSessionEntry(entry)).join(''), {mode: 0o600})
      }
    })
    if (parsed === undefined) throw new Error(`Session file could not be loaded: ${resolvedFile}`)

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
    return summaryFromParsed(parsed, resolvedFile)
  }
}

function summaryFromParsed(parsed: ReturnType<typeof parseSessionFile>, file: string): SessionSummary {
  return {
    ...createSessionInformationFromSource({
      createdAt: parsed.header.timestamp,
      cwd: parsed.header.cwd,
      entries: parsed.entries.slice(1),
      id: parsed.header.id,
      ...(parsed.header.model === undefined ? {} : {model: parsed.header.model}),
      ...(parsed.header.originator === undefined ? {} : {originator: parsed.header.originator}),
      ...(parsed.header.provider === undefined ? {} : {provider: parsed.header.provider}),
    }),
    file,
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

async function findSessionFilesAsync(rootDir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(rootDir, {withFileTypes: true})
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const item = path.join(rootDir, entry.name)
      if (entry.isDirectory()) return findSessionFilesAsync(item)
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [item] : []
    }),
  )
  return nestedFiles.flat()
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid session list cursor.')
  return offset
}
