// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import type {JournalRecord} from '../execution/journal.js'
import type {SessionEntry} from './entries.js'

import {canonicalJSON, copyJSON, validateNext} from '../execution/journal.js'
import {Message, MessageType} from '../message/index.js'
import {getToolCalls, getToolResult} from '../models/adapters/tools.js'
import {inspectGraphRun} from '../processor/graph-inspection.js'
import {persistedContextMessage, sourceDigest, validateToolGroups} from './compaction.js'

/** Fixed persisted revision bounds, independent of future product limits. */
export const CONTEXT_PROJECTION_RECORD_BYTES = 4 * 1024 * 1024
export const CONTEXT_PROJECTION_REVISION = 1
export const INTERRUPTED_TOOL_NOTICE =
  'Context-only notice: required evidence proves this tool call was not dispatched before its Run was cancelled. No actual tool output is available. This notice is not permission to retry.'
export interface InterruptedCall {
  assistantId: string
  callId: string
  name: string
  ordinal: number
  turnId: string
}
export interface ProjectionEvidence {
  digest: string
  highWater: number
  runId: string
  terminalId: string
}
export interface ContextProjectionEntry {
  calls: InterruptedCall[]
  derivedDigest: string
  evidence: ProjectionEvidence[]
  id: string
  previousCompactionId: null | string
  revision: 1
  sessionId: string
  sourceDigest: string
  sourceHeadId: string
  timestamp: string
  turnId: string
  type: 'context_projection'
}
export class VerifiedContextError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'VerifiedContextError'
  }
}
function fail(code: string): never {
  throw new VerifiedContextError(code)
}

const hash = (value: unknown) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail('invalid-context-projection')
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail('invalid-context-projection-identity')
}

/** Structural parsing is not authority to use a model or proof of nondispatch. */
export function parseContextProjection(value: unknown): ContextProjectionEntry {
  exact(value, [
    'calls',
    'derivedDigest',
    'evidence',
    'id',
    'previousCompactionId',
    'revision',
    'sessionId',
    'sourceDigest',
    'sourceHeadId',
    'timestamp',
    'turnId',
    'type',
  ])
  if (Buffer.byteLength(canonicalJSON(value)) > CONTEXT_PROJECTION_RECORD_BYTES) fail('context-projection-record-limit')
  if (value.type !== 'context_projection' || value.revision !== CONTEXT_PROJECTION_REVISION)
    fail('unsupported-context-projection')
  for (const key of ['id', 'sessionId', 'sourceHeadId', 'timestamp', 'turnId']) text(value[key])
  if (!Number.isFinite(Date.parse(value.timestamp as string))) fail('invalid-context-projection-time')
  if (value.previousCompactionId !== null) text(value.previousCompactionId)
  if (!isDigest(value.sourceDigest) || !isDigest(value.derivedDigest)) fail('invalid-context-projection-digest')
  if (
    !Array.isArray(value.calls) ||
    value.calls.length === 0 ||
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0
  )
    fail('empty-context-projection')
  const calls = value.calls as unknown[]
  const identities = new Set<string>()
  for (const call of calls) {
    exact(call, ['assistantId', 'callId', 'name', 'ordinal', 'turnId'])
    for (const key of ['assistantId', 'callId', 'name', 'turnId']) text(call[key])
    if (!Number.isSafeInteger(call.ordinal) || Number(call.ordinal) < 0) fail('invalid-context-projection-ordinal')
    const identity = canonicalJSON([call.assistantId, call.ordinal])
    if (identities.has(identity)) fail('duplicate-context-projection-call')
    identities.add(identity)
  }

  const runs = new Set<string>()
  for (const evidence of value.evidence as unknown[]) {
    exact(evidence, ['digest', 'highWater', 'runId', 'terminalId'])
    text(evidence.runId)
    text(evidence.terminalId)
    if (
      !isDigest(evidence.digest) ||
      !Number.isSafeInteger(evidence.highWater) ||
      Number(evidence.highWater) < 1 ||
      runs.has(evidence.runId)
    )
      fail('invalid-context-projection-evidence')
    runs.add(evidence.runId)
  }

  if (calls.some((call) => !runs.has((call as InterruptedCall).turnId))) fail('missing-context-projection-evidence')
  if ([...runs].some((id) => !calls.some((call) => (call as InterruptedCall).turnId === id)))
    fail('unreferenced-context-projection-evidence')
  return copyJSON(value) as unknown as ContextProjectionEntry
}

