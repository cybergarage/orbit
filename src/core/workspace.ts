// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {DOT_APP_DIR_NAME} from './app.js'

export interface WorkspaceLocator {
  directories(): Promise<string[]>
  files(pattern: RegExp | string): Promise<string[]>
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

  async files(pattern: RegExp | string): Promise<string[]> {
    const files: string[] = []
    const directories = await this.directories()

    for (const dir of directories) {
      // eslint-disable-next-line no-await-in-loop
      const entries = await fs.readdir(dir, {withFileTypes: true})
      const matchingFiles = entries
        .filter((entry) => entry.isFile() && matchesPattern(pattern, entry.name))
        .map((entry) => entry.name)
        .sort()

      for (const fileName of matchingFiles) {
        files.push(path.join(dir, fileName))
      }
    }

    return files
  }
}

function matchesPattern(pattern: RegExp | string, value: string): boolean {
  if (typeof pattern === 'string') return value === pattern

  pattern.lastIndex = 0
  return pattern.test(value)
}
