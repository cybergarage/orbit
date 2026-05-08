// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {APP_NAME} from './app.js'
import {findWorkspaceDirectories} from './workspace.js'

export type ContextSource =
  | {file: string; kind: 'compat'}
  | {file: string; kind: 'global'}
  | {file: string; kind: 'workspace'}
  | {kind: 'none'}

export interface Context {
  content: string
  source: ContextSource
}

const AGENTS_FILE_NAME = 'AGENTS.md'

function agentFiles(): string[] {
  return [`${APP_NAME.toUpperCase()}.md`, AGENTS_FILE_NAME]
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function readIfExists(p: string): Promise<null | string> {
  if (!(await exists(p))) return null
  return fs.readFile(p, 'utf8')
}

export async function loadSystemContext(startDir = process.cwd()): Promise<Context> {
  const directories = await findWorkspaceDirectories(startDir)
  const agentFileNames = agentFiles()
  let match: Context | null = null

  for (const dir of directories) {
    for (const fileName of agentFileNames) {
      const file = path.join(dir, fileName)
      // eslint-disable-next-line no-await-in-loop
      const content = await readIfExists(file)
      if (content) match = {content, source: {file, kind: 'compat'}}
    }
  }

  if (match) return match

  return {content: '', source: {kind: 'none'}}
}
