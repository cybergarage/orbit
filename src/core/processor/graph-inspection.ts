// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {JournalRecord} from '../execution/journal.js'
import type {SessionEntry} from '../session/entries.js'
import type {GraphSnapshot} from './graph-execution.js'

import {validateNext} from '../execution/journal.js'

export interface GraphTranscriptEvidence {
  /** Session data entries, excluding the JSONL header, matching Session.synchronize. */
  entries: readonly SessionEntry[]
  formatVersion: 1 | 2 | 3
  sessionId: string
}
export interface GraphInspection {
  issue?: string
  snapshot?: GraphSnapshot
  transcript: 'mismatch' | 'unavailable' | 'verified'
}
/** Observes one Run without adapters, model access or checkpoint continuation. */
export function inspectGraphRun(records: JournalRecord[], transcript?: GraphTranscriptEvidence): GraphInspection {
  const result: GraphInspection = {transcript: 'unavailable'}
  try {
    const first = records[0]
    if (!first || first.version !== 2) return result
    for (const [index, record] of records.entries()) {
      if (record.runId !== first.runId || record.sessionId !== first.sessionId)
        throw new Error('Inspection requires one Run')
      validateNext(records.slice(0, index), record)
    }

    const bound = records.find((r) => r.kind === 'graph-bound')
    if (!bound) return result
    const starts = records.filter((r) => r.kind === 'graph-node-started')
    const completed = [...records].reverse().find((r) => r.kind === 'graph-node-completed')
    const lastStart = starts.at(-1)
    result.snapshot = {
      graph: String(bound.data.graph),
      recovered: true,
      runId: first.runId,
      visits: starts.length,
      ...(lastStart ? {nodeId: String(lastStart.data.nodeId), visitId: String(lastStart.data.visitId)} : {}),
      ...(completed ? {outputDigest: String(completed.data.outputDigest)} : {}),
    }
    if (!transcript) return result
    result.transcript = 'mismatch'
    if (![2, 3].includes(transcript.formatVersion) || transcript.sessionId !== first.sessionId)
      throw new Error('Graph transcript identity/version mismatch')
    for (const record of records) {
      const high = record.data.transcriptHighWater
      if (high === undefined) continue
      if (!Number.isSafeInteger(high) || Number(high) > transcript.entries.length || Number(high) < 0)
        throw new Error('Unavailable synchronized transcript entries')
      const prefix = transcript.entries.slice(0, Number(high))
      if (
        records.some((r) => r.kind === 'run-ready') &&
        !prefix.some((e) => e.type === 'turn_event' && e.turnId === first.runId && e.phase === 'started')
      )
        throw new Error('Missing graph turn evidence')
      if (record.kind === 'graph-node-completed') {
        const started = records.find((r) => r.kind === 'graph-node-started' && r.data.visitId === record.data.visitId)!
        const messages = transcript.entries
          .slice(Number(started.data.transcriptHighWater), Number(high))
          .filter((e) => e.type === 'message' && e.turnId === first.runId)
          .map((e) => (e.type === 'message' ? e.message.id : ''))
        if (JSON.stringify(messages) !== JSON.stringify(record.data.messages))
          throw new Error('Graph message reference mismatch')
      }

      if (record.kind === 'run-ready' && record.data.skills) {
        const skills = record.data.skills as {snapshotId: string}
        if (!prefix.some((e) => e.type === 'skill_context' && e.turnId === first.runId && e.id === skills.snapshotId))
          throw new Error('Missing synchronized Skill snapshot')
      }
    }

    result.transcript = 'verified'
    return result
  } catch (error) {
    return {...result, issue: error instanceof Error ? error.message : 'Invalid Graph evidence'}
  }
}
