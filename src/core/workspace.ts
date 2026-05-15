// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {DOT_APP_DIR_NAME} from './app.js'

export interface WorkspaceLocator {
  directories(): Promise<string[]>
}

export interface LocalWorkspaceLocatorOptions {
  start?: string
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

export class LocalWorkspaceLocator implements WorkspaceLocator {
  private readonly start: string

  constructor(options: LocalWorkspaceLocatorOptions = {}) {
    this.start = options.start ?? process.cwd()
  }

  async directories(): Promise<string[]> {
    const dirs: string[] = []
    let dir = path.resolve(this.start)
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      if (await exists(path.join(dir, DOT_APP_DIR_NAME))) dirs.push(dir)
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }

    return dirs.reverse()
  }
}
