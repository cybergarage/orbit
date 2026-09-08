// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {DEFAULT_RESULT_LIMIT, displayPath, readOnlyFailure, resolveToolPath} from './shared.js'

const listSchema = z.object({
  includeHidden: z.boolean().optional(),
  limit: z.number().int().positive().max(20_000).optional(),
  path: z.string().min(1).optional(),
})

export type ListToolInput = z.infer<typeof listSchema>

export function createListTool() {
  return defineBuiltinTool({
    description: 'List the immediate entries in a directory in deterministic order.',
    async execute(input, context) {
      try {
        const requestedPath = input.path ?? '.'
        const directory = resolveToolPath(context.cwd, requestedPath)
        const stat = await fs.stat(directory)
        if (!stat.isDirectory())
          return textToolResult(`Cannot list non-directory path: ${requestedPath}`, {isError: true})

        const allEntries = (await fs.readdir(directory, {withFileTypes: true}))
          .filter((entry) => input.includeHidden === true || !entry.name.startsWith('.'))
          .sort((left, right) => left.name.localeCompare(right.name, 'en'))
        const limit = input.limit ?? DEFAULT_RESULT_LIMIT
        const entries = allEntries.slice(0, limit).map((entry) => ({
          kind: entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'other',
          name: entry.name,
        }))
        const text = entries
          .map((entry) => `${entry.kind === 'directory' ? 'directory' : entry.kind}\t${entry.name}`)
          .join('\n')
        return textToolResult(text || '[empty directory]', {
          details: {
            entries,
            omitted: Math.max(0, allEntries.length - entries.length),
            path: displayPath(context.cwd, directory, path.isAbsolute(requestedPath)),
            truncated: entries.length < allEntries.length,
          },
        })
      } catch (error) {
        const failure = readOnlyFailure(error)
        if (failure) return failure
        throw error
      }
    },
    name: 'list',
    scheduling: 'parallel',
    schema: listSchema,
  })
}
