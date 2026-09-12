// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Compatibility fixture: codec from dee5e7aee3bca09ced563c54bca374c41d901010.
// Only import paths differ; do not update this decoder with new record support.

import type {MessagePayload} from '../../../../src/core/message/index.js'
import type {Role} from '../../../../src/core/models/role.js'
import type {
  PersistedMessage,
  SessionEntry,
  SessionError,
  SessionHeaderEntry,
  SessionMessageEntry,
  SessionTurnContextEntry,
  SessionTurnEventEntry,
} from '../../../../src/core/session/entries.js'

import {isMessageType} from '../../../../src/core/message/index.js'
import {isProvider} from '../../../../src/core/models/provider.js'
import {getRoles} from '../../../../src/core/models/role.js'
import {parseCompaction, validateCompactionEntries} from '../../../../src/core/session/compaction.js'
import {SESSION_FORMAT_VERSION, SessionEntryType, TurnPhase} from '../../../../src/core/session/entries.js'

export interface ParsedSessionFile {
  entries: SessionEntry[]
  header: SessionHeaderEntry
  recovered: boolean
}

export function encodeSessionEntry(entry: SessionEntry): string {
  assertJsonValue(entry, '$')
  return `${JSON.stringify(entry)}\n`
}

export function parseSessionFile(raw: string, file: string): ParsedSessionFile {
  const hasTrailingNewline = raw.endsWith('\n')
  const lines = raw.split('\n')
  if (hasTrailingNewline) lines.pop()

  const entries: SessionEntry[] = []
  let recovered = false
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      const isRecoverableLastLine = !hasTrailingNewline && index === lines.length - 1
      if (isRecoverableLastLine) {
        recovered = true
        break
      }

      throw sessionFileError(file, index + 1, error instanceof Error ? error.message : 'Invalid JSON')
    }

    entries.push(parseEntry(parsed, file, index + 1))
  }

  const [header] = entries
  if (header === undefined || header.type !== SessionEntryType.Session) {
    throw sessionFileError(file, 1, 'The first entry must be a session header.')
  }

  validateEntrySequence(entries, file)
  validateCompactionEntries(entries, header.id, header.version)
  return {entries, header, recovered}
}

function parseEntry(value: unknown, file: string, line: number): SessionEntry {
  const entry = requireRecord(value, file, line, 'entry')
  switch (entry.type) {
    case SessionEntryType.Compaction: {
      return parseCompaction(entry)
    }

    case SessionEntryType.Message: {
      return parseMessageEntry(entry, file, line)
    }

    case SessionEntryType.Session: {
      return parseHeaderEntry(entry, file, line)
    }

    case SessionEntryType.TurnContext: {
      return parseTurnContextEntry(entry, file, line)
    }

    case SessionEntryType.TurnEvent: {
      return parseTurnEventEntry(entry, file, line)
    }

    default: {
      throw sessionFileError(file, line, `Unsupported session entry type: ${String(entry.type)}`)
    }
  }
}

function parseHeaderEntry(entry: Record<string, unknown>, file: string, line: number): SessionHeaderEntry {
  const version = requireNumber(entry.version, file, line, 'version')
  if (version !== SESSION_FORMAT_VERSION && version !== 2) {
    throw sessionFileError(file, line, `Unsupported session format version: ${version}`)
  }

  const {provider} = entry
  if (provider !== undefined && (typeof provider !== 'string' || !isProvider(provider))) {
    throw sessionFileError(file, line, 'provider must be a supported provider name.')
  }

  return {
    cwd: requireString(entry.cwd, file, line, 'cwd'),
    id: requireString(entry.id, file, line, 'id'),
    ...(entry.model === undefined ? {} : {model: requireString(entry.model, file, line, 'model')}),
    ...(entry.originator === undefined ? {} : {originator: requireString(entry.originator, file, line, 'originator')}),
    ...(provider === undefined ? {} : {provider}),
    rootMessageId: requireString(entry.rootMessageId, file, line, 'rootMessageId'),
    ...(entry.systemPrompt === undefined
      ? {}
      : {systemPrompt: requireString(entry.systemPrompt, file, line, 'systemPrompt')}),
    timestamp: requireString(entry.timestamp, file, line, 'timestamp'),
    type: SessionEntryType.Session,
    version,
  }
}

function parseMessageEntry(entry: Record<string, unknown>, file: string, line: number): SessionMessageEntry {
  return {
    ...(entry.iteration === undefined
      ? {}
      : {iteration: requireNonNegativeInteger(entry.iteration, file, line, 'iteration')}),
    message: parsePersistedMessage(entry.message, file, line),
    timestamp: requireString(entry.timestamp, file, line, 'timestamp'),
    ...(entry.turnId === undefined ? {} : {turnId: requireString(entry.turnId, file, line, 'turnId')}),
    type: SessionEntryType.Message,
  }
}

function parsePersistedMessage(value: unknown, file: string, line: number): PersistedMessage {
  const message = requireRecord(value, file, line, 'message')
  const type = requireString(message.type, file, line, 'message.type')
  if (!isMessageType(type)) {
    throw sessionFileError(file, line, `Unsupported message type: ${type}`)
  }

  const role = requireString(message.role, file, line, 'message.role')
  if (!getRoles().includes(role as Role)) {
    throw sessionFileError(file, line, `Unsupported message role: ${role}`)
  }

  const {contents} = message
  if (!Array.isArray(contents) || contents.some((content) => typeof content !== 'string')) {
    throw sessionFileError(file, line, 'message.contents must be an array of strings.')
  }

  const {parentid} = message
  if (parentid !== null && typeof parentid !== 'string') {
    throw sessionFileError(file, line, 'message.parentid must be a string or null.')
  }

  if ('payload' in message) assertJsonValue(message.payload, 'message.payload', file, line)
  return {
    contents,
    id: requireString(message.id, file, line, 'message.id'),
    parentid,
    ...('payload' in message ? {payload: message.payload as MessagePayload} : {}),
    role: role as Role,
    timestamp: requireString(message.timestamp, file, line, 'message.timestamp'),
    type,
  }
}