/** Finds missing results without declaring them safe; rejects contradictory raw groups. */
export function interruptedCalls(entries: readonly SessionEntry[]): InterruptedCall[] {
  let pending: InterruptedCall[] = []
  const missing: InterruptedCall[] = []
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = new Message(entry.message.type, entry.message)
    const result = getToolResult(message)
    if (message.type === MessageType.Tool) {
      const index = pending.findIndex((call) => call.callId === result?.toolCallId && call.name === result?.name)
      if (index === -1) fail('unmatched-tool-result')
      pending.splice(index, 1)
      continue
    }

    missing.push(...pending)
    pending = []
    const calls = getToolCalls(message)
    if (new Set(calls.map((call) => call.id)).size !== calls.length) fail('ambiguous-tool-call-id')
    if (calls.length > 0 && !entry.turnId) fail('missing-tool-turn')
    pending = calls.map((call, ordinal) => {
      text(call.id)
      text(call.name)
      return {assistantId: message.id, callId: call.id, name: call.name, ordinal, turnId: entry.turnId!}
    })
  }

  return [...missing, ...pending]
}

/** Pure derivation; callers must separately verify retained evidence under ownership. */
export function projectInterruptedMessages(
  entries: readonly SessionEntry[],
  calls: readonly InterruptedCall[],
): Message[] {
  const raw = entries.filter((entry) => entry.type === 'message')
  const required = interruptedCalls(entries)
  if (canonicalJSON(required) !== canonicalJSON(calls)) fail('context-projection-call-mismatch')
  const messages: Message[] = []
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    messages.push(new Message(entry.message.type, copyJSON(entry.message)))
    if (getToolCalls(messages.at(-1)!).length === 0) continue
    while (i + 1 < raw.length && raw[i + 1].message.type === MessageType.Tool) {
      i++
      messages.push(new Message(raw[i].message.type, copyJSON(raw[i].message)))
    }

    for (const call of calls.filter((call) => call.assistantId === entry.message.id)) {
      messages.push(
        new Message(MessageType.Tool, {
          content: INTERRUPTED_TOOL_NOTICE,
          id: 'context-' + hash([CONTEXT_PROJECTION_REVISION, call]),
          parentid: entry.message.id,
          payload: {isError: true, name: call.name, output: INTERRUPTED_TOOL_NOTICE, toolCallId: call.callId},
          timestamp: entry.message.timestamp,
        }),
      )
    }
  }

  validateToolGroups(messages)
  return messages
}

