// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import type {JournalLevel} from './journal.js'

import {safeIdentity, syncDirectories, syncDirectory} from './journal.js'

export function deletionMarker(root: string, id: string): string {
  return path.join(root, 'deletions', `${safeIdentity(id)}.json`)
}

export async function readDeletionMarker(
  root: string,
  id: string,
): Promise<undefined | {sessionId: string; state: 'completed' | 'deleting'; version: 1}> {
  try {
    const marker = JSON.parse(await fs.readFile(deletionMarker(root, id), 'utf8'))
    if (marker.version !== 1 || marker.sessionId !== id || !['completed', 'deleting'].includes(marker.state))
      throw new Error('Invalid deletion marker')
    return marker
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeDeletionMarker(
  root: string,
  id: string,
  state: 'completed' | 'deleting',
  level: JournalLevel,
): Promise<void> {
  const file = deletionMarker(root, id)
  await syncDirectories(path.dirname(file), level)
  const temp = `${file}.pending`
  const handle = await fs.open(temp, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify({sessionId: id, state, version: 1})}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }

  await fs.rename(temp, file)
  if (level === 'file-and-directory-sync') await syncDirectory(path.dirname(file))
}
