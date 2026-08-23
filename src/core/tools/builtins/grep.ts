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
  hasUtf8BinaryMarker,
  resolveToolPath,
  truncateText,
} from './shared.js'

const grepSchema = z.object({
  contextLines: z.number().int().min(0).max(20).optional(),
  glob: z.string().min(1).optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().positive().max(20_000).optional(),
  literal: z.boolean().optional(),
  path: z.string().min(1).optional(),
  pattern: z.string().min(1),
})

export type GrepToolInput = z.infer<typeof grepSchema>

interface GrepMatch {
  column: number
  context?: Array<{line: number; text: string}>
  line: number
  path: string
  text: string
}

export function createGrepTool() {
  return defineBuiltinTool({
    description: 'Search UTF-8 file contents with a regular expression or literal text.',
    // File discovery, regex matching, context projection, and truncation share one deterministic search boundary.
    // eslint-disable-next-line complexity
    async execute(input, context) {
      const requestedPath = input.path ?? '.'
      const target = resolveToolPath(context.cwd, requestedPath)
      const stat = await fs.stat(target)
      const base = stat.isDirectory() ? target : path.dirname(target)
      const files = stat.isDirectory()
        ? await fastGlob(input.glob ?? '**/*', {
            absolute: true,
            cwd: base,
            dot: true,
            followSymbolicLinks: false,
            ignore: DEFAULT_IGNORES,
            onlyFiles: true,
            unique: true,
          })
        : [target]
      const accepts = await createGitIgnoreFilter(base)
      const sourcePattern = input.literal ? escapeRegExp(input.pattern) : input.pattern
      const expression = new RegExp(sourcePattern, input.ignoreCase ? 'giu' : 'gu')
      const limit = input.limit ?? DEFAULT_RESULT_LIMIT
      const matches: GrepMatch[] = []

      for (const file of files.sort((left, right) => left.localeCompare(right, 'en'))) {
        if (context.signal.aborted) throw new Error('Grep search aborted.')
        const relativeToBase = path.relative(base, file)
        if (!accepts(relativeToBase)) continue
        // Files are intentionally scanned in stable order so the result limit remains deterministic.
        // eslint-disable-next-line no-await-in-loop
        const buffer = await fs.readFile(file)
        if (hasUtf8BinaryMarker(buffer)) continue
        const lines = buffer.toString('utf8').split(/\r?\n/u)
        for (const [index, line] of lines.entries()) {
          expression.lastIndex = 0
          let match = expression.exec(line)
          while (match !== null) {
            const contextLines = input.contextLines ?? 0
            matches.push({
              column: match.index + 1,
              ...(contextLines === 0
                ? {}
                : {
                    context: lines
                      .slice(Math.max(0, index - contextLines), index + contextLines + 1)
                      .map((text, contextIndex) => ({
                        line: Math.max(0, index - contextLines) + contextIndex + 1,
                        text,
                      }))
                      .filter((contextLine) => contextLine.line !== index + 1),
                  }),
              line: index + 1,
              path: displayPath(context.cwd, file, path.isAbsolute(requestedPath)),
              text: line,
            })
            if (matches.length >= limit) break
            if (match[0].length === 0) expression.lastIndex += 1
            match = expression.exec(line)
          }

          if (matches.length >= limit) break
        }

        if (matches.length >= limit) break
      }

      const rendered = matches.flatMap((match) => renderMatch(match)).join('\n')
      const truncated = truncateText(rendered || '[no matches]')
      return textToolResult(truncated.text, {
        details: {
          matches,
          truncated: truncated.truncated || matches.length >= limit,
        },
      })
    },
    name: 'grep',
    scheduling: 'parallel',
    schema: grepSchema,
  })
}

function renderMatch(match: GrepMatch): string[] {
  const before = match.context?.filter((line) => line.line < match.line) ?? []
  const after = match.context?.filter((line) => line.line > match.line) ?? []
  return [
    ...before.map((line) => `${match.path}-${line.line}-${line.text}`),
    `${match.path}:${match.line}:${match.column}:${match.text}`,
    ...after.map((line) => `${match.path}-${line.line}-${line.text}`),
  ]
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}
