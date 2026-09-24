// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Sequential I/O enforces global byte/entry bounds and descriptor ownership.
/* eslint-disable no-await-in-loop */
import {constants} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {canonicalJSON, copyJSON} from '../execution/journal.js'
import {contained, packagePath} from '../plugins/files.js'
import {parseSkillSource, SKILL_PORTABLE_PROJECTION_REVISION, skillDigest, skillProjectionRevision} from './parser.js'

export interface SkillRoot {
  directory: string
  id: string
  plugin?: {digest: string; id: string; root: string}
}
export interface SkillSelection {
  digest: string
  id: string
}
export interface SkillLimits {
  candidates: number
  entries: number
  fileBytes: number
  listingBytes: number
  roots: number
  selections: number
}
export const DEFAULT_SKILL_LIMITS: Readonly<SkillLimits> = Object.freeze({
  candidates: 128,
  entries: 4096,
  fileBytes: 65_536,
  listingBytes: 2_097_152,
  roots: 8,
  selections: 4,
})
export interface SkillCandidate extends SkillSelection {
  allowedTools?: string
  baseDirectory: string
  bytes: number
  compatibility?: string
  description: string
  file: string
  license?: string
  metadata?: Record<string, string>
  name: string
  plugin?: {digest: string; id: string; resolvedDirectory: string; resolvedFile: string; root: string}
  rootDirectory: string
  rootId: string
}
export interface SkillSnapshot extends SkillCandidate {
  body: string
  projectionRevision: string
  source: string
}
export interface SkillListing {
  candidates: SkillCandidate[]
  complete: boolean
  issues: string[]
}
export type SkillIO = Pick<typeof fs, 'lstat' | 'open' | 'opendir' | 'realpath'>
interface Observation {
  candidate: SkillCandidate
  directory: string
  file: string
  root: string
}
const identity = (s: {dev: bigint | number; ino: bigint | number}) => `${s.dev}:${s.ino}`
const unchanged = (s: {
  ctimeMs: bigint | number
  dev: bigint | number
  ino: bigint | number
  mtimeMs: bigint | number
  size: bigint | number
}) => `${identity(s)}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('Skill operation cancelled')
}

export const skillId = (rootId: string, directory: string, file: string) =>
  skillDigest(canonicalJSON(['skill-path-v1', rootId, directory, path.relative(directory, file)]))
export function normalizeSkillSelections(value: readonly SkillSelection[] = []): SkillSelection[] {
  if (!Array.isArray(value)) throw new Error('Skill selections must be an array')
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || !/^[a-f0-9]{64}$/u.test(item.id) || !/^[a-f0-9]{64}$/u.test(item.digest) || seen.has(item.id))
      throw new Error('Invalid or duplicate Skill selection')
    seen.add(item.id)
    return {digest: item.digest, id: item.id}
  })
}

export function parseSkillSelection(value: string): SkillSelection {
  const [id, digest, extra] = value.split('@')
  if (extra !== undefined) throw new Error('Use Skill ID@DIGEST')
  return normalizeSkillSelections([{digest, id}])[0]
}

/** Explicit roots only. Listing retains metadata and filesystem observations, never instruction bodies. */
export class SkillCatalog {
  readonly limits: Readonly<SkillLimits>
  private canonicalRoots: unknown = null
  private failedCloses = new Set<() => Promise<void>>()
  private observations = new Map<string, Observation>()
  private pending = new Set<Promise<unknown>>()
  private readonly roots: readonly SkillRoot[]

  constructor(
    roots: readonly SkillRoot[],
    limits: Partial<SkillLimits> = {},
    private readonly io: SkillIO = fs,
  ) {
    this.limits = Object.freeze({...DEFAULT_SKILL_LIMITS, ...limits})
    if (Object.values(this.limits).some((n) => !Number.isSafeInteger(n) || n < 1))
      throw new Error('Invalid Skill limits')
    if (roots.length > this.limits.roots) throw new Error('Skill root limit exceeded')
    const ids = new Set<string>()
    this.roots = roots.map(({directory, id, plugin}) => {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id) || ids.has(id) || typeof directory !== 'string' || !directory)
        throw new Error('Invalid Skill root')
      ids.add(id)
      return Object.freeze({directory: path.resolve(directory), id, ...(plugin ? {plugin: copyJSON(plugin)} : {})})
    })
  }

  get configuration(): string {
    return skillDigest(
      canonicalJSON({
        canonicalRoots: this.canonicalRoots,
        limits: this.limits,
        revision: SKILL_PORTABLE_PROJECTION_REVISION,
        roots: this.roots,
      }),
    )
  }

  /** Copy the listed observations into an independent request/Run I/O owner. */
  createReader(): SkillCatalog {
    const reader = new SkillCatalog(this.roots, this.limits, this.io)
    reader.observations = new Map(this.observations)
    reader.canonicalRoots = copyJSON(this.canonicalRoots)
    return reader
  }

  list(signal?: AbortSignal): Promise<SkillListing> {
    return this.track(this.listOwned(signal))
  }

  resolve(selections: readonly SkillSelection[], signal?: AbortSignal): Promise<SkillSnapshot[]> {
    return this.track(this.resolveOwned(selections, signal))
  }

  async settle(): Promise<void> {
    await Promise.allSettled(this.pending)
    const results = await Promise.allSettled(
      [...this.failedCloses].map(async (close) => {
        await close()
        this.failedCloses.delete(close)
      }),
    )
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Skill resource cleanup remains unconfirmed')
  }

  withRoots(roots: readonly SkillRoot[]): SkillCatalog {
    return new SkillCatalog([...this.roots, ...roots], this.limits, this.io)
  }

  private async closeResource(close: () => Promise<void>): Promise<void> {
    try {
      await close()
    } catch (error) {
      this.failedCloses.add(close)
      throw error
    }
  }

  private async listOwned(signal?: AbortSignal): Promise<SkillListing> {
    if (this.failedCloses.size > 0) throw new Error('Skill resource cleanup requires settle()')
    const result: SkillListing = {candidates: [], complete: true, issues: []}
    const issue = (message: string) => {
      result.complete = false
      result.issues.push(message)
    }

    const roots: Array<SkillRoot & {identity: string}> = []
    const realRoots = new Set<string>()
    const seenObjects = new Set<string>()
    const observations = new Map<string, Observation>()
    for (const root of this.roots) {
      check(signal)
      let directory: string
      try {
        directory = await this.io.realpath(root.directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        issue(`Missing Skill root: ${root.id}`)
        continue
      }

      const stat = await this.io.lstat(directory)
      if (!stat.isDirectory() || realRoots.has(directory) || seenObjects.has(identity(stat)))
        throw new Error('Conflicting Skill root aliases')
      realRoots.add(directory)
      seenObjects.add(identity(stat))
      roots.push({...root, directory, identity: identity(stat)})
    }

    let bytes = 0
    let candidates = 0
    let entries = 0
    for (const root of roots) {
      check(signal)
      let dir: Awaited<ReturnType<SkillIO['opendir']>>
      try {
        dir = await this.io.opendir(root.directory)
      } catch (error) {
        check(signal)
        issue(`${root.id}: ${error instanceof Error ? error.message : 'Skill root read failed'}`)
        continue
      }

      try {
        for (;;) {
          check(signal)
          if (entries >= this.limits.entries) {
            issue('Skill directory entry limit exceeded')
            break
          }

          const entry = await dir.read()
          if (!entry) break
          entries++
          if (!entry.isDirectory() && !(root.plugin && entry.isSymbolicLink())) continue
          if (candidates >= this.limits.candidates) {
            issue('Skill candidate limit exceeded')
            break
          }

          candidates++
          const base = path.join(root.directory, entry.name)
          const file = path.join(base, 'SKILL.md')
          if (root.plugin) {
            try {
              await this.io.lstat(file)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
              issue(`${root.id}/${entry.name}: Skill file unavailable`)
              continue
            }
          }

          try {
            const plugin = root.plugin
              ? {
                  ...root.plugin,
                  resolvedDirectory: await packagePath(root.plugin.root, base, 'directory'),
                  resolvedFile: await packagePath(root.plugin.root, file, 'file'),
                }
              : undefined
            const before = await this.observe(root.directory, base, file, plugin)
            if (before.root !== root.identity) throw new Error('Skill root changed')
            const remaining = this.limits.listingBytes - bytes
            if (remaining <= 0) {
              issue('Skill listing byte limit exceeded')
              break
            }

            const read = await this.read(
              plugin?.resolvedFile ?? file,
              Math.min(this.limits.fileBytes + 1, remaining),
              signal,
              (count) => {
                bytes += count
              },
            )
            if (!read.eof) {
              if (read.bytes.length > this.limits.fileBytes) throw new Error('Skill file byte limit exceeded')
              throw new Error('Skill listing byte limit exceeded')
            }

            const after = await this.observe(root.directory, base, file, plugin)
            if (canonicalJSON(before) !== canonicalJSON(after) || read.identity !== before.file)
              throw new Error('Skill identity changed')
            const source = new TextDecoder('utf8', {fatal: true, ignoreBOM: true}).decode(read.bytes)
            const parsed = parseSkillSource(source)
            if (parsed.name !== entry.name) throw new Error('Skill name must match its directory')
            const candidate: SkillCandidate = {
              ...(plugin ? {plugin} : {}),
              ...(parsed.allowedTools === undefined ? {} : {allowedTools: parsed.allowedTools}),
              ...(parsed.metadata === undefined ? {} : {metadata: parsed.metadata}),
              ...(parsed.license === undefined ? {} : {license: parsed.license}),
              ...(parsed.compatibility === undefined ? {} : {compatibility: parsed.compatibility}),
              baseDirectory: base,
              bytes: read.bytes.length,
              description: parsed.description,
              digest: skillDigest(read.bytes),
              file,
              id: skillId(root.id, root.directory, file),
              name: parsed.name,
              rootDirectory: root.directory,
              rootId: root.id,
            }
            observations.set(candidate.id, {candidate, ...before})
            result.candidates.push(candidate)
          } catch (error) {
            check(signal)
            issue(`${root.id}/${entry.name}: ${error instanceof Error ? error.message : 'Skill read failed'}`)
          }
        }
      } finally {
        await this.closeResource(() => dir.close())
      }

      if (entries >= this.limits.entries || candidates >= this.limits.candidates || bytes >= this.limits.listingBytes) {
        if (root !== roots.at(-1)) issue('Skill listing limit reached before remaining roots')
        break
      }
    }

    check(signal)
    if (this.failedCloses.size > 0) throw new Error('Skill close failed; call settle() before reuse')
    this.canonicalRoots = roots.map(({directory, id}) => ({directory, id}))
    this.observations = observations
    result.candidates.sort((a, b) => a.id.localeCompare(b.id))
    return copyJSON(result)
  }

  private async observe(
    root: string,
    directory: string,
    file: string,
    plugin?: SkillCandidate['plugin'],
  ): Promise<{directory: string; file: string; root: string}> {
    if (plugin) {
      if (
        !contained(plugin.root, root) ||
        (await packagePath(plugin.root, directory, 'directory')) !== plugin.resolvedDirectory ||
        (await packagePath(plugin.root, file, 'file')) !== plugin.resolvedFile
      )
        throw new Error('Plugin Skill path changed')
      const [d, f, r] = await Promise.all([
        this.io.lstat(plugin.resolvedDirectory),
        this.io.lstat(plugin.resolvedFile),
        this.io.lstat(root),
      ])
      return {directory: identity(d), file: unchanged(f), root: identity(r)}
    }

    const d = await this.io.lstat(directory)
    const f = await this.io.lstat(file)
    const r = await this.io.lstat(root)
    if (
      !r.isDirectory() ||
      !d.isDirectory() ||
      !f.isFile() ||
      f.nlink !== 1 ||
      (await this.io.realpath(root)) !== root ||
      (await this.io.realpath(directory)) !== directory ||
      (await this.io.realpath(file)) !== file
    )
      throw new Error('Skill path must retain regular canonical identity')
    return {directory: identity(d), file: unchanged(f), root: identity(r)}
  }

  private async read(
    file: string,
    limit: number,
    signal?: AbortSignal,
    onBytes?: (count: number) => void,
  ): Promise<{bytes: Buffer; eof: boolean; identity: string}> {
    check(signal)
    const handle = await this.io.open(
      file,
      // Numeric flags prevent symlink/FIFO blocking before fstat validation.
      // eslint-disable-next-line no-bitwise
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    )
    try {
      check(signal)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Skill must be a single-link regular file')
      const chunks: Buffer[] = []
      let eof = false
      let length = 0
      while (length < limit) {
        check(signal)
        const chunk = Buffer.alloc(Math.min(8192, limit - length))
        // A failed read may already have consumed bytes. Reserve its full request;
        // refund only the known unread part of an acknowledged read.
        onBytes?.(chunk.length)
        const {bytesRead} = await handle.read(chunk, 0, chunk.length, null)
        onBytes?.(bytesRead - chunk.length)
        if (!bytesRead) {
          eof = true
          break
        }

        chunks.push(chunk.subarray(0, bytesRead))
        length += bytesRead
      }

      const after = await handle.stat()
      if (unchanged(stat) !== unchanged(after)) throw new Error('Skill changed while reading')
      check(signal)
      return {bytes: Buffer.concat(chunks), eof, identity: unchanged(stat)}
    } finally {
      await this.closeResource(() => handle.close())
    }
  }

  private async resolveOwned(selections: readonly SkillSelection[], signal?: AbortSignal): Promise<SkillSnapshot[]> {
    if (this.failedCloses.size > 0) throw new Error('Skill resource cleanup requires settle()')
    const selected = normalizeSkillSelections(selections)
    if (selected.length > this.limits.selections) throw new Error('Skill selection limit exceeded')
    const {observations} = this
    const result: SkillSnapshot[] = []
    for (const selection of selected) {
      check(signal)
      const known = observations.get(selection.id)
      if (!known || known.candidate.digest !== selection.digest)
        throw new Error('Refresh Skill listing and explicitly reselect')
      const c = known.candidate
      const configured = this.roots.find((root) => root.id === c.rootId)
      if (!configured || (await this.io.realpath(configured.directory)) !== c.rootDirectory)
        throw new Error('Skill root binding changed; refresh listing')
      const before = await this.observe(c.rootDirectory, c.baseDirectory, c.file, c.plugin)
      if (canonicalJSON(before) !== canonicalJSON({directory: known.directory, file: known.file, root: known.root}))
        throw new Error('Skill identity changed; refresh listing')
      const read = await this.read(c.plugin?.resolvedFile ?? c.file, this.limits.fileBytes + 1, signal)
      const after = await this.observe(c.rootDirectory, c.baseDirectory, c.file, c.plugin)
      if ((await this.io.realpath(configured.directory)) !== c.rootDirectory)
        throw new Error('Skill root binding changed during loading; refresh listing')
      if (
        !read.eof ||
        read.bytes.length > this.limits.fileBytes ||
        read.identity !== known.file ||
        canonicalJSON(before) !== canonicalJSON(after) ||
        skillDigest(read.bytes) !== selection.digest
      )
        throw new Error('Skill source changed; refresh listing')
      const source = new TextDecoder('utf8', {fatal: true, ignoreBOM: true}).decode(read.bytes)
      const parsed = parseSkillSource(source)
      if (
        parsed.name !== c.name ||
        parsed.description !== c.description ||
        parsed.license !== c.license ||
        parsed.compatibility !== c.compatibility ||
        parsed.allowedTools !== c.allowedTools ||
        canonicalJSON(parsed.metadata ?? null) !== canonicalJSON(c.metadata ?? null)
      )
        throw new Error('Skill metadata changed')
      result.push({
        ...c,
        ...parsed,
        projectionRevision: c.plugin ? SKILL_PORTABLE_PROJECTION_REVISION : skillProjectionRevision(parsed),
        source,
      })
    }

    check(signal)
    return result
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    )
    return promise
  }
}
