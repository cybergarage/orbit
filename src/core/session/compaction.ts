// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import type {PersistedMessage, SessionEntry} from './entries.js'

import {Message} from '../message/index.js'
import {getToolCalls, getToolResult} from '../models/adapters/tools.js'
import {projectInterruptedMessages} from './interrupted-context.js'

export interface SummaryFact {
  sourceIds: string[]
  text: string
}
export interface SummaryTest extends SummaryFact {
  outcome: 'failed' | 'passed' | 'unknown'
  revision: null | string
  target: string
}
export interface ContextSummary {
  changedPaths: SummaryFact[]
  facts: SummaryFact[]
  goals: SummaryFact[]
  tests: SummaryTest[]
  uncertainties: SummaryFact[]
  unfinished: SummaryFact[]
  version: 1
}
export interface SessionCompactionEntry {
  afterTokens: number
  beforeTokens: number
  digestVersion: 'sha256-json-v1'
  estimatorRevision: string
  firstRetainedId: string
  id: string
  model: string
  prefixEndId: string
  previousId: null | string
  profileRevision: string
  projectionIds?: string[]
  projectionVersion: 1 | 2
  provider: string
  sessionId: string
  sourceDigest: string
  sourceHeadId: string
  summary: ContextSummary
  summaryUsage?: Record<string, number>
  timestamp: string
  type: 'compaction'
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid compaction object')
  return value as Record<string, unknown>
}

function string(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid compaction string')
}

export function validateSummary(value: unknown, ids: Set<string>): asserts value is ContextSummary {
  const summary = record(value)
  if (summary.version !== 1) throw new Error('Unsupported summary version')
  let facts = 0
  for (const key of ['goals', 'facts', 'changedPaths', 'tests', 'unfinished', 'uncertainties']) {
    const items = summary[key]
    if (!Array.isArray(items)) throw new Error('Invalid summary field: ' + key)
    for (const item of items) {
      const fact = record(item)
      string(fact.text)
      if (key === 'tests') {
        string(fact.target)
        if (fact.revision !== null) string(fact.revision)
        if (!['failed', 'passed', 'unknown'].includes(String(fact.outcome)))
          throw new Error('Invalid summary test outcome')
      }

      if (
        !Array.isArray(fact.sourceIds) ||
        fact.sourceIds.length === 0 ||
        fact.sourceIds.some((id) => typeof id !== 'string' || !ids.has(id))
      )
        throw new Error('Summary refers to unknown source evidence')
      facts++
    }
  }

  if (facts === 0) throw new Error('Empty summary')
}

export function parseCompaction(value: unknown): SessionCompactionEntry {
  const entry = record(value)
  for (const key of [
    'id',
    'sessionId',
    'sourceHeadId',
    'prefixEndId',
    'firstRetainedId',
    'sourceDigest',
    'model',
    'provider',
    'estimatorRevision',
    'profileRevision',
    'timestamp',
  ])
    string(entry[key])
  if (
    entry.type !== 'compaction' ||
    ![1, 2].includes(Number(entry.projectionVersion)) ||
    entry.digestVersion !== 'sha256-json-v1' ||
    (entry.previousId !== null && typeof entry.previousId !== 'string')
  )
    throw new Error('Invalid compaction format')
  if (entry.projectionVersion === 1 && entry.projectionIds !== undefined)
    throw new Error('Unexpected checkpoint projection references')
  if (
    entry.projectionVersion === 2 &&
    (!Array.isArray(entry.projectionIds) ||
      entry.projectionIds.length === 0 ||
      entry.projectionIds.some((id) => typeof id !== 'string') ||
      new Set(entry.projectionIds).size !== entry.projectionIds.length)
  )
    throw new Error('Missing checkpoint projection references')
  if (!/^[a-f0-9]{64}$/.test(entry.sourceDigest as string) || !Number.isFinite(Date.parse(entry.timestamp as string)))
    throw new Error('Invalid compaction digest or time')
  for (const key of ['beforeTokens', 'afterTokens'])
    if (!Number.isSafeInteger(entry[key]) || (entry[key] as number) < 0)
      throw new Error('Invalid compaction token count')
  if ((entry.afterTokens as number) >= (entry.beforeTokens as number))
    throw new Error('Compaction did not reduce input')
  if (
    entry.summaryUsage !== undefined &&
    Object.values(record(entry.summaryUsage)).some((value) => !Number.isSafeInteger(value) || (value as number) < 0)
  )
    throw new Error('Invalid summary usage')
  return entry as unknown as SessionCompactionEntry
}

