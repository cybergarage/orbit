// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import process from 'node:process'

import type {JournalLevel} from '../execution/journal.js'

/** Node cannot acknowledge directory flushes on Windows. Never downgrade an explicit request. */
export function assertSupportedSyncLevel(level: JournalLevel, platform = process.platform): void {
  if (level === 'file-and-directory-sync' && platform === 'win32')
    throw new Error('Directory sync acknowledgement is unsupported on Windows; select file-sync explicitly')
}

export function defaultFileSyncLevel(platform = process.platform): Exclude<JournalLevel, 'memory'> {
  return platform === 'win32' ? 'file-sync' : 'file-and-directory-sync'
}

/** Preserve POSIX readable-handle fsync; Windows FlushFileBuffers requires write access. */
export function fileSyncAccess(platform = process.platform): number {
  return platform === 'win32' ? fs.constants.O_RDWR : fs.constants.O_RDONLY
}

/** Coordination namespace changes on Windows do not claim power-loss directory durability. */
export function syncSupportedDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const descriptor = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}
