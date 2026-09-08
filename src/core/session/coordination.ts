// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type {OfflineStorageConditions, RegistrationResumeOptions} from './storage-registration.js'

import {parseSessionFile} from './codec.js'
import {sessionFilePath} from './paths.js'
import {
  assertOfflineStorage,
  canonicalStoragePath,
  configureSessionStorage,
  readRegisteredStorage,
} from './storage-registration.js'

export type {
  OfflineStorageConditions,
  RegistrationResumeOptions,
  StorageRegistrationInspection,
} from './storage-registration.js'

const scopes = new WeakSet<object>()
const cleanup = new Map<string, WriterClaim>()
interface Identity {
  dev: number
  ino: number
}
interface Artifact {
  bytes?: Buffer
  file: string
  identity: Identity
  token?: string
}
interface Owner {
  pid: number
  token: string
  version: 1
}
export interface SessionScope {
  readonly journalRoot: string
  readonly pairId: string
  readonly sessionId: string
  readonly sessionRoot: string
}

export function validateSessionId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(id) || id === 'deletions')
    throw new Error('Invalid session identity')
  return id
}

function exists(file: string): boolean {
  try {
    fs.lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function inspectStorageOwnership(b: {journalRoot: string; sessionRoot: string}): () => void {
  if (
    [...cleanup.values()].some(
      (claim) => claim.scope.sessionRoot === b.sessionRoot || claim.scope.journalRoot === b.journalRoot,
    )
  )
    throw new Error('Local writer or cleanup must settle before offline storage initialization')
  const legacy: Artifact[] = []
  const scan = (dir: string): void => {
    if (!exists(dir)) return
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name)
      if (item.isDirectory() && file !== b.journalRoot && item.name !== '.coordination') scan(file)
      if (item.name.endsWith('.jsonl.lock')) {
        const bytes = fs.readFileSync(file)
        const owner = JSON.parse(bytes.toString('utf8')) as Owner
        if (!validOwner(owner, false) || alive(owner.pid))
          throw new Error('Live or unknown legacy writer blocks migration')
        const stat = fs.lstatSync(file)
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unknown legacy writer artifact')
        legacy.push({bytes, file, identity: stat})
      }
    }
  }

  scan(b.sessionRoot)
  const ownerDir = path.join(b.sessionRoot, '.coordination')
  if (exists(ownerDir))
    for (const name of fs.readdirSync(ownerDir))
      if (name.endsWith('.owner')) {
        const owner = readOwner(path.join(ownerDir, name))
        if (!owner || alive(owner.pid)) throw new Error('Live or unknown writer blocks storage initialization')
      }

  return () => {
    for (const a of legacy) {
      removeArtifact(a)
      syncDirectory(path.dirname(a.file))
    }
  }
}

export function initializeSessionStorage(
  sessionRoot: string,
  journalRoot: string,
  conditions: OfflineStorageConditions,
): void {
  configureSessionStorage(sessionRoot, journalRoot, conditions, inspectStorageOwnership)
}

export function resumeSessionStorage(
  sessionRoot: string,
  journalRoot: string,
  conditions: OfflineStorageConditions,
  options: RegistrationResumeOptions = {},
): void {
  configureSessionStorage(sessionRoot, journalRoot, conditions, inspectStorageOwnership, true, options)
}

export function sessionScope(sessionRoot: string, journalRoot: string, sessionId: string): SessionScope {
  validateSessionId(sessionId)
  const b = readRegisteredStorage(sessionRoot, journalRoot)
  const scope = Object.freeze({...b, sessionId})
  scopes.add(scope)
  return scope
}

function validateScope(scope: SessionScope): void {
  if (!scope || !scopes.has(scope)) throw new Error('A validated SessionRepository scope is required')
  validateSessionId(scope.sessionId)
  if (
    canonicalStoragePath(scope.sessionRoot) !== scope.sessionRoot ||
    canonicalStoragePath(scope.journalRoot) !== scope.journalRoot
  )
    throw new Error('Storage root identity changed')
  if (readRegisteredStorage(scope.sessionRoot, scope.journalRoot).pairId !== scope.pairId)
    throw new Error('Storage pair identity changed')
}

function key(scope: SessionScope): string {
  return path.join(scope.sessionRoot, '.coordination', scope.sessionId)
}

export function coordinationPaths(scope: SessionScope): {guard: string; owner: string} {
  validateScope(scope)
  return {guard: key(scope) + '.guard', owner: key(scope) + '.owner'}
}

function validOwner(owner: Owner, version = true): boolean {
  return (
    Boolean(owner) &&
    (!version || owner.version === 1) &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.token === 'string' &&
    owner.token.length > 0
  )
}

