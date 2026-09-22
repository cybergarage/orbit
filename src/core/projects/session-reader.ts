// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import type {ParsedSessionFile} from '../session/codec.js'
import type {SessionRepository} from '../session/repository.js'

import {parseSessionFile} from '../session/codec.js'
import {sessionFilePath} from '../session/paths.js'
import {ProjectStoreError} from './types.js'

/** Bounded inspection rooted in a registered repository, never a browser path. */
export async function readProjectSession(
  repository: SessionRepository,
  id: string,
): Promise<null | {file: string; parsed: ParsedSessionFile}> {
  const scope = repository.scope(id)
  if (await readProjectDeletion(repository, id))
    throw new ProjectStoreError('missing', 'Source session is deleting or deleted')

  let visited = 0
  let found: null | {file: string; parsed: ParsedSessionFile} = null
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) throw new ProjectStoreError('storage', 'Session discovery depth exceeded')
    if ((await fs.realpath(directory)) !== directory)
      throw new ProjectStoreError('storage', 'Ambiguous session directory')
    const entries = await fs.opendir(directory)
    for await (const entry of entries) {
      if (++visited > 10_000) throw new ProjectStoreError('storage', 'Session discovery limit exceeded')
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (file !== scope.journalRoot && entry.name !== '.coordination') {
          // Bound file handles and discovery memory independently of directory size.

          await walk(file, depth + 1)
        }
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        // Registered transcripts have bounded headers. Inspect identity before bodies.

        const handle = await fs.open(file, 'r')
        try {
          const header = Buffer.alloc(65_536)

          const {bytesRead} = await handle.read(header, 0, header.length, 0)
          const end = header.subarray(0, bytesRead).indexOf(10)
          if (end === -1)
            throw new ProjectStoreError('storage', 'Source discovery encountered an incomplete or oversized header')
          let identity: {id?: unknown}
          try {
            identity = JSON.parse(header.subarray(0, end).toString('utf8'))
          } catch {
            throw new ProjectStoreError('storage', 'Source discovery encountered a corrupt header')
          }

          if (identity.id !== id) continue
          if (found) throw new ProjectStoreError('storage', 'Duplicate source session identity')

          const before = await handle.stat()
          if (!before.isFile() || before.nlink !== 1 || before.size > 64 * 1024 * 1024)
            throw new ProjectStoreError('storage', 'Source session exceeds the inspection limit')
          const bytes = Buffer.alloc(before.size + 1)
          let offset = 0
          while (offset < bytes.length) {
            // eslint-disable-next-line no-await-in-loop
            const read = await handle.read(bytes, offset, bytes.length - offset, offset)
            if (!read.bytesRead) break
            offset += read.bytesRead
          }

          const after = await fs.lstat(file)

          if ((await fs.realpath(file)) !== file) throw new ProjectStoreError('storage', 'Ambiguous source transcript')
          if (
            offset !== before.size ||
            after.ino !== before.ino ||
            after.dev !== before.dev ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
          )
            throw new ProjectStoreError('conflict', 'Source session changed during inspection')
          const parsed = parseSessionFile(
            new TextDecoder('utf8', {fatal: true}).decode(bytes.subarray(0, offset)),
            file,
          )
          if (
            parsed.recovered ||
            parsed.header.id !== id ||
            sessionFilePath(scope.sessionRoot, id, parsed.header.timestamp) !== file
          )
            throw new ProjectStoreError('storage', 'Incomplete source session')
          found = {file, parsed}
        } finally {
          await handle.close()
        }
      }
    }
  }

  await walk(scope.sessionRoot, 0)
  if (await readProjectDeletion(repository, id))
    throw new ProjectStoreError('missing', 'Source session is deleting or deleted')

  return found
}

/** Reads bounded deletion evidence without treating corruption as absence. */
export async function readProjectDeletion(
  repository: SessionRepository,
  id: string,
): Promise<'completed' | 'deleting' | undefined> {
  const scope = repository.scope(id)
  const file = path.join(scope.journalRoot, 'deletions', `${id}.json`)
  try {
    const before = await fs.lstat(file)
    if (!before.isFile() || before.nlink !== 1 || before.size > 4096 || (await fs.realpath(file)) !== file)
      throw new ProjectStoreError('storage', 'Ambiguous Project source deletion marker')
    const handle = await fs.open(file, 'r')
    let bytes: Buffer
    try {
      const buffer = Buffer.alloc(4097)
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0)
      const opened = await handle.stat()
      const after = await fs.lstat(file)
      if (
        bytesRead !== before.size ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new ProjectStoreError('storage', 'Project source deletion marker changed during inspection')
      bytes = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }

    const value = JSON.parse(new TextDecoder('utf8', {fatal: true}).decode(bytes))
    if (value.version !== 1 || value.sessionId !== id || !['completed', 'deleting'].includes(value.state))
      throw new ProjectStoreError('storage', 'Invalid Project source deletion marker')
    return value.state
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
