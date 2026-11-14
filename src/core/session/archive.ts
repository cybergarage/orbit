// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {SessionScope} from './coordination.js'

import {validateSessionId} from './coordination.js'
import {syncSupportedDirectory} from './durability.js'
import {encodeMetadataRecord, validateMetadataRecord} from './metadata.js'

function archivePath(root: string, id: string): string {
  return path.join(root, '.coordination', validateSessionId(id) + '.archive.json')
}

/** Missing metadata is the compatible active default; corrupt metadata is an error. */
function readArchiveRecord(root: string, id: string): Record<string, unknown> | undefined {
  const file = archivePath(root, id)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || fs.realpathSync(file) !== file)
      throw new Error('Invalid session archive metadata')
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    validateMetadataRecord(value)
    if (value.sessionId !== id || typeof value.archived !== 'boolean')
      throw new Error('Invalid session archive metadata')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export function readSessionArchive(root: string, id: string): boolean {
  return (readArchiveRecord(root, id)?.archived as boolean | undefined) ?? false
}

/** Caller holds the registered session writer claim throughout this transition. */
export async function writeSessionArchive(scope: SessionScope, archived: boolean): Promise<void> {
  const file = archivePath(scope.sessionRoot, scope.sessionId)
  const before = readArchiveRecord(scope.sessionRoot, scope.sessionId)
  const encoded = encodeMetadataRecord({...before, archived, sessionId: scope.sessionId})
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
