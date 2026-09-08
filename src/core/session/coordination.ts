// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {parseSessionFile} from './codec.js'
import {sessionFilePath} from './paths.js'

const bindingName = '.orbit-session-binding.json'
const scopes = new WeakSet<object>()
const cleanup = new Map<string, WriterClaim>()
interface Binding {
  journalRoot: string
  sessionRoot: string
  version: 1
}
interface Identity {
  dev: number
  ino: number
}
interface Artifact {
  file: string
  identity: Identity
  token?: string
}
interface Owner {
  pid: number
  token: string
  version: 1
}
export interface OfflineStorageConditions {
  allWritersStopped: true
  automaticRestartersDisabled: true
  exclusiveStorageControl: true
}
export interface SessionScope {
  readonly journalRoot: string
  readonly sessionId: string
  readonly sessionRoot: string
}

function offline(conditions: OfflineStorageConditions): void {
  if (
    !conditions ||
    conditions.allWritersStopped !== true ||
    conditions.automaticRestartersDisabled !== true ||
    conditions.exclusiveStorageControl !== true
  )
    throw new Error('Offline maintenance requires stopped writers/restarters and external exclusive storage control')
}

export function validateSessionId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(id) || id === 'deletions')
    throw new Error('Invalid session identity')
  return id
}

export function canonicalStoragePath(value: string): string {
  const absolute = path.resolve(value)
  try {
    return fs.realpathSync.native(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(absolute)
    if (parent === absolute) throw error
    return path.join(canonicalStoragePath(parent), path.basename(absolute))
  }
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

function readBinding(root: string): Binding {
  const file = path.join(root, bindingName)
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid storage binding artifact')
  const b = JSON.parse(fs.readFileSync(file, 'utf8')) as Binding
  if (b.version !== 1 || typeof b.sessionRoot !== 'string' || typeof b.journalRoot !== 'string')
    throw new Error('Invalid storage binding')
  return b
}

function same(a: Binding, b: Binding): boolean {
  return a.version === b.version && a.sessionRoot === b.sessionRoot && a.journalRoot === b.journalRoot
}

function binding(sessionRoot: string, journalRoot: string): Binding {
  return {journalRoot: canonicalStoragePath(journalRoot), sessionRoot: canonicalStoragePath(sessionRoot), version: 1}
}

function validateBinding(b: Binding): void {
  try {
    if (!same(b, readBinding(b.sessionRoot)) || !same(b, readBinding(b.journalRoot))) throw new Error('conflict')
  } catch (error) {
    throw new Error('Session storage is unregistered, incomplete or conflicting; run offline storage initialization', {
      cause: error,
    })
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

function writeExclusive(file: string, value: unknown): void {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  syncDirectory(path.dirname(file))
}

function inspectOverlaps(b: Binding): void {
  if (
    b.sessionRoot === b.journalRoot ||
    b.sessionRoot.startsWith(b.journalRoot + path.sep) ||
    (b.journalRoot.startsWith(b.sessionRoot + path.sep) && b.journalRoot !== path.join(b.sessionRoot, '.runs'))
  )
    throw new Error('Overlapping session/journal roots are unsupported except the same binding .runs pair')
  for (const root of [b.sessionRoot, b.journalRoot]) {
    let ancestor = root
    while (true) {
      if (exists(path.join(ancestor, bindingName)) && !same(b, readBinding(ancestor)))
        throw new Error('Conflicting ancestor storage binding')
      const parent = path.dirname(ancestor)
      if (ancestor === parent) break
      ancestor = parent
    }

    const visit = (dir: string): void => {
      if (!exists(dir)) return
      for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, item.name)
        if (item.name === bindingName && !same(b, readBinding(dir)))
          throw new Error('Conflicting nested storage binding')
        if (item.isDirectory()) visit(file)
      }
    }

    visit(root)
  }
}

/** Offline only. Assertions describe operator responsibility, not an OS sandbox or proof of stopped services. */
export function initializeSessionStorage(
  sessionRoot: string,
  journalRoot: string,
  conditions: OfflineStorageConditions,
): void {
  offline(conditions)
  const b = binding(sessionRoot, journalRoot)
  inspectOverlaps(b)
  // Refuse live/malformed old locks; migration never discards unknown ownership.
  const legacy: string[] = []
  const scan = (dir: string): void => {
    if (!exists(dir)) return
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name)
      if (item.isDirectory() && file !== b.journalRoot && item.name !== '.coordination') scan(file)
      if (item.name.endsWith('.jsonl.lock')) {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8')) as Owner
        if (!validOwner(owner, false) || alive(owner.pid))
          throw new Error('Live or unknown legacy writer blocks migration')
        legacy.push(file)
      }
    }
  }

  scan(b.sessionRoot)
  const ownerDir = path.join(b.sessionRoot, '.coordination')
  if (exists(ownerDir))
    for (const name of fs.readdirSync(ownerDir)) {
      if (name.endsWith('.owner')) {
        const owner = readOwner(path.join(ownerDir, name))
        if (!owner || alive(owner.pid)) throw new Error('Live or unknown writer blocks storage initialization')
      }
    }

  for (const root of [b.sessionRoot, b.journalRoot]) {
    fs.mkdirSync(root, {mode: 0o700, recursive: true})
    const file = path.join(root, bindingName)
    if (exists(file)) {
      if (!same(b, readBinding(root))) throw new Error('Conflicting storage binding')
    } else writeExclusive(file, b)
    syncDirectory(root)
    syncDirectory(path.dirname(root))
  }

  // Both bindings must be durable before deleting classified legacy evidence.
  validateBinding(b)
  for (const file of legacy) {
    fs.unlinkSync(file)
    syncDirectory(path.dirname(file))
  }
}

export function sessionScope(sessionRoot: string, journalRoot: string, sessionId: string): SessionScope {
  validateSessionId(sessionId)
  const b = binding(sessionRoot, journalRoot)
  validateBinding(b)
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
  validateBinding({...scope, version: 1})
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
  offline(conditions)
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
