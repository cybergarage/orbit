// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

import type {SessionEntry} from '../session/entries.js'
import type {SkillSnapshot} from './catalog.js'

import {canonicalJSON, copyJSON} from '../execution/journal.js'
import {contained} from '../plugins/files.js'
import {normalizeSkillSelections, skillId} from './catalog.js'
import {
  parseSkillSource,
  SKILL_PORTABLE_PROJECTION_REVISION,
  SKILL_RECORD_BYTES,
  SKILL_RECORD_SNAPSHOTS,
  skillDigest,
  skillProjectionRevision,
} from './parser.js'

export interface SessionSkillEntry {
  id: string
  sessionId: string
  skills: SkillSnapshot[]
  timestamp: string
  turnId: string
  type: 'skill_context'
  version: 1
}
export function parseSkillEntry(value: unknown): SessionSkillEntry {
  const entry = value as SessionSkillEntry
  if (
    !entry ||
    entry.type !== 'skill_context' ||
    entry.version !== 1 ||
    !Array.isArray(entry.skills) ||
    entry.skills.length === 0
  )
    throw new Error('Invalid Skill context record')
  if (entry.skills.length > SKILL_RECORD_SNAPSHOTS) throw new Error('Skill context record snapshot limit exceeded')
  for (const key of ['id', 'sessionId', 'turnId', 'timestamp'] as const)
    if (typeof entry[key] !== 'string' || !entry[key]) throw new Error('Invalid Skill record identity')
  if (Buffer.byteLength(JSON.stringify(entry), 'utf8') > SKILL_RECORD_BYTES)
    throw new Error('Skill record exceeds 4 MiB')
  normalizeSkillSelections(entry.skills)
  for (const skill of entry.skills) {
    for (const key of ['rootId', 'rootDirectory', 'baseDirectory', 'file', 'name', 'description', 'source'] as const)
      if (typeof skill[key] !== 'string' || !skill[key]) throw new Error('Invalid Skill snapshot')
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(skill.rootId)) throw new Error('Invalid Skill root ID')
    if (skill.bytes !== Buffer.byteLength(skill.source, 'utf8') || skill.digest !== skillDigest(skill.source))
      throw new Error('Skill snapshot digest mismatch')
    const decoded = new TextDecoder('utf8', {fatal: true, ignoreBOM: true}).decode(Buffer.from(skill.source))
    if (decoded !== skill.source) throw new Error('Skill source is not lossless UTF-8')
    const portable = skill.projectionRevision === SKILL_PORTABLE_PROJECTION_REVISION
    const parsed = parseSkillSource(skill.source, !portable)
    if (!portable && (skill.plugin !== undefined || skill.allowedTools !== undefined || skill.metadata !== undefined))
      throw new Error('Unexpected portable Skill metadata')
    if (skill.plugin) {
      const p = skill.plugin
      if (
        !portable ||
        typeof p.id !== 'string' ||
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(p.id) ||
        typeof p.digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(p.digest)
      )
        throw new Error('Invalid plugin Skill identity')
      for (const item of [p.root, p.resolvedDirectory, p.resolvedFile])
        if (typeof item !== 'string' || !path.isAbsolute(item)) throw new Error('Invalid plugin Skill path')
      for (const item of [skill.rootDirectory, p.resolvedDirectory, p.resolvedFile])
        if (!contained(p.root, item)) throw new Error('Plugin Skill path escapes')
      if (skill.rootId !== `plugin-${p.id}`) throw new Error('Plugin Skill root mismatch')
    }

    if (
      skill.projectionRevision !== (skill.plugin ? SKILL_PORTABLE_PROJECTION_REVISION : skillProjectionRevision(parsed))
    )
      throw new Error('Unsupported Skill projection revision')
    if (
      parsed.body !== skill.body ||
      parsed.name !== skill.name ||
      parsed.description !== skill.description ||
      parsed.license !== skill.license ||
      parsed.compatibility !== skill.compatibility ||
      parsed.allowedTools !== skill.allowedTools ||
      canonicalJSON(parsed.metadata ?? null) !== canonicalJSON(skill.metadata ?? null)
    )
      throw new Error('Skill snapshot derivation mismatch')
    if (
      !path.isAbsolute(skill.rootDirectory) ||
      path.dirname(skill.baseDirectory) !== skill.rootDirectory ||
      path.basename(skill.baseDirectory) !== skill.name ||
      skill.file !== path.join(skill.baseDirectory, 'SKILL.md') ||
      skill.id !== skillId(skill.rootId, skill.rootDirectory, skill.file)
    )
      throw new Error('Skill snapshot source identity mismatch')
  }

  return copyJSON(entry)
}

