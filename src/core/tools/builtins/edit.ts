// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {atomicWrite, countOccurrences, displayPath, resolveToolPath, withFileMutation} from './shared.js'

const editSchema = z.object({
  newText: z.string(),
  oldText: z.string().min(1),
  path: z.string().min(1),
  replaceAll: z.boolean().optional(),
})

export type EditToolInput = z.infer<typeof editSchema>

export function createEditTool() {
  return defineBuiltinTool({
    description: 'Replace exact text in a UTF-8 file. The old text must be unique unless replaceAll is true.',
    async execute(input, context) {
      const file = resolveToolPath(context.cwd, input.path)
      return withFileMutation(file, async () => {
        const content = await fs.readFile(file, 'utf8')
        const matches = countOccurrences(content, input.oldText)
        if (matches === 0) throw new Error(`Text to replace was not found in ${input.path}`)
        if (matches > 1 && input.replaceAll !== true) {
          throw new Error(
            `Text to replace occurs ${matches} times in ${input.path}; set replaceAll or provide more context.`,
          )
        }

        const updated = input.replaceAll
          ? content.split(input.oldText).join(input.newText)
          : content.replace(input.oldText, input.newText)
        if (updated === content) throw new Error(`Edit did not change ${input.path}`)
        await atomicWrite(file, updated)
        const replacements = input.replaceAll ? matches : 1
        return textToolResult(`Updated ${displayPath(context.cwd, file, path.isAbsolute(input.path))}`, {
          details: {
            bytes: Buffer.byteLength(updated),
            path: displayPath(context.cwd, file, path.isAbsolute(input.path)),
            replacements,
          },
        })
      })
    },
    name: 'edit',
    scheduling: 'serial',
    schema: editSchema,
  })
}
