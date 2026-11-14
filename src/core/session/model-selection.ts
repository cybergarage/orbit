// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {z} from 'zod'

import type {SessionScope} from './coordination.js'

import {canonicalStoragePath, validateSessionId} from './coordination.js'
import {syncSupportedDirectory} from './durability.js'
import {encodeMetadataRecord, validateMetadataRecord} from './metadata.js'

export const modelSelectionSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    provider: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .max(80),
  })
  .strict()
export type ModelSelection = z.infer<typeof modelSelectionSchema>
function selectionPath(root: string, id: string) {
  return path.join(root, '.coordination', validateSessionId(id) + '.model.json')
}

function readSelectionRecord(root: string, id: string) {
  const file = selectionPath(root, id)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || fs.realpathSync(file) !== file)
      throw new Error('Invalid model selection metadata')
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    validateMetadataRecord(record)
    if (record.sessionId !== id) throw new Error('Invalid model selection metadata')
    return {...record, selection: modelSelectionSchema.loose().parse(record.selection)}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export function readModelSelection(root: string, id: string): ModelSelection | undefined {
  const record = readSelectionRecord(root, id)
  return record
    ? modelSelectionSchema.parse({model: record.selection.model, provider: record.selection.provider})
    : undefined
}

/** Caller holds the registered writer claim. Original transcript and turn context remain immutable. */
export function writeModelSelection(scope: SessionScope, selection: ModelSelection): void {
  const value = modelSelectionSchema.parse(selection)
  const before = readSelectionRecord(scope.sessionRoot, scope.sessionId)
  const encoded = encodeMetadataRecord({
    ...before,
    selection: {...before?.selection, ...value},
    sessionId: scope.sessionId,
  })
  const file = selectionPath(scope.sessionRoot, scope.sessionId)
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, encoded)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }

    fs.renameSync(temporary, file)
    syncSupportedDirectory(path.dirname(file))
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

export function removeModelSelection(scope: SessionScope): void {
  fs.rmSync(selectionPath(scope.sessionRoot, scope.sessionId), {force: true})
  syncSupportedDirectory(path.join(scope.sessionRoot, '.coordination'))
}

export function guiDefaultModelPath(root: string): string {
  return path.join(canonicalStoragePath(root), '.coordination', 'gui-default-model.json')
}

export function readGuiDefaultModel(root: string): ModelSelection | undefined {
  const file = guiDefaultModelPath(root)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || fs.realpathSync(file) !== file)
      throw new Error('Invalid GUI default model metadata')
    return modelSelectionSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
