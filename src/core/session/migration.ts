// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {OfflineStorageConditions, SessionScope} from './coordination.js'

import {encodeSessionEntry, parseSessionFile} from './codec.js'
import {
  beginTranscriptMaintenance,
  canonicalStoragePath,
  inspectTranscript,
  migrationIntentPath,
} from './coordination.js'

interface MigrationIntent {
  file: string
  sessionId: string
  sourceDigest: string
  targetDigest: string
  token: string
  version: 1
}
function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sync(file: string): void {
  const descriptor = fs.openSync(file, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function read(file: string): string {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.nlink !== 1 || canonicalStoragePath(file) !== file)
    throw new Error('Ambiguous migration artifact')
  return fs.readFileSync(file, 'utf8')
}

function write(file: string, bytes: string): void {
  fs.writeFileSync(file, bytes, {flag: 'wx', mode: 0o600})
  sync(file)
  sync(path.dirname(file))
}

/** Stop all external writers and restarters for the entire operation and any interrupted recovery. */
export function migrateSessionTranscript(
  scope: SessionScope,
  file: string,
  conditions: OfflineStorageConditions,
  resume = false,
): void {
  file = path.resolve(file)
  const intentFile = migrationIntentPath(scope)
  // Validate the named transcript before creating an initial maintenance guard.
  if (!resume) {
    inspectTranscript(scope, file)
    const parsed = parseSessionFile(read(file), file)
    if (parsed.header.version !== 1 || parsed.recovered)
      throw new Error('Migration requires a complete version-1 transcript')
  }

  const recovered = resume ? (JSON.parse(read(intentFile)) as MigrationIntent) : undefined
  if (
    recovered &&
    (recovered.version !== 1 ||
      recovered.sessionId !== scope.sessionId ||
      recovered.file !== file ||
      typeof recovered.token !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(recovered.token))
  )
    throw new Error('Invalid migration identity')
  const guard = beginTranscriptMaintenance(scope, conditions, resume, recovered?.token)
  const backup = file + '.v1-backup'
  const target = file + '.v2-pending'
  let intent: MigrationIntent
  if (resume) {
    const value = recovered!
    if (
      value.version !== 1 ||
      value.sessionId !== scope.sessionId ||
      value.file !== file ||
      value.token !== guard.token ||
      !/^[a-f0-9]{64}$/.test(value.sourceDigest) ||
      !/^[a-f0-9]{64}$/.test(value.targetDigest)
    )
      throw new Error('Invalid migration intent; retain exclusion')
    intent = value
  } else {
    inspectTranscript(scope, file)
    const source = read(file)
    const parsed = parseSessionFile(source, file)
    if (parsed.header.version !== 1 || parsed.recovered)
      throw new Error('Migration requires a complete version-1 transcript')
    const next = [{...parsed.header, version: 2 as const}, ...parsed.entries.slice(1)]
      .map((value) => encodeSessionEntry(value))
      .join('')
    intent = {
      file,
      sessionId: scope.sessionId,
      sourceDigest: digest(source),
      targetDigest: digest(next),
      token: guard.token,
      version: 1,
    }
    // Persist the plan before touching source, backup or replacement.
    write(intentFile, JSON.stringify(intent) + '\n')
  }

  const current = read(file)
  const currentDigest = digest(current)
  if (![intent.sourceDigest, intent.targetDigest].includes(currentDigest))
    throw new Error('Transcript does not match migration intent')
  if (currentDigest === intent.sourceDigest) {
    if (fs.existsSync(backup)) {
      if (digest(read(backup)) !== intent.sourceDigest) throw new Error('Conflicting migration backup')
      sync(backup)
    } else write(backup, current)
    const parsed = parseSessionFile(current, file)
    const next = [{...parsed.header, version: 2 as const}, ...parsed.entries.slice(1)]
      .map((value) => encodeSessionEntry(value))
      .join('')
    if (digest(next) !== intent.targetDigest) throw new Error('Migration projection changed')
    if (fs.existsSync(target)) {
      if (digest(read(target)) !== intent.targetDigest)
        throw new Error('Interrupted replacement is incomplete; review offline')
      sync(target)
    } else write(target, next)
    fs.renameSync(target, file)
  }

  if (digest(read(backup)) !== intent.sourceDigest || digest(read(file)) !== intent.targetDigest)
    throw new Error('Migration evidence mismatch')
  sync(file)
  sync(path.dirname(file))
  inspectTranscript(scope, file)
  // Intent still refuses ordinary admission during guard removal.
  guard.release()
  fs.unlinkSync(intentFile)
  sync(path.dirname(intentFile))
}

export interface TranscriptMigrationInspection {
  file?: string
  reason?: string
  state: 'invalid' | 'none' | 'pending'
}
/** Read-only diagnosis never removes a guard or resumes migration. */
export function inspectTranscriptMigration(scope: SessionScope): TranscriptMigrationInspection {
  const file = migrationIntentPath(scope)
  if (!fs.existsSync(file)) return {state: 'none'}
  try {
    const value = JSON.parse(read(file)) as MigrationIntent
    if (
      value.version !== 1 ||
      value.sessionId !== scope.sessionId ||
      typeof value.file !== 'string' ||
      !value.file.startsWith(scope.sessionRoot + path.sep) ||
      !/^[a-f0-9]{64}$/.test(value.sourceDigest) ||
      !/^[a-f0-9]{64}$/.test(value.targetDigest)
    )
      throw new Error('Invalid migration intent')
    return {file: value.file, state: 'pending'}
  } catch {
    return {reason: 'Migration artifacts require exclusive review', state: 'invalid'}
  }
}
