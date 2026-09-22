// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {JournalRecord} from '../execution/journal.js'

import {parseProjectContext, PROJECT_CONTEXT_RECORD_BYTES} from './memory-context.js'

export function validateProjectContextRecord(run: JournalRecord[], record: JournalRecord): void {
  if (record.kind === 'project-context') {
    if (record.version !== 3 || run.length !== 1 || run[0].kind !== 'run-admitted')
      throw new Error('Project context must immediately follow journal-v3 admission')
    if (Buffer.byteLength(JSON.stringify(record)) > PROJECT_CONTEXT_RECORD_BYTES)
      throw new Error('Project context record exceeds 256 KiB')
    const snapshot = parseProjectContext(record.data.snapshot)
    if (snapshot.sessionId !== record.sessionId) throw new Error('Project context session mismatch')
  } else if (
    record.version === 3 &&
    !['late-settlement', 'run-admitted', 'run-terminal', 'stop-requested'].includes(record.kind) &&
    !run.some((entry) => entry.kind === 'project-context')
  )
    throw new Error('Project context acknowledgement must precede managed effects')
}

export function hasProjectGraphContext(records: JournalRecord[]): boolean {
  const context = records.find((record) => record.kind === 'project-context')?.data.snapshot as
    | undefined
    | {execution?: unknown}
  return context?.execution === 'graph'
}
