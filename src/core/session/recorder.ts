// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {JournalLevel} from '../execution/journal.js'
import type {SessionScope} from './coordination.js'
import type {SessionEntry, SessionHeaderEntry} from './entries.js'
import type {SessionWriterLease} from './writer-lease.js'

import {syncDirectories} from '../execution/journal.js'
import {encodeSessionEntry, parseSessionFile} from './codec.js'
import {canonicalStoragePath, inspectTranscript, isSessionLocked, sessionScope, WriterClaim} from './coordination.js'
import {EvidenceHandles, evidencePath} from './evidence-io.js'
import {sessionFilePath} from './paths.js'
import {issueWriterLease} from './writer-lease.js'

export class SessionRecorder {
  public readonly file: string
  private closed = false
  private closePromise?: Promise<void>
  private readonly evidenceHandles = new EvidenceHandles()
  private managedLease = false
  private queue: Promise<void> = Promise.resolve()
  private releaseWaiter?: () => void

  private constructor(
    file: string,
    private readonly claim: WriterClaim,
  ) {
    this.file = path.resolve(file)
  }

  static create(file: string, header: SessionHeaderEntry, scope: SessionScope): SessionRecorder {
    const resolved = path.resolve(file)
    const claim = WriterClaim.acquire(scope, () => {
      if (header.id !== scope.sessionId || sessionFilePath(scope.sessionRoot, header.id, header.timestamp) !== resolved)
        throw new Error('Transcript identity mismatch')
      inspectTranscript(scope, resolved, true)
      fsSync.mkdirSync(path.dirname(resolved), {mode: 0o700, recursive: true})
      fsSync.writeFileSync(resolved, encodeSessionEntry(header), {flag: 'wx', mode: 0o600})
    })
    return new SessionRecorder(resolved, claim)
  }

  /** Read-only conservative legacy wrapper; no registration or stale lock removal. */
  static isOpen(file: string): boolean {
    try {
      const resolved = canonicalStoragePath(file)
      const parsed = parseSessionFile(fsSync.readFileSync(resolved, 'utf8'), resolved)
      const root = path.resolve(path.dirname(resolved), '../../..')
      const b = JSON.parse(fsSync.readFileSync(path.join(root, '.orbit-session-binding.json'), 'utf8')) as {
        journalRoot: string
      }
      const scope = sessionScope(root, b.journalRoot, parsed.header.id)
      inspectTranscript(scope, resolved)
      return isSessionLocked(scope)
    } catch {
      return true
    }
  }

  static open(file: string, scope: SessionScope): SessionRecorder {
    const resolved = path.resolve(file)
    const claim = WriterClaim.acquire(scope, () => {
      inspectTranscript(scope, resolved)
      const parsed = parseSessionFile(fsSync.readFileSync(resolved, 'utf8'), resolved)
      if (parsed.header.version === 3 && parsed.recovered)
        throw new Error('Incomplete v3 transcript requires offline inspection')
      if (parsed.recovered)
        fsSync.writeFileSync(resolved, parsed.entries.map((entry) => encodeSessionEntry(entry)).join(''), {mode: 0o600})
      if (
        parsed.entries.some(
          (entry) =>
            entry.type === 'compaction' || entry.type === 'skill_context' || entry.type === 'context_projection',
        )
      ) {
        const descriptor = fsSync.openSync(resolved, 'r+')
        try {
          fsSync.fsyncSync(descriptor)
        } finally {
          fsSync.closeSync(descriptor)
        }

        const directory = fsSync.openSync(path.dirname(resolved), 'r')
        try {
          fsSync.fsyncSync(directory)
        } finally {
          fsSync.closeSync(directory)
        }
      }
    })
    return new SessionRecorder(resolved, claim)
  }

  get scope(): SessionScope {
    return this.claim.scope
  }

  acquireManagedLease(): SessionWriterLease {
    if (this.closed || this.managedLease) throw new Error('Session writer is busy or closed')
    this.claim.assertLive()
    this.managedLease = true
    return issueWriterLease(
      this.scope,
      () => this.claim.assertLive(),
      () => {
        this.managedLease = false
        this.releaseWaiter?.()
      },
    )
  }

  append(entry: SessionEntry): void {
    if (this.closed) throw new Error('Session recorder is closed')
    const encoded = encodeSessionEntry(entry)
    this.queue = this.queue.then(() => fs.appendFile(this.file, encoded, {encoding: 'utf8'}))
    this.queue.catch(() => {})
  }

  close(): Promise<void> {
    this.closed = true
    this.closePromise ??= (async () => {
      if (this.managedLease)
        await new Promise<void>((resolve) => {
          this.releaseWaiter = resolve
        })
      try {
        await this.queue
      } finally {
        await this.evidenceHandles.settle()
        this.claim.release()
      }
    })()
    const pending = this.closePromise
    pending.catch(() => {
      if (this.closePromise === pending) this.closePromise = undefined
    })
    return pending
  }

  async flush(): Promise<void> {
    await this.queue
  }

  hasManagedLease(): boolean {
    return this.managedLease
  }

  async settleContextEvidence(): Promise<void> {
    await this.evidenceHandles.settle()
  }

  synchronize(level: JournalLevel): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Session recorder is closed'))
    this.queue = this.queue.then(async () => {
      const handle = await fs.open(this.file, 'r+')
      try {
        await handle.sync()
      } finally {
        await this.evidenceHandles.close(() => handle.close())
      }

      if (level === 'file-and-directory-sync')
        await syncDirectories(path.dirname(this.file), level, this.evidenceHandles.ownedIO())
    })
    this.queue.catch(() => {})
    return this.queue
  }

  /** Bounded reread under the current writer claim; never repairs or authorizes an old Run. */
  async verifyContextSource(maxBytes: number): Promise<string> {
    await this.queue
    this.evidenceHandles.check()
    this.claim.assertLive()
    const identity = await evidencePath(this.file)
    let text: string
    // Reject aliases before opening; O_NOFOLLOW also closes the final-component race.
    if (canonicalStoragePath(this.file) !== this.file) throw new Error('Context source alias changed')
    // eslint-disable-next-line no-bitwise
    const handle = await fs.open(this.file, fsSync.constants.O_RDWR | fsSync.constants.O_NOFOLLOW)
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
        throw new Error('Context source limit or identity')
      const chunks: Buffer[] = []
      let total = 0
      while (true) {
        const buffer = Buffer.alloc(Math.min(65_536, maxBytes - total + 1))
        // Ordered bounded reads remain owned until close settles.
        // eslint-disable-next-line no-await-in-loop
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, null)
        if (!bytesRead) break
        total += bytesRead
        if (total > maxBytes) throw new Error('Context source limit')
        chunks.push(buffer.subarray(0, bytesRead))
      }

      const after = await handle.stat()
      const named = await fs.lstat(this.file)
      if (
        named.isSymbolicLink() ||
        named.dev !== before.dev ||
        named.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        named.nlink !== 1
      )
        throw new Error('Context source changed during read')
      await handle.sync()
      this.claim.assertLive()
      if (canonicalStoragePath(this.file) !== this.file) throw new Error('Context source alias changed')
      const bytes = Buffer.concat(chunks)
      text = bytes.toString('utf8')
      if (!Buffer.from(text).equals(bytes) || !text.endsWith('\n')) throw new Error('Incomplete context source')
    } finally {
      await this.evidenceHandles.close(() => handle.close())
    }

    this.claim.assertLive()
    if ((await evidencePath(this.file)) !== identity) throw new Error('Context source changed during acknowledgement')
    return text
  }
}
