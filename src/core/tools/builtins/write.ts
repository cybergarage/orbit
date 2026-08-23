// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {atomicWrite, displayPath, resolveToolPath, withFileMutation} from './shared.js'

const writeSchema = z.object({
  content: z.string(),
  createDirectories: z.boolean().optional(),
  path: z.string().min(1),
})

export type WriteToolInput = z.infer<typeof writeSchema>

export function createWriteTool() {
  return defineBuiltinTool({
    description: 'Create a UTF-8 file or completely overwrite an existing file.',
    async execute(input, context) {
      const file = resolveToolPath(context.cwd, input.path)
      return withFileMutation(file, async () => {
        const existed = await fs
          .stat(file)
          .then(() => true)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          })
        await atomicWrite(file, input.content, input.createDirectories ?? true)
        const displayedPath = displayPath(context.cwd, file, path.isAbsolute(input.path))
        return textToolResult(`${existed ? 'Overwrote' : 'Created'} ${displayedPath}`, {
          details: {
            bytes: Buffer.byteLength(input.content),
            existed,
            path: displayedPath,
          },
        })
      })
    },
    name: 'write',
    scheduling: 'serial',
    schema: writeSchema,
  })
}
