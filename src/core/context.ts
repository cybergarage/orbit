// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import process from 'node:process'

import {LocalWorkspaceLocator} from './workspace.js'

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

export async function loadSystemContexts(startDir = process.cwd()): Promise<Context[]> {
  const files = await new LocalWorkspaceLocator({start: startDir}).files(AGENTS_FILE_NAME)
  const matches: Context[] = []

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const content = await fs.readFile(file, 'utf8')
    if (content) matches.push({content, source: {file, kind: 'compat'}})
  }

  return matches
}
