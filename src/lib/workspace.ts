// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import {APP_NAME} from './app.js'

const DOT_APP_NAME = '.' + APP_NAME.toLowerCase()

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

export async function findWorkspaceRoot(startDir: string): Promise<string> {
  let dir = path.resolve(startDir)
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    if (await exists(path.join(dir, DOT_APP_NAME))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return path.resolve(startDir)
}

export function workspaceDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOT_APP_NAME)
}
