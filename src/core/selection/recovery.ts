// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHmac} from 'node:crypto'
import {constants} from 'node:fs'
/* eslint-disable no-await-in-loop -- Bound sequential reads by the remaining total snapshot budget. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {TextDecoder} from 'node:util'

import type {JournalRecord} from '../execution/journal.js'

import {canonicalJSON, safeIdentity, validateNext} from '../execution/journal.js'
import {selectionText} from './validation.js'

export interface WorkflowBindingInspection {
  issues: string[]
  runId?: string
  settlement?: JournalRecord
  status: 'conflicting' | 'matched' | 'unverified'
  terminal?: JournalRecord
}
/** Bounded read-only correlation. Never opens a writer, repairs a tail or dispatches work. */
export async function inspectWorkflowRunBinding(
  root: string,
  session: string,
  request: string,
  input: string,
): Promise<WorkflowBindingInspection> {
  const expected = selectionText(input, 1_048_576)
  const issues: string[] = []
  const observed = new Map<string, {ctimeMs: number; dev: number; ino: number; mtimeMs: number; size: number}>()
  const read = async (file: string, limit: number) => {
    if ((await fs.realpath(file)) !== path.resolve(file)) throw new Error('Aliased journal path')
    // eslint-disable-next-line no-bitwise -- Combine OS open flags without acquiring a writer.
    const f = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const before = await f.stat()
      if (!before.isFile() || before.size > limit) throw new Error('Journal read exceeds bound')
      const bytes = Buffer.alloc(Number(before.size) + 1)
      const result = await f.read(bytes, 0, bytes.length, 0)
      const after = await f.stat()
      const current = await fs.stat(file)
      if (
        result.bytesRead !== before.size ||
        before.dev !== current.dev ||
        before.ino !== current.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== current.ctimeMs
      )
        throw new Error('Journal changed during read')
      observed.set(file, before)
      return {bytes: bytes.subarray(0, result.bytesRead), stat: before}
    } finally {
      await f.close()
    }
  }

  try {
    const directory = path.join(path.resolve(root), safeIdentity(session))
    safeIdentity(request)
    const before = await fs.stat(directory)
    if ((await fs.realpath(directory)) !== directory) throw new Error('Aliased journal root')
    const key = await read(path.join(directory, 'key'), 32)
    if (key.bytes.length !== 32) throw new Error('Journal key unavailable')
    const requestDigest = createHmac('sha256', key.bytes).update(canonicalJSON(expected)).digest('hex')
    const entries = await fs.readdir(directory, {withFileTypes: true})
    if (entries.length > 1002) throw new Error('Too many journal entries')
    const matches: JournalRecord[][] = []
    let bytes = 0
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Aliased journal entry')
      if (!entry.isDirectory()) continue
      const result = await read(path.join(directory, safeIdentity(entry.name), 'events.jsonl'), 16_777_216 - bytes)
      bytes += result.bytes.length
      const text = new TextDecoder('utf8', {fatal: true}).decode(result.bytes)
      if (!text.endsWith('\n')) throw new Error('Torn journal tail')
      const records: JournalRecord[] = []
      for (const line of text.split('\n').slice(0, -1)) {
        const record = selectionText(line, 16_777_216) as JournalRecord
        if (record.sessionId !== session || record.runId !== entry.name || record.sequence !== records.length + 1)
          throw new Error('Invalid journal identity')
        validateNext(records, record)
        records.push(record)
      }

      if (records.some((record) => record.kind === 'run-admitted' && record.data.requestId === request))
        matches.push(records)
    }

    const after = await fs.stat(directory)
    const lastKey = await read(path.join(directory, 'key'), 32)
    if (
      !lastKey.bytes.equals(key.bytes) ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error('Journal snapshot changed')
    for (const [file, stat] of observed) {
      const current = await fs.stat(file)
      if (
        (await fs.realpath(file)) !== path.resolve(file) ||
        (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const).some((k) => stat[k] !== current[k])
      )
        throw new Error('Journal changed across snapshot')
    }

    if (matches.length !== 1) throw new Error('Missing or duplicate journal binding')
    const records = matches[0]
    const admitted = records.find((r) => r.kind === 'run-admitted')!
    if (admitted.data.requestDigest !== requestDigest)
      return {issues: ['Request digest mismatch'], runId: admitted.runId, status: 'conflicting'}
    return {
      issues,
      runId: admitted.runId,
      settlement: [...records].reverse().find((r) => r.kind === 'late-settlement'),
      status: 'matched',
      terminal: records.find((r) => r.kind === 'run-terminal'),
    }
  } catch (error) {
    return {issues: [String(error)], status: 'unverified'}
  }
}