function parseTurnContextEntry(entry: Record<string, unknown>, file: string, line: number): SessionTurnContextEntry {
  const provider = requireString(entry.provider, file, line, 'provider')
  if (!isProvider(provider)) {
    throw sessionFileError(file, line, `Unsupported provider: ${provider}`)
  }

  return {
    cwd: requireString(entry.cwd, file, line, 'cwd'),
    maxToolIterations: requireNonNegativeInteger(entry.maxToolIterations, file, line, 'maxToolIterations'),
    model: requireString(entry.model, file, line, 'model'),
    provider,
    timestamp: requireString(entry.timestamp, file, line, 'timestamp'),
    turnId: requireString(entry.turnId, file, line, 'turnId'),
    type: SessionEntryType.TurnContext,
  }
}

function parseTurnEventEntry(entry: Record<string, unknown>, file: string, line: number): SessionTurnEventEntry {
  const phase = requireString(entry.phase, file, line, 'phase')
  if (!Object.values(TurnPhase).includes(phase as (typeof TurnPhase)[keyof typeof TurnPhase])) {
    throw sessionFileError(file, line, `Unsupported turn phase: ${phase}`)
  }

  if (phase === TurnPhase.Failed && entry.error === undefined) {
    throw sessionFileError(file, line, 'A failed turn event must include an error.')
  }

  if (phase !== TurnPhase.Failed && entry.error !== undefined) {
    throw sessionFileError(file, line, 'Only a failed turn event may include an error.')
  }

  return {
    ...(entry.error === undefined ? {} : {error: parseSessionError(entry.error, file, line)}),
    phase: phase as (typeof TurnPhase)[keyof typeof TurnPhase],
    timestamp: requireString(entry.timestamp, file, line, 'timestamp'),
    turnId: requireString(entry.turnId, file, line, 'turnId'),
    type: SessionEntryType.TurnEvent,
  }
}

function parseSessionError(value: unknown, file: string, line: number): SessionError {
  const error = requireRecord(value, file, line, 'error')
  return {
    ...(error.code === undefined ? {} : {code: requireString(error.code, file, line, 'error.code')}),
    message: requireString(error.message, file, line, 'error.message'),
    name: requireString(error.name, file, line, 'error.name'),
  }
}

function validateEntrySequence(entries: SessionEntry[], file: string): void {
  const header = entries[0] as SessionHeaderEntry
  const messageIds = new Set<string>([header.rootMessageId])
  for (const [index, entry] of entries.entries()) {
    if (index === 0) continue
    if (entry.type === SessionEntryType.Session) {
      throw sessionFileError(file, index + 1, 'A session header may only appear on the first line.')
    }

    if (entry.type !== SessionEntryType.Message) continue
    if (messageIds.has(entry.message.id)) {
      throw sessionFileError(file, index + 1, `Duplicate message id: ${entry.message.id}`)
    }

    if (entry.message.parentid === null || !messageIds.has(entry.message.parentid)) {
      throw sessionFileError(file, index + 1, `Unknown message parent: ${String(entry.message.parentid)}`)
    }

    messageIds.add(entry.message.id)
  }
}

// File context is optional when validating entries before encoding, so the validator carries both modes.
// eslint-disable-next-line max-params
function assertJsonValue(value: unknown, field: string, file?: string, line?: number, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw codecError(field, 'must be a finite number.', file, line)
  }

  if (typeof value !== 'object') {
    throw codecError(field, `contains unsupported ${typeof value} data.`, file, line)
  }

  if (seen.has(value)) throw codecError(field, 'contains a circular reference.', file, line)
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw codecError(`${field}[${index}]`, 'is missing.', file, line)
      assertJsonValue(value[index], `${field}[${index}]`, file, line, seen)
    }
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      throw codecError(field, 'contains an unsupported object instance.', file, line)
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw codecError(field, 'contains symbol keys.', file, line)
    }

    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${field}.${key}`, file, line, seen)
    }
  }

  seen.delete(value)
}

function requireRecord(value: unknown, file: string, line: number, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw sessionFileError(file, line, `${field} must be an object.`)
  }

  return value as Record<string, unknown>
}

function requireString(value: unknown, file: string, line: number, field: string): string {
  if (typeof value !== 'string') throw sessionFileError(file, line, `${field} must be a string.`)
  return value
}

function requireNumber(value: unknown, file: string, line: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw sessionFileError(file, line, `${field} must be a finite number.`)
  }

  return value
}

function requireNonNegativeInteger(value: unknown, file: string, line: number, field: string): number {
  const number = requireNumber(value, file, line, field)
  if (!Number.isInteger(number) || number < 0) {
    throw sessionFileError(file, line, `${field} must be a non-negative integer.`)
  }

  return number
}

function codecError(field: string, message: string, file?: string, line?: number): Error {
  return file === undefined || line === undefined
    ? new Error(`Invalid session data: ${field} ${message}`)
    : sessionFileError(file, line, `${field} ${message}`)
}

function sessionFileError(file: string, line: number, message: string): Error {
  return new Error(`Invalid session file ${file} at line ${line}: ${message}`)
}
