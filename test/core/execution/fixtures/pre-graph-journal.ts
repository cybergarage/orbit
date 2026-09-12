// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {JournalKind as CurrentKind, JournalRecord as CurrentRecord} from '../../../../src/core/execution/journal.js'

// Unchanged pre-Graph journal validator from f2f55dba9446773fe0d5bbe4a0ee558b36cc4036.
// Shared canonical JSON and identity utilities did not change with Graph.
import {canonicalJSON, safeIdentity} from '../../../../src/core/execution/journal.js'
type JournalKind = Exclude<CurrentKind, 'graph-bound' | 'graph-node-completed' | 'graph-node-started' | 'graph-transition'>
type JournalRecord = Omit<CurrentRecord,'kind' | 'version'> & {kind:JournalKind;version:1}

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
    Object.keys(record.data).some((key) => !allowed[record.kind].includes(key))
  )
    throw new Error('Unsupported execution metadata')
  safeIdentity(record.runId)
  safeIdentity(record.sessionId)
  safeIdentity(record.eventId)
  if (typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp)) || record.elapsedMs < 0)
    throw new Error('Invalid journal envelope')
  const run = entries.filter((entry) => entry.runId === record.runId)
  validateSkillEvidence(record, run)
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
