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
  coordinationPaths,
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
    const value = JSON.parse(read(file)) as MigrationIntent | ProjectionMigrationIntent
    if (value.version === 2) {
      validateProjectionIntent(value, scope, value.file)
      if (!value.file.startsWith(scope.sessionRoot + path.sep)) throw new Error('Invalid migration destination')
      return {file: value.file, state: 'pending'}
    }

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

interface ProjectionMigrationIntent {
  file: string
  sessionId: string
  sourceDigest: string
  sourceVersion: 2
  targetDigest: string
  targetVersion: 3
  token: string
  version: 2
}
function projectionMigrationTarget(source: string, file: string): string {
  const parsed = parseSessionFile(source, file)
  if (parsed.header.version !== 2 || parsed.recovered) throw new Error('Projection migration requires complete v2')
  const end = source.indexOf('\n')
  if (end === -1) throw new Error('Projection migration requires a complete header line')
  // Only replace the header. CRLF, whitespace and every data entry byte remain unchanged.
  return encodeSessionEntry({...parsed.header, version: 3}) + source.slice(end + 1)
}

function validateProjectionIntent(value: ProjectionMigrationIntent, scope: SessionScope, file: string): void {
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'file,sessionId,sourceDigest,sourceVersion,targetDigest,targetVersion,token,version' ||
    value.version !== 2 ||
    value.sourceVersion !== 2 ||
    value.targetVersion !== 3 ||
    value.file !== file ||
    value.sessionId !== scope.sessionId ||
    !/^[a-f0-9-]{36}$/.test(value.token) ||
    !/^[a-f0-9]{64}$/.test(value.sourceDigest) ||
    !/^[a-f0-9]{64}$/.test(value.targetDigest)
  )
    throw new Error('Invalid v2-to-v3 migration intent; retain exclusion')
}

/** Exclusive v2-to-v3 conversion; never deletes backups or resumes an older migration intent. */
export function migrateSessionTranscriptV3(
  scope: SessionScope,
  file: string,
  conditions: OfflineStorageConditions,
  resume = false,
): 'already-migrated' | 'migrated' {
  file = path.resolve(file)
  const intentFile = migrationIntentPath(scope)
  const existing = fs.existsSync(intentFile) ? (JSON.parse(read(intentFile)) as ProjectionMigrationIntent) : undefined
  if (existing) {
    validateProjectionIntent(existing, scope, file)
    if (!resume) throw new Error('Pending v3 migration requires explicit resume')
  }

  if (!resume && !existing) {
    inspectTranscript(scope, file)
    const parsed = parseSessionFile(read(file), file)
    if (parsed.recovered || ![2, 3].includes(parsed.header.version))
      throw new Error('Migration requires a complete version-2 or version-3 transcript')
  }

  const resumeGuard = resume && (Boolean(existing) || fs.existsSync(coordinationPaths(scope).guard))
  const guard = beginTranscriptMaintenance(scope, conditions, resumeGuard, existing?.token)
  inspectTranscript(scope, file)
  let source = read(file)
  if (!Buffer.from(source).equals(fs.readFileSync(file))) throw new Error('Transcript is not lossless UTF-8')
  let intent = existing
  if (!intent) {
    const parsed = parseSessionFile(source, file)
    if (parsed.recovered) throw new Error('Incomplete transcript cannot be migrated')
    if (parsed.header.version === 3) {
      sync(file)
      sync(path.dirname(file))
      guard.release()
      return 'already-migrated'
    }

    const target = projectionMigrationTarget(source, file)
    intent = {
      file,
      sessionId: scope.sessionId,
      sourceDigest: digest(source),
      sourceVersion: 2,
      targetDigest: digest(target),
      targetVersion: 3,
      token: guard.token,
      version: 2,
    }
    write(intentFile, JSON.stringify(intent) + '\n')
  }

  if (intent.token !== guard.token) throw new Error('Migration guard token mismatch')
  const backup = file + '.v2-backup'
  const pending = file + '.v3-pending'
  if (digest(source) === intent.sourceDigest) {
    if (fs.existsSync(backup)) {
      if (digest(read(backup)) !== intent.sourceDigest) throw new Error('Conflicting v2 backup')
      sync(backup)
    } else write(backup, source)
    const target = projectionMigrationTarget(source, file)
    if (digest(target) !== intent.targetDigest) throw new Error('Migration target mismatch')
    if (fs.existsSync(pending)) {
      if (digest(read(pending)) !== intent.targetDigest)
        throw new Error('Incomplete v3 replacement requires offline review')
      sync(pending)
    } else write(pending, target)
    fs.renameSync(pending, file)
    source = read(file)
  }

  if (digest(source) !== intent.targetDigest || digest(read(backup)) !== intent.sourceDigest)
    throw new Error('V3 migration evidence mismatch')
  const parsed = parseSessionFile(source, file)
  if (parsed.header.version !== 3 || parsed.recovered) throw new Error('Invalid migrated v3 transcript')
  sync(backup)
  sync(file)
  sync(path.dirname(file))
  inspectTranscript(scope, file)
  guard.release()
  fs.unlinkSync(intentFile)
  sync(path.dirname(intentFile))
  return 'migrated'
}