function readOwner(file: string): Owner | undefined {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1) return undefined
    const owner = JSON.parse(fs.readFileSync(file, 'utf8')) as Owner
    return validOwner(owner) ? owner : undefined
  } catch {
    return undefined
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function createArtifact(file: string, value: Owner, retained: (artifact: Artifact) => void): Artifact {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    const artifact: Artifact = {file, identity: fs.fstatSync(fd)}
    retained(artifact)
    fs.writeFileSync(fd, JSON.stringify(value) + '\n')
    artifact.token = value.token
    return artifact
  } finally {
    fs.closeSync(fd)
  }
}

function removeArtifact(artifact: Artifact): void {
  if (!exists(artifact.file)) return
  const current = fs.lstatSync(artifact.file)
  if (
    current.dev !== artifact.identity.dev ||
    current.ino !== artifact.identity.ino ||
    !current.isFile() ||
    current.nlink !== 1
  )
    throw new Error('Coordination identity changed; offline maintenance required')
  if (artifact.bytes && !fs.readFileSync(artifact.file).equals(artifact.bytes))
    throw new Error('Legacy writer evidence changed during maintenance')
  if (artifact.token && readOwner(artifact.file)?.token !== artifact.token)
    throw new Error('Coordination token changed; offline maintenance required')
  fs.unlinkSync(artifact.file)
}

/** Core-only transition owner; callers cannot construct recorder or journal authority from serialized records. */
export class WriterClaim {
  private cleanupRequested = false
  private finished = false
  private guard?: Artifact
  private owner?: Artifact
  private ownerComplete = false
  private readonly token: Owner = {pid: process.pid, token: randomUUID(), version: 1}

  private constructor(readonly scope: SessionScope) {}

  static acquire(scope: SessionScope, prepare: () => void, deleting = false): WriterClaim {
    validateScope(scope)
    if (cleanup.has(key(scope))) throw new Error('Session file is already open for writing or cleanup is pending')
    const claim = new WriterClaim(scope)
    const files = coordinationPaths(scope)
    fs.mkdirSync(path.dirname(files.guard), {mode: 0o700, recursive: true})
    if (canonicalStoragePath(path.dirname(files.guard)) !== path.dirname(files.guard))
      throw new Error('Ambiguous coordination directory')
    try {
      createArtifact(files.guard, claim.token, (a) => {
        claim.guard = a
      })
    } catch (error) {
      if (claim.guard) {
        cleanup.set(key(scope), claim)
        claim.unwind(error)
      }

      throw new Error('Session guard busy or unavailable; retained guards require offline maintenance', {cause: error})
    }

    try {
      if (exists(files.owner)) {
        const previous = readOwner(files.owner)
        if (!previous || alive(previous.pid))
          throw new Error('Session file is already open for writing or owner is unknown')
        fs.unlinkSync(files.owner)
      }

      if (!deleting && exists(path.join(scope.journalRoot, 'deletions', scope.sessionId + '.json')))
        throw new Error('Session deletion is recorded; create a new session')
      createArtifact(files.owner, claim.token, (a) => {
        claim.owner = a
      })
      claim.ownerComplete = true
      cleanup.set(key(scope), claim)
      prepare()
      removeArtifact(claim.guard!)
      claim.guard = undefined
      return claim
    } catch (error) {
      return claim.unwind(error)
    }
  }

  assertLive(): void {
    validateScope(this.scope)
    if (this.finished || !this.owner || readOwner(this.owner.file)?.token !== this.token.token)
      throw new Error('Writer authority is no longer live')
  }

  release(): void {
    if (this.finished) return
    this.cleanupRequested = true
    const files = coordinationPaths(this.scope)
    if (!this.guard && this.owner)
      createArtifact(files.guard, this.token, (a) => {
        this.guard = a
      })
    if (this.owner) {
      // Never delete a replacement owner, including after an uncertain acknowledgement.
      if (this.ownerComplete && exists(this.owner.file) && readOwner(this.owner.file)?.token !== this.token.token)
        throw new Error('Owner token changed; offline maintenance required')
      removeArtifact(this.owner)
      this.owner = undefined
    }

    if (this.guard) {
      removeArtifact(this.guard)
      this.guard = undefined
    }

    this.finished = true
    if (cleanup.get(key(this.scope)) === this) cleanup.delete(key(this.scope))
  }

  retryCleanup(): void {
    if (this.cleanupRequested) this.release()
  }

