// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {DOT_APP_DIR_NAME} from './app.js'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

export async function findWorkspaceDirectories(startDir = process.cwd()): Promise<string[]> {
  const dirs: string[] = []
  let dir = path.resolve(startDir)
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    if (await exists(path.join(dir, DOT_APP_DIR_NAME))) dirs.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return dirs.reverse()
}