/** Sorted keys make digests independent of caller property insertion order. */
export function canonicalJSON(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-JSON checkpoint number')
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Non-JSON checkpoint object')
  if (Array.isArray(value)) return '[' + value.map((value) => canonicalJSON(value)).join(',') + ']'
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJSON(item))
        .join(',') +
      '}'
    )
  const text = JSON.stringify(value)
  if (text === undefined) throw new Error('Non-JSON checkpoint source')
  return text
}

export function sourceDigest(messages: readonly PersistedMessage[]): string {
  return createHash('sha256').update(canonicalJSON(messages)).digest('hex')
}

export function persistedContextMessage(message: Message): PersistedMessage {
  return {
    contents: [...message.contents],
    id: message.id,
    parentid: message.parentid,
    role: message.role,
    timestamp: message.timestamp,
    type: message.type,
    ...(message.payload === undefined ? {} : {payload: structuredClone(message.payload)}),
  }
}

/** Call IDs may be reused by a provider in later groups, but never within a group. */
export function validateToolGroups(messages: readonly Message[]): void {
  let pending = new Map<string, string>()
  for (const message of messages) {
    const calls = getToolCalls(message)
    const result = getToolResult(message)
    if (message.type === 'tool') {
      if (!result || pending.get(result.toolCallId) !== result.name || !pending.delete(result.toolCallId))
        throw new Error('Unmatched or duplicate tool result')
      continue
    }

    if (pending.size > 0) throw new Error('Unresolved tool call group')
    if (calls.length > 0) {
      pending = new Map(calls.map((call) => [call.id, call.name]))
      if (pending.size !== calls.length || pending.has('')) throw new Error('Duplicate tool call ID')
    }
  }

  if (pending.size > 0) throw new Error('Unresolved tool call group')
}

export function validateCompactionEntries(
  entries: readonly SessionEntry[],
  sessionId: string,
  version: number,
): SessionCompactionEntry | undefined {
  const messages: PersistedMessage[] = []
  let previous: SessionCompactionEntry | undefined
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.type === 'message') messages.push(entry.message)
    if (entry.type !== 'compaction') continue
    parseCompaction(entry)
    const cut = messages.findIndex((message) => message.id === entry.firstRetainedId)
    const oldCut = previous ? messages.findIndex((message) => message.id === previous?.firstRetainedId) : 0
    if (
      ![2, 3].includes(version) ||
      entry.sessionId !== sessionId ||
      ids.has(entry.id) ||
      entry.previousId !== (previous?.id ?? null) ||
      entry.sourceHeadId !== messages.at(-1)?.id ||
      cut <= oldCut ||
      messages[cut]?.type !== 'user' ||
      entry.prefixEndId !== messages[cut - 1]?.id
    )
      throw new Error('Invalid checkpoint boundary or predecessor')
    if (messages.some((message, index) => index > 0 && message.parentid !== messages[index - 1].id))
      throw new Error('Checkpoint requires linear source history')
    const prefix = messages.slice(0, cut)
    if (entry.sourceDigest !== sourceDigest(prefix)) throw new Error('Checkpoint source digest mismatch')
    if (entry.projectionVersion === 1) validateToolGroups(messages.map((message) => new Message(message.type, message)))
    else {
      if (version !== 3) throw new Error('Projection-aware checkpoint requires v3')
      const position = entries.indexOf(entry)
      const prefixEntries = entries.slice(0, position)
      const projections = prefixEntries.filter(
        (e) => e.type === 'context_projection' && entry.projectionIds!.includes(e.id),
      )
      if (projections.length !== entry.projectionIds!.length)
        throw new Error('Missing checkpoint projection provenance')
      const projection = projections.at(-1)!
      if (projection.type !== 'context_projection') throw new Error('Invalid projection')
      projectInterruptedMessages(prefixEntries, projection.calls)
    }

    validateSummary(entry.summary, new Set(prefix.map((message) => message.id)))
    ids.add(entry.id)
    previous = entry
  }

  return previous
}
