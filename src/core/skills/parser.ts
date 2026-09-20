// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import {isAlias, isMap, isScalar, parseDocument, visit} from 'yaml'

export const SKILL_PROJECTION_REVISION = 'yaml-2.9.1-body-v1'
export const SKILL_METADATA_PROJECTION_REVISION = 'yaml-2.9.1-body-v2'
export interface SkillMetadata {
  compatibility?: string
  description: string
  license?: string
  name: string
}
export function skillProjectionRevision(metadata: SkillMetadata): string {
  return metadata.license !== undefined || metadata.compatibility !== undefined
    ? SKILL_METADATA_PROJECTION_REVISION
    : SKILL_PROJECTION_REVISION
}

export const SKILL_RECORD_BYTES = 4 * 1024 * 1024
export const SKILL_RECORD_SNAPSHOTS = 4
export function skillDigest(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parseSkillSource(source: string): SkillMetadata & {body: string} {
  const view = source.startsWith('\uFEFF') ? source.slice(1) : source
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(view)
  if (!match) throw new Error('Skill requires closed YAML frontmatter')
  const doc = parseDocument(match[1], {prettyErrors: false, strict: true, uniqueKeys: true})
  if (doc.errors.length > 0 || doc.warnings.length > 0 || !isMap(doc.contents))
    throw new Error('Invalid Skill metadata')
  visit(doc, (_key, node) => {
    const tagged = node as null | {anchor?: unknown; tag?: unknown}
    if (isAlias(node) || tagged?.anchor || tagged?.tag) throw new Error('Skill aliases, anchors and tags are forbidden')
  })
  const values: Record<string, string> = {}
  for (const pair of doc.contents.items) {
    if (
      !isScalar(pair.key) ||
      !isScalar(pair.value) ||
      typeof pair.key.value !== 'string' ||
      typeof pair.value.value !== 'string'
    )
      throw new Error('Skill metadata must contain string scalars')
    if (!['compatibility', 'description', 'license', 'name'].includes(pair.key.value))
      throw new Error('Unsupported Skill metadata key')
    if (pair.key.anchor || pair.key.tag || pair.value.anchor || pair.value.tag) throw new Error('Tagged Skill metadata')
    values[pair.key.value] = pair.value.value
  }

  const {compatibility, description, license, name} = values
  if (license !== undefined && !license.trim()) throw new Error('Invalid Skill license')
  if (compatibility !== undefined && (!compatibility.trim() || [...compatibility].length > 500))
    throw new Error('Invalid Skill compatibility')
  if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) throw new Error('Invalid Skill name')
  if (!description?.trim() || [...description].length > 1024) throw new Error('Invalid Skill description')
  const body = match[2].trim()
  if (!body) throw new Error('Skill instructions are empty')
  return {
    body,
    description,
    name,
    ...(license === undefined ? {} : {license}),
    ...(compatibility === undefined ? {} : {compatibility}),
  }
}
