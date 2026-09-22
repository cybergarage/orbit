// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import type {ExecutionJournal, JournalRecord} from './journal.js'

import {safeIdentity, validateNext} from './journal.js'

export interface JournalInspection {
  keyAvailable: boolean
  runs: {issue?: string; records: JournalRecord[]; runId: string}[]
  sessionId: string
}

/** Read-only inspection preserves torn bytes. It never resumes or dispatches an operation. */
export async function inspectExecutionJournal(root: string, sessionId: string): Promise<JournalInspection> {
  const directory = path.join(root, safeIdentity(sessionId))
  const key = await fs.readFile(path.join(directory, 'key')).catch(() => {})
  const children = await fs.readdir(directory, {withFileTypes: true})
  const runs = await Promise.all(
    children
      .filter((child) => child.isDirectory())
      .map(async (child) => {
        const records: JournalRecord[] = []
        try {
          const text = await fs.readFile(path.join(directory, safeIdentity(child.name), 'events.jsonl'), 'utf8')
          for (const line of text.split('\n').slice(0, -1)) {
            const record = JSON.parse(line) as JournalRecord
            if (
              ![1, 2, 3].includes(record.version) ||
              record.runId !== child.name ||
              record.sessionId !== sessionId ||
              record.sequence !== records.length + 1
            )
              throw new Error('Invalid journal prefix')
            validateNext(records, record)
            records.push(record)
          }

          return {
            records,
            runId: child.name,
            ...(text.endsWith('\n') ? {} : {issue: 'Torn final record; preserve this file for explicit repair'}),
          }
        } catch {
          return {issue: 'Unreadable or invalid journal; preserve original evidence', records, runId: child.name}
        }
      }),
  )
  return {keyAvailable: key?.length === 32, runs, sessionId}
}

/** An owner must verify all external effects first. This adds evidence, never changes a terminal result. */
export async function recordReconciliation(
  journal: ExecutionJournal,
  runId: string,
  confirmation: {
    confirmedStopped: true
    operations: {id: string; status: 'failed' | 'succeeded'}[]
  },
): Promise<void> {
  if (confirmation.confirmedStopped !== true) throw new Error('Explicit external quiescence confirmation is required')
  const records = journal.records().filter((record) => record.runId === runId)
  if (!records.some((record) => record.kind === 'run-admitted')) throw new Error('Unknown run')
  const uncertain = records.filter(
    (record) =>
      record.kind === 'operation-intent' &&
      !records.some(
        (result) => result.kind === 'operation-result' && result.data.operationId === record.data.operationId,
      ),
  )
  for (const intent of uncertain)
    if (!confirmation.operations.some((operation) => operation.id === intent.data.operationId))
      throw new Error('Every unresolved intent needs an externally verified outcome')
  if (confirmation.operations.some((operation) => !['failed', 'succeeded'].includes(operation.status)))
    throw new Error('Invalid reconciliation outcome')
  if (!records.some((record) => record.kind === 'run-terminal')) {
    await journal.append(runId, 'run-terminal', {
      cleanupErrors: [],
      operations: [
        ...records
          .filter((record) => record.kind === 'operation-result')
          .map((record) => ({id: record.data.operationId, status: record.data.status})),
        ...uncertain.map((record) => ({id: record.data.operationId, status: 'unknown'})),
      ],
      outcome: 'incomplete',
      quiescence: false,
      reason: 'interrupted',
      recording: {level: journal.level, mode: journal.mode, status: 'recovered'},
      runId,
      sessionId: records[0].sessionId,
      unresolved: ['external-reconciliation'],
    })
  }

  await journal.append(runId, 'late-settlement', {operations: confirmation.operations, settled: true})
}