  private unwind(error: unknown): never {
    try {
      this.release()
    } catch (error_) {
      cleanup.set(key(this.scope), this)
      throw new AggregateError(
        [error, error_],
        'Session acquisition failed and cleanup is retained; retry cleanup or use offline maintenance',
      )
    }

    throw error
  }
}
export async function retrySessionCleanup(scope: SessionScope): Promise<void> {
  validateScope(scope)
  // Only a previously requested release can resume; this never closes an active recorder or deletion.
  const claim = cleanup.get(key(scope))
  claim?.retryCleanup()
}

export function isSessionLocked(scope: SessionScope): boolean {
  try {
    const files = coordinationPaths(scope)
    return cleanup.has(key(scope)) || exists(files.guard) || exists(files.owner)
  } catch {
    return true
  }
}

export function inspectTranscript(scope: SessionScope, file: string, creating = false): void {
  validateScope(scope)
  const resolved = path.resolve(file)
  if (canonicalStoragePath(resolved) !== resolved)
    throw new Error('Ambiguous transcript alias; import into the registered repository')
  const relative = path.relative(scope.sessionRoot, resolved)
  if (!/^\d{4}[/\\]\d{2}[/\\]\d{2}[/\\]session-[^/\\]+\.jsonl$/u.test(relative))
    throw new Error('Unsupported transcript layout')
  if (!creating) {
    const stat = fs.lstatSync(resolved)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Hard-linked or non-regular transcript')
    const parsed = parseSessionFile(fs.readFileSync(resolved, 'utf8'), resolved)
    if (
      parsed.header.id !== scope.sessionId ||
      sessionFilePath(scope.sessionRoot, parsed.header.id, parsed.header.timestamp) !== resolved
    )
      throw new Error('Transcript identity mismatch')
  }

  const scan = (dir: string): void => {
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      const candidate = path.join(dir, item.name)
      if (item.isDirectory() && candidate !== scope.journalRoot && !item.name.startsWith('.')) scan(candidate)
      if (item.name.endsWith('.jsonl') && candidate !== resolved) {
        try {
          const parsed = parseSessionFile(fs.readFileSync(candidate, 'utf8'), candidate)
          if (parsed.header.id === scope.sessionId) throw new Error('Duplicate session identity')
        } catch (error) {
          if (String(error).includes('Duplicate session identity')) throw error
        }
      }
    }
  }

  scan(scope.sessionRoot)
}

/** Offline operator procedure. External exclusion MUST survive this process; never use while services can restart. */
export function recoverSessionWriter(scope: SessionScope, conditions: OfflineStorageConditions): void {
  assertOfflineStorage(conditions)
  validateScope(scope)
  if (cleanup.has(key(scope))) throw new Error('Local writer or cleanup must settle before offline recovery')
  const files = coordinationPaths(scope)
  inspectRecoveryEvidence(scope)
  const owner = exists(files.owner) ? readOwner(files.owner) : undefined
  if (exists(files.owner) && (!owner || alive(owner.pid)))
    throw new Error('Live or unknown owner requires manual evidence review')
  for (const file of [files.owner, files.guard]) {
    if (exists(file)) {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unknown coordination artifact')
      fs.unlinkSync(file)
    }

    syncDirectory(path.dirname(file))
  }
}

function inspectRecoveryEvidence(scope: SessionScope): void {
  const marker = path.join(scope.journalRoot, 'deletions', scope.sessionId + '.json')
  if (exists(marker)) {
    const value = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (value.version !== 1 || value.sessionId !== scope.sessionId || !['completed', 'deleting'].includes(value.state))
      throw new Error('Unknown deletion evidence; review offline')
  }

  const directory = path.join(scope.journalRoot, scope.sessionId)
  if (!exists(directory)) return
  for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, item.name)
    if (item.name === 'key' && item.isFile() && fs.statSync(file).nlink === 1 && fs.statSync(file).size === 32) continue
    if (!item.isDirectory()) throw new Error('Unknown journal artifact; review offline')
    validateSessionId(item.name)
    const files = fs.readdirSync(file)
    if (files.length !== 1 || files[0] !== 'events.jsonl') throw new Error('Unknown journal evidence; review offline')
    const source = fs.readFileSync(path.join(file, 'events.jsonl'), 'utf8')
    if (!source.endsWith('\n')) throw new Error('Torn journal evidence; review offline')
    for (const line of source.trimEnd().split('\n')) {
      const record = JSON.parse(line)
      if (record.version !== 1 || record.sessionId !== scope.sessionId || record.runId !== item.name)
        throw new Error('Conflicting journal evidence; review offline')
    }
  }
}

export {canonicalStoragePath, inspectSessionStorage} from './storage-registration.js'