export function validateSkillEntries(entries: SessionEntry[], sessionId: string, version: number): void {
  const closed = new Set<string>()
  const contexts = new Set<string>()
  const ids = new Set<string>()
  const messages = new Set<string>()
  const started = new Set<string>()
  const used = new Set<string>()
  for (const entry of entries) {
    if (entry.type === 'turn_context') {
      if (used.has(entry.turnId)) throw new Error('Duplicate context for recorded Skill turn')
      if (contexts.has(entry.turnId)) closed.add(entry.turnId)
      contexts.add(entry.turnId)
    } else if (entry.type === 'turn_event') {
      if (entry.phase === 'started') {
        if (used.has(entry.turnId)) throw new Error('Duplicate start for recorded Skill turn')
        if (started.has(entry.turnId) || !contexts.has(entry.turnId)) closed.add(entry.turnId)
        started.add(entry.turnId)
      } else closed.add(entry.turnId)
    } else if (entry.type === 'message' && entry.turnId && entry.message.type !== 'user') messages.add(entry.turnId)
    else if (entry.type === 'skill_context') {
      parseSkillEntry(entry)
      if (
        ![2, 3].includes(version) ||
        entry.sessionId !== sessionId ||
        !contexts.has(entry.turnId) ||
        !started.has(entry.turnId) ||
        closed.has(entry.turnId) ||
        used.has(entry.turnId) ||
        messages.has(entry.turnId) ||
        ids.has(entry.id)
      )
        throw new Error('Invalid Skill record order or identity')
      used.add(entry.turnId)
      ids.add(entry.id)
    }
  }
}

/** Inspect only top-level type strings without allocating the large JSON object. */
export function hasSkillRecordType(line: string): boolean {
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    switch (c) {
      case '"': {
        const start = i++
        while (i < line.length) {
          if (line[i] === '\\') i += 2
          else if (line[i] === '"') break
          else i++
        }

        if (depth !== 1 || i - start > 32) continue
        const token = line.slice(start, i + 1)
        let next = i + 1
        while (/\s/u.test(line[next] ?? '') && next < line.length) next++
        if (line[next] !== ':') continue
        try {
          if (JSON.parse(token) !== 'type') continue
          next++
          while (/\s/u.test(line[next] ?? '') && next < line.length) next++
          const end = line.indexOf('"', next + 1)
          if (line[next] === '"' && end - next < 80 && JSON.parse(line.slice(next, end + 1)) === 'skill_context')
            return true
        } catch {
          /* Invalid JSON is diagnosed by the normal decoder. */
        }

        break
      }

      case '[': // falls through

      case '{': {
        depth++
        break
      }

      case ']': // falls through

      case '}': {
        depth--
        break
      }
      // No default
    }
  }

  return false
}

export function skillPrefix(skills: readonly SkillSnapshot[]): string[] {
  return skills.map(
    (s) =>
      `Selected Skill for this Run only; instructions do not grant tool permission. Source: ${canonicalJSON({baseDirectory: s.baseDirectory, digest: s.digest, id: s.id, name: s.name})}\n${s.body}`,
  )
}
