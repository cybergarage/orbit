// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {OfflineStorageConditions} from './storage-registration.js'

import {assertStorageResetOffline, initializeSessionStorage} from './coordination.js'
import {canonicalStoragePath} from './storage-registration.js'

export interface StorageResetPaths {
  journalRoot: string
  logRoot: string
  projectFile: string
  sessionRoot: string
}
interface ResetTarget {
  directory: boolean
  identity: null | string
  path: string
}
export interface StorageResetPlan {
  paths: StorageResetPaths
  targets: ResetTarget[]
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function inspectTree(file: string, directory: boolean, roots: Set<string>): void {
  const info = stat(file)
  if (!info) return
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1))
    throw new Error('Unsafe storage reset target: ' + file)
  if (!directory) return
  for (const entry of fs.readdirSync(file, {withFileTypes: true})) {
    const child = path.join(file, entry.name)
    if (['.git', 'AGENTS.md', 'ORBIT.md', 'settings.json'].includes(entry.name))
      throw new Error('Storage reset refuses configuration or workspace content: ' + child)
    if (['.orbit-registration.guard', '.orbit-session-binding.json'].includes(entry.name) && !roots.has(file))
      throw new Error('Nested storage registration blocks reset: ' + child)
    inspectTree(child, entry.isDirectory(), roots)
  }
}

/** Read-only plan. Call again after confirmation to detect target replacement. */
export function planStorageReset(input: StorageResetPaths): StorageResetPlan {
  for (const value of Object.values(input)) {
    if (!path.isAbsolute(value)) throw new Error('Storage reset requires absolute paths')
    if (stat(value)?.isSymbolicLink()) throw new Error('Storage reset refuses a target symlink: ' + value)
  }

  const paths: StorageResetPaths = {
    journalRoot: canonicalStoragePath(input.journalRoot),
    logRoot: canonicalStoragePath(input.logRoot),
    projectFile: canonicalStoragePath(input.projectFile),
    sessionRoot: canonicalStoragePath(input.sessionRoot),
  }
  if (!paths.projectFile.endsWith('.sqlite')) throw new Error('Project reset target must be a .sqlite file')
  const targets: ResetTarget[] = [
    {directory: true, identity: null, path: paths.journalRoot},
    {directory: true, identity: null, path: paths.logRoot},
    ...['-wal', '-shm', '-journal', ''].map((suffix) => ({
      directory: false,
      identity: null,
      path: paths.projectFile + suffix,
    })),
    {directory: true, identity: null, path: paths.sessionRoot},
  ]
  const protectedPaths = [canonicalStoragePath(os.homedir()), canonicalStoragePath(process.cwd())]
  for (const target of targets) {
    if (target.path === path.parse(target.path).root || protectedPaths.some((value) => contains(target.path, value)))
      throw new Error('Storage reset refuses a root, home or working-directory ancestor: ' + target.path)
    for (const other of targets) {
      if (target === other || !contains(target.path, other.path)) continue
      if (
        target.path === paths.sessionRoot &&
        other.path === paths.journalRoot &&
        other.path === path.join(target.path, '.runs')
      )
        continue
      throw new Error('Overlapping storage reset targets: ' + target.path + ' and ' + other.path)
    }

    let ancestor = path.dirname(target.path)
    while (true) {
      if (
        ancestor !== paths.sessionRoot &&
        ancestor !== paths.journalRoot &&
        ['.orbit-session-binding.json', '.orbit-registration.guard'].some((name) => stat(path.join(ancestor, name)))
      )
        throw new Error('Ancestor storage registration blocks reset: ' + ancestor)
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }

    inspectTree(target.path, target.directory, new Set([paths.journalRoot, paths.sessionRoot]))
    const info = stat(target.path)
    target.identity = info ? `${info.dev}:${info.ino}` : null
  }

  // A known partner must never be silently left outside this destructive plan.
  for (const root of [paths.sessionRoot, paths.journalRoot]) {
    for (const name of ['.orbit-session-binding.json', '.orbit-registration.guard']) {
      const file = path.join(root, name)
      if (!stat(file)) continue
      let value: {journalRoot?: unknown; sessionRoot?: unknown}
      const bytes = fs.readFileSync(file, 'utf8')
      try {
        value = JSON.parse(bytes)
      } catch {
        continue
      }

      if (
        value &&
        ((typeof value.sessionRoot === 'string' && value.sessionRoot !== paths.sessionRoot) ||
          (typeof value.journalRoot === 'string' && value.journalRoot !== paths.journalRoot))
      )
        throw new Error('Conflicting storage partner blocks reset: ' + file)
    }
  }

  return {paths, targets}
}

/** Destructive offline administration, intentionally separate from evidence-preserving Session deletion. */
export function resetStorage(plan: StorageResetPlan, conditions: OfflineStorageConditions, initialize = false): void {
  const current = planStorageReset(plan.paths)
  if (JSON.stringify(current) !== JSON.stringify(plan))
    throw new Error('Storage reset targets changed; review a new plan')
  assertStorageResetOffline(plan.paths.sessionRoot, plan.paths.journalRoot, conditions)
  try {
    // Fail closed for ordinary upgraded writers before removing any payload.
    // External exclusion is still mandatory across this non-atomic operation.
    for (const root of [plan.paths.sessionRoot, plan.paths.journalRoot])
      fs.rmSync(path.join(root, '.orbit-session-binding.json'), {force: true})
    for (const target of plan.targets) fs.rmSync(target.path, {force: true, recursive: target.directory})
  } catch (error) {
    const remaining = plan.targets
      .filter((target) => {
        try {
          return Boolean(stat(target.path))
        } catch {
          return true
        }
      })
      .map((target) => target.path)
    throw new Error(
      'Storage reset incomplete. Keep writers/restarters stopped and exclusive control; retry the same reset. Remaining targets:\n' +
        remaining.join('\n'),
      {cause: error},
    )
  }

  if (initialize) {
    try {
      initializeSessionStorage(plan.paths.sessionRoot, plan.paths.journalRoot, conditions)
    } catch (error) {
      throw new Error(
        'Storage was cleared, but initialization failed. Keep exclusive control and use storage inspect/resume with the same roots.',
        {cause: error},
      )
    }
  }
}
