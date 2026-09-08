// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const bindingName = '.orbit-session-binding.json'
const guardName = '.orbit-registration.guard'
const stagedPrefix = '.orbit-binding-'
interface Pair {
  journalRoot: string
  sessionRoot: string
}
interface LegacyBinding extends Pair {
  version: 1
}
export interface RegisteredStorage extends Pair {
  pairId: string
  version: 2
}
interface RegistrationGuard extends Pair {
  attemptId: string
  pairId: string
  version: 1
}
interface Artifact {
  bytes: Buffer
  file: string
  stat: fs.Stats
}
export interface OfflineStorageConditions {
  allWritersStopped: true
  automaticRestartersDisabled: true
  exclusiveStorageControl: true
}
export interface RegistrationResumeOptions {
  /** Exact SHA-256 values from an independently reviewed offline inspection; never infer review from a flag alone. */
  reviewedArtifacts?: Readonly<Record<string, string>>
}
export interface StorageRegistrationInspection extends Pair {
  artifacts: {file: string; kind: 'binding' | 'guard' | 'staging'; sha256?: string}[]
  detail?: string
  pairId?: string
  state: 'conflicting' | 'legacy' | 'pending' | 'ready' | 'unregistered'
}

export function assertOfflineStorage(conditions: OfflineStorageConditions): void {
  if (
    !conditions ||
    conditions.allWritersStopped !== true ||
    conditions.automaticRestartersDisabled !== true ||
    conditions.exclusiveStorageControl !== true
  )
    throw new Error('Offline maintenance requires stopped writers/restarters and external exclusive storage control')
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

function pair(sessionRoot: string, journalRoot: string): Pair {
  return {journalRoot: canonicalStoragePath(journalRoot), sessionRoot: canonicalStoragePath(sessionRoot)}
}

function present(file: string): boolean {
  try {
    fs.lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

function roots(p: Pair): string[] {
  return [p.sessionRoot, p.journalRoot]
}

function samePair(a: Pair, b: Pair): boolean {
  return a.sessionRoot === b.sessionRoot && a.journalRoot === b.journalRoot
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function identity(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

function readArtifact(file: string): Artifact {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid registration artifact: ' + file)
  // eslint-disable-next-line no-bitwise -- combine Node filesystem open flags
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    if (!identity(stat, fs.fstatSync(fd))) throw new Error('Registration artifact identity changed')
    const bytes = fs.readFileSync(fd)
    if (!identity(stat, fs.lstatSync(file))) throw new Error('Registration artifact identity changed')
    return {bytes, file, stat}
  } finally {
    fs.closeSync(fd)
  }
}

function parsed(a: Artifact): unknown {
  try {
    return JSON.parse(a.bytes.toString('utf8'))
  } catch {
    return undefined
  }
}

function object(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function uuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(v)
}

function validPair(v: unknown): v is Pair & Record<string, unknown> {
  return object(v) && typeof v.sessionRoot === 'string' && typeof v.journalRoot === 'string'
}

function binding(v: unknown): v is LegacyBinding | RegisteredStorage {
  return (
    validPair(v) &&
    ((v.version === 1 && Object.keys(v).sort().join(',') === 'journalRoot,sessionRoot,version') ||
      (v.version === 2 &&
        uuid(v.pairId) &&
        Object.keys(v).sort().join(',') === 'journalRoot,pairId,sessionRoot,version'))
  )
}

function guard(v: unknown): v is RegistrationGuard {
  return (
    validPair(v) &&
    v.version === 1 &&
    uuid(v.pairId) &&
    uuid(v.attemptId) &&
    Object.keys(v).sort().join(',') === 'attemptId,journalRoot,pairId,sessionRoot,version'
  )
}

function topology(p: Pair): void {
  if (
    p.sessionRoot === p.journalRoot ||
    p.sessionRoot.startsWith(p.journalRoot + path.sep) ||
    (p.journalRoot.startsWith(p.sessionRoot + path.sep) && p.journalRoot !== path.join(p.sessionRoot, '.runs'))
  )
    throw new Error('Overlapping session/journal roots are unsupported except the same binding .runs pair')
}

export function readRegisteredStorage(sessionRoot: string, journalRoot: string): RegisteredStorage {
  const p = pair(sessionRoot, journalRoot)
  try {
    topology(p)
    if (
      roots(p).some(
        (root) =>
          present(path.join(root, guardName)) || fs.readdirSync(root).some((name) => name.startsWith(stagedPrefix)),
      )
    )
      throw new Error('Registration pending')
    const values = roots(p).map((root) => parsed(readArtifact(path.join(root, bindingName))))
    if (!values.every((v) => binding(v) && v.version === 2 && samePair(p, v)))
      throw new Error('Missing or legacy registration')
    const [s, j] = values as RegisteredStorage[]
    if (s.pairId !== j.pairId) throw new Error('Conflicting pair identity')
    if (
      roots(p).some(
        (root) =>
          present(path.join(root, guardName)) || fs.readdirSync(root).some((name) => name.startsWith(stagedPrefix)),
      )
    )
      throw new Error('Registration pending')
    return s
  } catch (error) {
    throw new Error(
      'Session storage is unregistered, incomplete or conflicting; run offline storage initialization or resume',
      {cause: error},
    )
  }
}

/** Read-only diagnostic, not writable authority or evidence of operator exclusion. */
export function inspectSessionStorage(sessionRoot: string, journalRoot: string): StorageRegistrationInspection {
  const p = pair(sessionRoot, journalRoot)
  const result: StorageRegistrationInspection = {...p, artifacts: [], state: 'unregistered'}
  try {
    topology(p)
    for (const root of roots(p)) {
      const names = [
        [bindingName, 'binding'],
        [guardName, 'guard'],
      ] as const
      for (const [name, kind] of names) {
        const file = path.join(root, name)
        if (present(file)) {
          const item: StorageRegistrationInspection['artifacts'][number] = {file, kind}
          result.artifacts.push(item)
          item.sha256 = digest(readArtifact(file).bytes)
        }
      }

      if (present(root))
        for (const name of fs.readdirSync(root))
          if (name.startsWith(stagedPrefix)) {
            const file = path.join(root, name)
            result.artifacts.push({file, kind: 'staging', sha256: digest(readArtifact(file).bytes)})
          }
    }

    if (result.artifacts.some((a) => a.kind !== 'binding')) result.state = 'pending'
    else if (result.artifacts.length > 0) {
      const values = result.artifacts.map((a) => parsed(readArtifact(a.file)))
      if (values.length === 2 && values.every((v) => binding(v) && v.version === 1 && samePair(p, v)))
        result.state = 'legacy'
      else if (
        values.length === 2 &&
        values.every((v) => binding(v) && v.version === 2 && samePair(p, v)) &&
        (values[0] as RegisteredStorage).pairId === (values[1] as RegisteredStorage).pairId
      ) {
        // Keep I/O errors as diagnostic failures; a resume must not interpret
        // a failed ready-state read as ordinary incomplete metadata and repair it.
        result.pairId = readRegisteredStorage(p.sessionRoot, p.journalRoot).pairId
        result.state = 'ready'
      } else result.state = 'conflicting'
    }
  } catch (error) {
    result.state = 'conflicting'
    result.detail = String(error)
  }

  return result
}

function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function ensureDirectory(directory: string): void {
  if (present(directory)) {
    if (!fs.lstatSync(directory).isDirectory() || canonicalStoragePath(directory) !== directory)
      throw new Error('Ambiguous registration directory')
    return
  }

  ensureDirectory(path.dirname(directory))
  fs.mkdirSync(directory, {mode: 0o700})
  syncDirectory(directory)
  syncDirectory(path.dirname(directory))
}

function verifyArtifact(a: Artifact): void {
  const current = readArtifact(a.file)
  if (!identity(a.stat, current.stat) || !current.bytes.equals(a.bytes))
    throw new Error('Registration artifact changed during maintenance')
}

function syncArtifact(a: Artifact): void {
  verifyArtifact(a)
  // eslint-disable-next-line no-bitwise -- combine Node filesystem open flags
  const fd = fs.openSync(a.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    if (!identity(a.stat, fs.fstatSync(fd))) throw new Error('Registration artifact identity changed')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  verifyArtifact(a)
  syncDirectory(path.dirname(a.file))
}

function exclusive(file: string, bytes: Buffer | string): void {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  syncDirectory(path.dirname(file))
}

function reviewed(a: Artifact, options: RegistrationResumeOptions): boolean {
  return options.reviewedArtifacts?.[a.file] === digest(a.bytes)
}

function preserveEvidence(a: Artifact): void {
  verifyArtifact(a)
  const file = path.join(path.dirname(a.file), '.orbit-registration-evidence-' + digest(a.bytes) + '.bin')
  if (present(file)) {
    const existing = readArtifact(file)
    if (existing.bytes.equals(a.bytes)) syncArtifact(existing)
    else {
      // A previous copy may have stopped after exclusive open or a partial write.
      // Keep it unchanged and persist another complete copy of the reviewed source.
      exclusive(file.slice(0, -4) + '-' + randomUUID() + '.bin', a.bytes)
    }
  } else exclusive(file, a.bytes)
}

function rewriteReviewed(a: Artifact, bytes: string): void {
  preserveEvidence(a)
  verifyArtifact(a)
  // eslint-disable-next-line no-bitwise -- combine Node filesystem open flags
  const fd = fs.openSync(a.file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    if (!identity(a.stat, fs.fstatSync(fd))) throw new Error('Registration artifact identity changed')
    fs.ftruncateSync(fd, 0)
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  syncDirectory(path.dirname(a.file))
}

function inspectOverlaps(p: Pair, allowOwn: boolean): void {
  const check = (dir: string): void => {
    if (allowOwn && roots(p).includes(dir)) return
    for (const name of [bindingName, guardName])
      if (present(path.join(dir, name))) throw new Error('Conflicting ancestor or nested storage registration')
  }

  const visit = (dir: string): void => {
    if (!present(dir)) return
    check(dir)
    for (const item of fs.readdirSync(dir, {withFileTypes: true}))
      if (item.isDirectory()) visit(path.join(dir, item.name))
  }

  for (const root of roots(p)) {
    let ancestor = root
    while (true) {
      check(ancestor)
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }

    visit(root)
  }
}

/** Internal implementation shared by the public initialize/resume wrappers. Caller supplies ownership preflight. */
export function configureSessionStorage(
  sessionRoot: string,
  journalRoot: string,
  conditions: OfflineStorageConditions,
  inspectOwnership: (p: Pair) => () => void,
  resume = false,
  options: RegistrationResumeOptions = {},
): void {
  assertOfflineStorage(conditions)
  const p = pair(sessionRoot, journalRoot)
  topology(p)
  inspectOverlaps(p, true)
  const inspection = inspectSessionStorage(p.sessionRoot, p.journalRoot)
  if (!resume && !['legacy', 'ready', 'unregistered'].includes(inspection.state))
    throw new Error('Incomplete registration requires explicit offline storage resume and evidence review')
  if (inspection.detail) throw new Error('Storage inspection failed: ' + inspection.detail)
  const artifacts = inspection.artifacts.map((a) => ({...readArtifact(a.file), kind: a.kind}))
  const bindings = artifacts.filter((a) => a.kind === 'binding')
  const guards = artifacts.filter((a) => a.kind === 'guard')
  const pairIds = new Set<string>()
  const attempts = new Set<string>()
  for (const a of artifacts) {
    const v = parsed(a)
    const valid = a.kind === 'binding' ? binding(v) : a.kind === 'guard' ? guard(v) : false
    if (valid && validPair(v)) {
      if (!samePair(p, v)) throw new Error('Conflicting ancestor or partner storage registration')
      if (typeof v.pairId === 'string') pairIds.add(v.pairId)
      if (a.kind === 'guard' && typeof v.attemptId === 'string') attempts.add(v.attemptId)
    } else if (!resume || !reviewed(a, options))
      throw new Error('Unknown registration artifact requires explicit offline digest review: ' + a.file)
  }

  if (pairIds.size > 1 || attempts.size > 1) throw new Error('Conflicting registration pair or attempt identity')
  const finishOwnership = inspectOwnership(p)
  for (const root of roots(p)) ensureDirectory(root)
  // A previous process may have died after mkdir but before syncing its parent.
  // No marker yet identifies those ancestors, so resync the existing ancestry too.
  const ancestors = new Set<string>()
  for (const root of roots(p)) {
    let current = root
    while (true) {
      ancestors.add(current)
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  for (const directory of [...ancestors].sort((a, b) => a.length - b.length)) syncDirectory(directory)
  const rootStats = roots(p).map((root) => fs.statSync(root))
  const assertRoots = (): void => {
    for (const [i, root] of roots(p).entries()) {
      if (canonicalStoragePath(root) !== root || !identity(rootStats[i], fs.statSync(root)))
        throw new Error('Registration root identity changed')
    }
  }

  const value: RegisteredStorage = {...p, pairId: [...pairIds][0] ?? randomUUID(), version: 2}
  const marker: RegistrationGuard = {
    ...p,
    attemptId: [...attempts][0] ?? randomUUID(),
    pairId: value.pairId,
    version: 1,
  }
  const markerBytes = JSON.stringify(marker) + '\n'
  // Persist every existing/missing guard, including a reviewed torn guard, before mutating registration data.
  for (const root of roots(p)) {
    assertRoots()
    const file = path.join(root, guardName)
    const a = guards.find((a) => a.file === file)
    if (a) syncArtifact(a)
    else exclusive(file, markerBytes)
    assertRoots()
  }

  // Both guard names are durable. In-place metadata repair never removes their exclusion names.
  for (const a of guards)
    if (!guard(parsed(a))) {
      assertRoots()
      rewriteReviewed(a, markerBytes)
      assertRoots()
    }

  for (const a of artifacts.filter((a) => a.kind === 'staging')) {
    assertRoots()
    preserveEvidence(a)
    verifyArtifact(a)
    fs.unlinkSync(a.file)
    syncDirectory(path.dirname(a.file))
    assertRoots()
  }

  const bytes = JSON.stringify(value) + '\n'
  for (const root of roots(p)) {
    assertRoots()
    const file = path.join(root, bindingName)
    const a = bindings.find((a) => a.file === file)
    if (a) {
      const v = parsed(a)
      if (binding(v)) syncArtifact(a)
      else preserveEvidence(a)
      if (!binding(v) || v.version !== 2) {
        const staged = path.join(root, stagedPrefix + randomUUID() + '.tmp')
        exclusive(staged, bytes)
        assertRoots()
        verifyArtifact(a)
        fs.renameSync(staged, file)
        syncDirectory(root)
      }
    } else {
      exclusive(file, bytes)
    }

    assertRoots()
  }

  // Existing matching files are explicitly fsynced as well; read equality is not durability evidence.
  for (const root of roots(p)) {
    assertRoots()
    const a = readArtifact(path.join(root, bindingName))
    const v = parsed(a)
    if (!binding(v) || v.version !== 2 || !samePair(v, p) || v.pairId !== value.pairId)
      throw new Error('Incomplete or conflicting final registration')
    syncArtifact(a)
    syncDirectory(path.dirname(root))
  }

  assertRoots()
  finishOwnership()
  assertRoots()
  for (const root of [p.journalRoot, p.sessionRoot]) {
    assertRoots()
    const a = readArtifact(path.join(root, guardName))
    const v = parsed(a)
    if (!guard(v) || !samePair(v, p) || v.pairId !== marker.pairId || v.attemptId !== marker.attemptId)
      throw new Error('Registration guard identity changed')
    verifyArtifact(a)
    fs.unlinkSync(a.file)
    // Last unlink is logical readiness; sync failure still requires external shutdown and explicit resync.
    syncDirectory(root)
    assertRoots()
  }

  readRegisteredStorage(p.sessionRoot, p.journalRoot)
}
