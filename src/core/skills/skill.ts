// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {readFileSync} from 'node:fs'

import {InvalidInputError} from '../errors/index.js'

export type SkillSource = {content: string; file?: never} | {content?: never; file: string}

export type SkillConfig = SkillMetadata & SkillSource

export interface SkillMetadata {
  description?: string
  name?: string
}

export type SkillSourceInfo = {file: string; kind: 'file'} | {kind: 'content'}

interface ParsedSkillContent {
  instructions: string
  metadata: SkillMetadata
}

const FRONTMATTER_BOUNDARY = '---'
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/
const METADATA_KEYS = new Set<keyof SkillMetadata>(['description', 'name'])

export class Skill {
  public readonly content: string
  public readonly description?: string
  public readonly instructions: string
  public readonly name?: string
  public readonly source: SkillSourceInfo

  constructor(config: SkillConfig) {
    const {content, source} = loadSkillContent(config)
    const parsed = parseSkillContent(content)

    this.content = content
    this.description = config.description?.trim() || parsed.metadata.description
    this.instructions = parsed.instructions
    this.name = config.name?.trim() || parsed.metadata.name
    this.source = source
  }
}

function loadSkillContent(config: SkillConfig): {content: string; source: SkillSourceInfo} {
  if ('content' in config && typeof config.content === 'string') {
    return {content: config.content, source: {kind: 'content'}}
  }

  if ('file' in config && typeof config.file === 'string') {
    try {
      return {
        content: readFileSync(config.file, 'utf8'),
        source: {file: config.file, kind: 'file'},
      }
    } catch (error) {
      throw new InvalidInputError(`Failed to load skill file: ${config.file}`, {cause: error})
    }
  }

  throw new InvalidInputError('Skill requires either content or file.')
}

function parseSkillContent(content: string): ParsedSkillContent {
  const match = content.match(FRONTMATTER_PATTERN)
  if (!match) return {instructions: content.trim(), metadata: {}}

  const [, frontmatter = '', body = ''] = match
  return {
    instructions: body.trim(),
    metadata: parseFrontmatter(frontmatter),
  }
}

function parseFrontmatter(frontmatter: string): SkillMetadata {
  const metadata: SkillMetadata = {}

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine === FRONTMATTER_BOUNDARY) continue

    const separatorIndex = trimmedLine.indexOf(':')
    if (separatorIndex <= 0) continue

    const key = trimmedLine.slice(0, separatorIndex).trim()
    if (!isSkillMetadataKey(key)) continue

    const value = trimmedLine.slice(separatorIndex + 1).trim()
    metadata[key] = stripYamlStringQuotes(value)
  }

  return metadata
}

function isSkillMetadataKey(key: string): key is keyof SkillMetadata {
  return METADATA_KEYS.has(key as keyof SkillMetadata)
}

function stripYamlStringQuotes(value: string): string {
  if (value.length < 2) return value

  const first = value[0]
  const last = value.at(-1)
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim()
  }

  return value
}
