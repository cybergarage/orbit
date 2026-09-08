// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {
  DEFAULT_RESULT_LIMIT,
  displayPath,
  hasUtf8BinaryMarker,
  readOnlyFailure,
  resolveToolPath,
  truncateText,
} from './shared.js'

const readSchema = z.object({
  limit: z.number().int().positive().max(20_000).optional(),
  offset: z.number().int().positive().optional(),
  path: z.string().min(1),
})

export type ReadToolInput = z.infer<typeof readSchema>

export function createReadTool() {
  return defineBuiltinTool({
    description: 'Read a UTF-8 text file. Use offset and limit for large files.',
    async execute(input, context) {
      try {
        const file = resolveToolPath(context.cwd, input.path)
        const stat = await fs.stat(file)
        if (stat.isDirectory())
          return textToolResult(`Cannot read directory: ${input.path}. Use list instead.`, {isError: true})
        if (!stat.isFile()) return textToolResult(`Cannot read non-file path: ${input.path}`, {isError: true})

        const buffer = await fs.readFile(file)
        if (hasUtf8BinaryMarker(buffer))
          return textToolResult(`Cannot read binary file as UTF-8 text: ${input.path}`, {isError: true})
        const value = buffer.toString('utf8')
        const lines = value.split(/\r?\n/u)
        const offset = input.offset ?? 1
        const limit = input.limit ?? DEFAULT_RESULT_LIMIT
        const selected = lines.slice(offset - 1, offset - 1 + limit).join('\n')
        const truncated = truncateText(selected)
        const end = Math.min(lines.length, offset + limit - 1)
        return textToolResult(truncated.text, {
          details: {
            encoding: 'utf8',
            endLine: end,
            path: displayPath(context.cwd, file, path.isAbsolute(input.path)),
            startLine: offset,
            totalLines: lines.length,
            truncated: truncated.truncated || end < lines.length,
          },
        })
      } catch (error) {
        const failure = readOnlyFailure(error)
        if (failure) return failure
        throw error
      }
    },
    name: 'read',
    scheduling: 'parallel',
    schema: readSchema,
  })
}
