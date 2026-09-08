// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fastGlob from 'fast-glob'
import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {
  createGitIgnoreFilter,
  DEFAULT_IGNORES,
  DEFAULT_RESULT_LIMIT,
  displayPath,
  readOnlyFailure,
  resolveToolPath,
} from './shared.js'

const globSchema = z.object({
  includeDirectories: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  limit: z.number().int().positive().max(100_000).optional(),
  path: z.string().min(1).optional(),
  pattern: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
})

export type GlobToolInput = z.infer<typeof globSchema>

export function createGlobTool() {
  return defineBuiltinTool({
    description: 'Find files and directories whose relative paths match one or more glob patterns.',
    async execute(input, context) {
      try {
        const requestedPath = input.path ?? '.'
        const base = resolveToolPath(context.cwd, requestedPath)
        const stat = await fs.stat(base)
        if (!stat.isDirectory())
          return textToolResult(`Glob base path is not a directory: ${requestedPath}`, {isError: true})
        const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern]
        const candidates = await fastGlob(patterns, {
          absolute: true,
          cwd: base,
          dot: input.includeHidden === true,
          followSymbolicLinks: false,
          ignore: DEFAULT_IGNORES,
          onlyFiles: input.includeDirectories !== true,
          unique: true,
        })
        const accepts = await createGitIgnoreFilter(base)
        const unique = new Map<string, {directory: boolean; output: string}>()
        for (const candidate of candidates) {
          if (context.signal.aborted) throw new Error('Glob search aborted.')
          // Filesystem metadata must be resolved for each candidate before applying directory-specific ignore rules.
          // eslint-disable-next-line no-await-in-loop
          const candidateStat = await fs.lstat(candidate)
          const relativeToBase = path.relative(base, candidate)
          if (!accepts(relativeToBase, candidateStat.isDirectory())) continue
          const output = displayPath(context.cwd, candidate, path.isAbsolute(requestedPath))
          unique.set(output, {directory: candidateStat.isDirectory(), output})
        }

        const allResults = [...unique.values()].sort((left, right) => left.output.localeCompare(right.output, 'en'))
        const limit = input.limit ?? DEFAULT_RESULT_LIMIT
        const results = allResults.slice(0, limit)
        return textToolResult(
          results.map((result) => `${result.output}${result.directory ? '/' : ''}`).join('\n') || '[no matches]',
          {
            details: {
              matches: results.map((result) => result.output),
              omitted: Math.max(0, allResults.length - results.length),
              truncated: results.length < allResults.length,
            },
          },
        )
      } catch (error) {
        const failure = readOnlyFailure(error)
        if (failure) return failure
        throw error
      }
    },
    name: 'glob',
    scheduling: 'parallel',
    schema: globSchema,
  })
}
