// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import {APP_NAME} from './app.js'
import {findWorkspaceRoot} from './workspace.js'

export type ContextSource =
  | {file: string; kind: 'compat'}
  | {file: string; kind: 'global'}
  | {file: string; kind: 'workspace'}
  | {kind: 'none'}

const AGENT_FILES = [`${APP_NAME.toUpperCase()}.md`, 'AGENTS.md']

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

export async function loadContext(startDir: string): Promise<{source: ContextSource; text: string}> {
  // 1) Workspace root
  const root = await findWorkspaceRoot(startDir)
  const rootChecks = await Promise.all(
    AGENT_FILES.map(async (f) => {
      const p = path.join(root, f)
      const t = await readIfExists(p)
      return t ? {source: {file: p, kind: 'compat'} as ContextSource, text: t} : null
    }),
  )
  const rootMatch = rootChecks.find((r) => r !== null)
  if (rootMatch) return rootMatch

  // 2) Compatibility (search upwards to root)
  const dirs: string[] = []
  let dir = path.resolve(startDir)
  while (true) {
    dirs.push(dir)
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const allChecks = await Promise.all(
    dirs.flatMap((d) =>
      AGENT_FILES.map(async (f) => {
        const p = path.join(d, f)
        const t = await readIfExists(p)
        return t ? {source: {file: p, kind: 'compat'} as ContextSource, text: t} : null
      }),
    ),
  )
  const match = allChecks.find((r) => r !== null)
  if (match) return match

  return {source: {kind: 'none'}, text: ''}
}