export interface InterruptedHistoryEvidence {
  /** Must come from the owning journal's bounded, synchronized read; not a detached host snapshot. */
  digestCall(value: unknown): string
  entries: readonly SessionEntry[]
  formatVersion: 1 | 2 | 3
  records: JournalRecord[]
  sessionId: string
}
/** Checks correspondence only. I/O, live ownership and acknowledgement are runtime obligations. */
export function verifyInterruptedCorrespondence(options: InterruptedHistoryEvidence): {
  calls: InterruptedCall[]
  evidence: ProjectionEvidence[]
} {
  const {entries, records, sessionId} = options
  const calls = interruptedCalls(entries)
  const checked: JournalRecord[] = []
  for (const record of records) {
    if (record.sessionId !== sessionId) fail('context-evidence-session-mismatch')
    validateNext(checked, record)
    checked.push(record)
  }

  const evidence: ProjectionEvidence[] = []
  for (const turnId of new Set(calls.map((call) => call.turnId))) {
    const run = records.filter((r) => r.runId === turnId)
    const terminal = run.find((r) => r.kind === 'run-terminal')
    const data = terminal?.data
    const recording = data?.recording as undefined | {status: string}
    if (
      !terminal ||
      data?.outcome !== 'cancelled' ||
      data?.quiescence !== true ||
      recording?.status !== 'acknowledged' ||
      !Array.isArray(data.unresolved) ||
      data.unresolved.length > 0 ||
      !Array.isArray(data.cleanupErrors) ||
      data.cleanupErrors.length > 0
    )
      fail('ineligible-interrupted-run')
    if (run.some((r) => r.kind === 'late-settlement')) fail('interrupted-run-has-late-settlement')
    if (!Number.isSafeInteger(data.transcriptHighWater) || Number(data.transcriptHighWater) > entries.length)
      fail('missing-terminal-transcript-boundary')
    const prefix = entries.slice(0, Number(data.transcriptHighWater))
    if (!prefix.some((e) => e.type === 'turn_event' && e.turnId === turnId && e.phase === 'cancelled'))
      fail('missing-cancelled-transcript-terminal')
    const rawCalls = prefix.flatMap((e) =>
      e.type === 'message' && e.turnId === turnId
        ? getToolCalls(new Message(e.message.type, e.message)).map((c) => ({call: c, messageId: e.message.id}))
        : [],
    )
    const ids = new Set<string>()
    for (const {call} of rawCalls) {
      if (!call.id || ids.has(call.id)) fail('ambiguous-tool-call-id')
      ids.add(call.id)
    }

    for (const call of calls.filter((c) => c.turnId === turnId))
      if (!rawCalls.some((c) => c.call.id === call.callId && c.messageId === call.assistantId))
        fail('call-outside-terminal-boundary')
    const graph = run[0]?.version === 2 || run.some((record) => record.kind === 'graph-bound')
    const descriptor = run.find((r) => r.kind === 'graph-bound')?.data.descriptor as
      | undefined
      | {nodes: {id: string; kind: string; tool?: {source: unknown}}[]}
    const starts = run.filter((r) => r.kind === 'graph-node-started')
    if (graph) {
      if (inspectGraphRun(run, {entries, formatVersion: options.formatVersion, sessionId}).transcript !== 'verified')
        fail('unverified-graph-evidence')
      for (const raw of rawCalls) {
        const index = entries.findIndex((e) => e.type === 'message' && e.message.id === raw.messageId)
        const visit = [...starts].reverse().find((r) => Number(r.data.transcriptHighWater) <= index)
        if (!visit || descriptor?.nodes.find((n) => n.id === visit.data.nodeId)?.kind !== 'agent')
          fail('unattributed-graph-assistant')
      }
    }

    const results = run.filter((r) => r.kind === 'operation-result')
    for (const intent of run.filter((r) => r.kind === 'operation-intent')) {
      const result = results.find((r) => r.data.operationId === intent.data.operationId)
      if (!result || !['cancelled-before-start', 'failed', 'succeeded'].includes(String(result.data.status)))
        fail('unresolved-operation-intent')
      if (intent.data.variant === 'mcp-startup') continue
      if (intent.data.variant !== 'tool-call') fail('unexplained-operation-intent')
      if (graph) {
        // Direct nodes have a descriptor and visit; they cannot explain an Agent call.
        const start = starts.find((r) => r.data.visitId === intent.data.visitId)
        const node = descriptor?.nodes.find((n) => n.id === start?.data.nodeId)
        if (!node) fail('unexplained-graph-intent')
        if (node.kind === 'tool') {
          if (!node.tool || intent.data.source !== options.digestCall(node.tool.source))
            fail('unexplained-graph-tool-source')
          continue
        }

        if (node.kind !== 'agent') fail('unexplained-graph-intent')
      }

      const matched = rawCalls.filter((c) => options.digestCall(c.call.id) === intent.data.call)
      if (matched.length !== 1) fail('unmatched-operation-intent')
      if (calls.some((c) => c.turnId === turnId && c.callId === matched[0].call.id)) fail('missing-result-has-intent')
    }

    if (
      !Array.isArray(data.operations) ||
      data.operations.some(
        (o: {id?: unknown; status?: unknown}) =>
          !o ||
          typeof o.id !== 'string' ||
          !['cancelled-before-start', 'denied', 'failed', 'invalid', 'succeeded'].includes(String(o.status)),
      )
    )
      fail('unknown-operation-outcome')
    evidence.push({digest: hash(run), highWater: run.length, runId: turnId, terminalId: terminal.eventId})
  }

  return {calls, evidence}
}

export function projectionSourceDigest(entries: readonly SessionEntry[]): string {
  return sourceDigest(
    entries
      .filter((e) => e.type === 'message')
      .map((e) => persistedContextMessage(new Message(e.message.type, e.message))),
  )
}

/** Checks raw identity and deterministic derivation only; retained journals are verified asynchronously. */
export function validateContextProjectionEntries(
  entries: readonly SessionEntry[],
  sessionId: string,
  version: number,
): void {
  const prefix: SessionEntry[] = []
  const ids = new Set<string>()
  for (const value of entries) {
    if (value.type === 'context_projection') {
      const entry = parseContextProjection(value)
      const messages = prefix.filter((e) => e.type === 'message')
      const previous = [...prefix].reverse().find((e) => e.type === 'compaction')
      if (
        version !== 3 ||
        entry.sessionId !== sessionId ||
        ids.has(entry.id) ||
        entry.sourceHeadId !== messages.at(-1)?.message.id ||
        entry.sourceDigest !== projectionSourceDigest(prefix) ||
        entry.previousCompactionId !== (previous?.type === 'compaction' ? previous.id : null) ||
        !prefix.some((e) => e.type === 'turn_event' && e.turnId === entry.turnId && e.phase === 'started') ||
        prefix.some((e) => e.type === 'turn_event' && e.turnId === entry.turnId && e.phase !== 'started')
      )
        fail('invalid-context-projection-position')
      if (messages.some((e, i) => i > 0 && e.message.parentid !== messages[i - 1].message.id))
        fail('nonlinear-context-source')
      const derived = projectInterruptedMessages(prefix, entry.calls)
      if (sourceDigest(derived.map((message) => persistedContextMessage(message))) !== entry.derivedDigest)
        fail('context-projection-derivation-mismatch')
      ids.add(entry.id)
    }

    prefix.push(value)
  }
}
