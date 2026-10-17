// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {OfflineStorageConditions} from '../session/storage-registration.js'
import type {StorageResetPaths} from '../session/storage-reset.js'

import {assertStorageResetOffline} from '../session/coordination.js'
import {canonicalStoragePath} from '../session/storage-registration.js'
import {planStorageReset} from '../session/storage-reset.js'

export type InitializationMode = 'all' | 'data' | 'settings'
/** Trusted host configuration, never accepted directly from a remote request. */
export interface InitializationProfile {
  cacheRoots: string[]
  ownedRoots: string[]
  preservedPaths: string[]
  scheduledRoots: string[]
  settingsFiles: string[]
  stores: StorageResetPaths[]
}
export interface InitializationTarget {
  bytes: number
  files: number
  identity: string
  kind: 'cache' | 'data' | 'settings'
  path: string
}
export interface InitializationPlan {
  disposition: 'permanent'
  id: string
  mode: InitializationMode
  profile: InitializationProfile
  retained: string[]
  targets: InitializationTarget[]
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

function absolute(file: string): string {
  if (!path.isAbsolute(file) || stat(file)?.isSymbolicLink()) throw new Error('Unsafe initialization path: ' + file)
  return canonicalStoragePath(file)
}

function inspect(file: string, settings: boolean): Omit<InitializationTarget, 'kind' | 'path'> {
  let bytes = 0
  let files = 0
  const hash = createHash('sha256')
  const visit = (current: string) => {
    const info = stat(current)
    if (!info) {
      hash.update('absent:' + current)
      return
    }

    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1)))
      throw new Error('Unsafe initialization entry: ' + current)
    hash.update(JSON.stringify([current, info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs]))
    if (info.isFile()) {
      files++
      bytes += info.size
      return
    }

    if (settings) throw new Error('Settings target must be a file: ' + current)
    for (const entry of fs.readdirSync(current).sort()) {
      if (['.git', 'AGENTS.md', 'ORBIT.md', 'plugins', 'settings.json', 'skills', 'workspace'].includes(entry))
        throw new Error('Initialization refuses workspace or configuration content: ' + path.join(current, entry))
      visit(path.join(current, entry))
    }
  }

  visit(file)
  return {bytes, files, identity: hash.digest('hex')}
}

/** Enumerates metadata only; never returns settings values or transcript contents. */
export function planInitialization(profile: InitializationProfile, mode: InitializationMode): InitializationPlan {
  if (!['all', 'data', 'settings'].includes(mode)) throw new Error('Invalid initialization mode')
  const owned = profile.ownedRoots.map((file) => absolute(file))
  const preserved = profile.preservedPaths.map((file) => absolute(file))
  const protectedPaths = [absolute(os.homedir()), absolute(process.cwd()), ...preserved]
  const paths = new Map<string, InitializationTarget['kind']>()
  const add = (file: string, kind: InitializationTarget['kind']) => {
    const target = absolute(file)
    if (
      target === path.parse(target).root ||
      owned.includes(target) ||
      protectedPaths.some((value) => contains(target, value) || (contains(value, target) && preserved.includes(value)))
    )
      throw new Error('Protected initialization target: ' + target)
    if (
      kind !== 'settings' &&
      owned.some(
        (root) =>
          contains(root, target) &&
          path
            .relative(root, target)
            .split(path.sep)
            .some((part) => ['.git', 'plugins', 'skills', 'workspace'].includes(part)),
      )
    )
      throw new Error('Protected workspace or shared target: ' + target)
    if (kind !== 'settings' && !owned.some((root) => contains(root, target)))
      throw new Error('Target is outside host-owned roots: ' + target)
    if (kind === 'settings' && path.basename(target) !== 'settings.json')
      throw new Error('Only explicitly selected settings.json files can be reset')
    const previous = paths.get(target)
    if (previous && previous !== kind) throw new Error('Conflicting initialization target: ' + target)
    paths.set(target, kind)
  }

  if (mode !== 'settings') {
    for (const store of profile.stores) for (const target of planStorageReset(store).targets) add(target.path, 'data')
    for (const root of profile.scheduledRoots) add(root, 'data')
  }

  if (mode !== 'data') for (const file of profile.settingsFiles) add(file, 'settings')
  if (mode === 'all') for (const root of profile.cacheRoots) add(root, 'cache')
  // Nested journal roots are already validated by planStorageReset; delete only their parent once.
  const entries = [...paths].filter(
    ([file]) =>
      ![...paths].some(
        ([parent, kind]) =>
          parent !== file &&
          contains(parent, file) &&
          kind === 'data' &&
          profile.stores.some(
            (s) =>
              absolute(s.sessionRoot) === parent &&
              absolute(s.journalRoot) === file &&
              file === path.join(parent, '.runs'),
          ),
      ),
  )
  for (const [file] of entries)
    for (const [other] of entries)
      if (file !== other && contains(file, other)) throw new Error('Overlapping initialization targets')
  const targets = entries.map(([file, kind]) => ({...inspect(file, kind === 'settings'), kind, path: file}))
  const retained = [
    'User workspaces and files',
    'Skills, AGENTS.md and ORBIT.md',
    'Environment credentials',
    'Plugin data, Docker images and Ollama models',
    'Unselected settings files',
    ...preserved,
  ]
  const body = {disposition: 'permanent' as const, mode, profile: structuredClone(profile), retained, targets}
  return {...body, id: createHash('sha256').update(JSON.stringify(body)).digest('hex')}
}

export interface InitializationConsent extends OfflineStorageConditions {
  confirmation: 'INITIALIZE'
}
/** No Trash, backups or staging copies. External exclusion must remain in force through failures. */
export function executeInitialization(plan: InitializationPlan, consent: InitializationConsent): {removed: string[]} {
  if (
    consent.confirmation !== 'INITIALIZE' ||
    !consent.allWritersStopped ||
    !consent.automaticRestartersDisabled ||
    !consent.exclusiveStorageControl
  )
    throw new Error('Initialization requires permanent confirmation and all offline declarations')
  if (JSON.stringify(planInitialization(plan.profile, plan.mode)) !== JSON.stringify(plan))
    throw new Error('Initialization targets changed; review a new plan')
  for (const store of plan.profile.stores)
    assertStorageResetOffline(absolute(store.sessionRoot), absolute(store.journalRoot), consent)
  for (const root of plan.profile.scheduledRoots) {
    if (stat(path.join(absolute(root), 'work.json.lock')) || stat(path.join(absolute(root), 'work.json.lock.recovery')))
      throw new Error('Scheduled work is still owned or recovery is uncertain')
  }

  const removed: string[] = []
  try {
    for (const target of plan.targets) {
      // Recheck every target immediately before removing it, after earlier non-atomic removals.
      if (
        JSON.stringify(inspect(target.path, target.kind === 'settings')) !==
        JSON.stringify({bytes: target.bytes, files: target.files, identity: target.identity})
      )
        throw new Error('Initialization target changed: ' + target.path)
      fs.rmSync(target.path, {force: true, recursive: target.kind !== 'settings'})
      removed.push(target.path)
    }
  } catch {
    throw new Error(
      'Initialization incomplete. Keep writers and restarters stopped; review a new plan for remaining targets. Completed paths: ' +
        removed.join(', '),
    )
  }

  return {removed}
}
