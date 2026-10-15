// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {z} from 'zod'

import type {SessionScope} from './coordination.js'

import {displayNameSchema} from '../display-name.js'
import {ProjectStoreError} from '../projects/types.js'
import {validateSessionId} from './coordination.js'
import {syncSupportedDirectory} from './durability.js'

export const sessionRenameSchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    operationId: z.string().uuid(),
    title: displayNameSchema.nullable(),
  })
  .strict()
export type SessionRenameOptions = z.input<typeof sessionRenameSchema>
export interface SessionTitle {
  title?: string
  titleRevision: number
}
const recordSchema = sessionRenameSchema.extend({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sessionId: z.string(),
  version: z.literal(1),
})

function titlePath(root: string, id: string): string {
  return path.join(root, '.coordination', validateSessionId(id) + '.title.json')
}

function readRecord(root: string, id: string) {
  const file = titlePath(root, id)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || fs.realpathSync(file) !== file)
      throw new Error('Invalid session title metadata')
    const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
    if (record.sessionId !== id || record.revision !== record.expectedRevision + 1)
      throw new Error('Invalid session title metadata')
    return record
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export function readSessionTitle(root: string, id: string): SessionTitle {
  const record = readRecord(root, id)
  return {titleRevision: record?.revision ?? 0, ...(record?.title ? {title: record.title} : {})}
}

/** Caller holds the registered writer claim and has inspected transcript and recovery evidence. */
export function writeSessionTitle(scope: SessionScope, options: SessionRenameOptions): SessionTitle {
  const parsed = sessionRenameSchema.safeParse(options)
  if (!parsed.success) throw new ProjectStoreError('invalid', 'Invalid session rename input')
  const input = parsed.data
  const before = readRecord(scope.sessionRoot, scope.sessionId)
  if (before?.operationId === input.operationId) {
    if (before.expectedRevision !== input.expectedRevision || before.title !== input.title)
      throw new ProjectStoreError('conflict', 'Session rename operation input changed')
  } else if ((before?.revision ?? 0) !== input.expectedRevision) {
    throw new ProjectStoreError('conflict', 'Session title revision changed; refresh before renaming')
  }

  const record = {...input, revision: input.expectedRevision + 1, sessionId: scope.sessionId, version: 1}
  const file = titlePath(scope.sessionRoot, scope.sessionId)
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify(record) + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }

    fs.renameSync(temporary, file)
    syncSupportedDirectory(path.dirname(file))
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }

  return {titleRevision: record.revision, ...(input.title === null ? {} : {title: input.title})}
}

/** Called by deletion while the writer claim and deletion marker protect the identity. */
export function removeSessionTitle(scope: SessionScope): void {
  fs.rmSync(titlePath(scope.sessionRoot, scope.sessionId), {force: true})
  syncSupportedDirectory(path.join(scope.sessionRoot, '.coordination'))
}
