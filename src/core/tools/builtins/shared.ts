// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import ignoreModule, {type Ignore} from 'ignore'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {textToolResult, type ToolResult} from '../definition.js'

const mutationQueues = new Map<string, Promise<unknown>>()
const createIgnore = ignoreModule as unknown as () => Ignore

export const DEFAULT_MAX_OUTPUT_BYTES = 200_000
export const DEFAULT_RESULT_LIMIT = 2000
export const DEFAULT_IGNORES = ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/coverage/**']

/** Only settled, expected filesystem read failures become model-visible errors. */
export function readOnlyFailure(error: unknown): ToolResult | undefined {
  if (!(error instanceof Error)) return undefined
  const {code} = error as NodeJS.ErrnoException
  if (!code || !['EACCES', 'EISDIR', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(code)) return undefined
  return textToolResult(error.message, {isError: true})
}

export function resolveToolPath(cwd: string, value = '.'): string {
  return path.resolve(cwd, value)
}

export function displayPath(cwd: string, resolvedPath: string, absoluteInput = false): string {
  if (absoluteInput) return resolvedPath
  const relative = path.relative(cwd, resolvedPath)
  return relative.length === 0 ? '.' : relative.split(path.sep).join('/')
}

export function truncateText(value: string, maxBytes = DEFAULT_MAX_OUTPUT_BYTES): {text: string; truncated: boolean} {
  const bytes = Buffer.byteLength(value)
  if (bytes <= maxBytes) return {text: value, truncated: false}

  let end = Math.min(value.length, maxBytes)
  while (Buffer.byteLength(value.slice(0, end)) > maxBytes) end -= 1
  return {text: `${value.slice(0, end)}\n[output truncated]`, truncated: true}
}

export async function atomicWrite(file: string, content: string, createDirectories = true): Promise<void> {
  const directory = path.dirname(file)
  if (createDirectories) await fs.mkdir(directory, {recursive: true})
  const temporary = path.join(directory, `.${path.basename(file)}.orbit-${process.pid}-${randomUUID()}.tmp`)
  let mode: number | undefined
  try {
    mode = (await fs.stat(file)).mode
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    await fs.writeFile(temporary, content, 'utf8')
    if (mode !== undefined) await fs.chmod(temporary, mode)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.unlink(temporary).catch(() => {})
    throw error
  }
}

export function withFileMutation<Result>(file: string, operation: () => Promise<Result>): Promise<Result> {
  const key = path.resolve(file)
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  mutationQueues.set(key, current)
  current
    .finally(() => {
      if (mutationQueues.get(key) === current) mutationQueues.delete(key)
    })
    .catch(() => {})
  return current
}

export function countOccurrences(content: string, search: string): number {
  if (search.length === 0) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = content.indexOf(search, offset)
    if (index === -1) return count
    count += 1
    offset = index + search.length
  }
}

export function hasUtf8BinaryMarker(value: Buffer): boolean {
  return value.includes(0)
}

export async function createGitIgnoreFilter(
  base: string,
): Promise<(candidate: string, directory?: boolean) => boolean> {
  const matcher = createIgnore()
  try {
    matcher.add(await fs.readFile(path.join(base, '.gitignore'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return (candidate, directory = false) => {
    const normalized = candidate.split(path.sep).join('/').replace(/^\.\//u, '')
    if (normalized.length === 0 || normalized.startsWith('../')) return true
    return !matcher.ignores(directory ? `${normalized}/` : normalized)
  }
}
