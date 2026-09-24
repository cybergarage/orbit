// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

import {logsDir, sessionsDir} from '../core/app.js'
import {planStorageReset, resetStorage} from '../core/session/storage-reset.js'

export interface StorageResetOptions {
  confirmReset?: boolean
  dryRun?: boolean
  exclusiveStorageControl?: boolean
  initialize?: boolean
  journalRoot?: string
  logRoot?: string
  projectFile?: string
  restartersDisabled?: boolean
  sessionRoot?: string
  writersStopped?: boolean
}

export function confirmStorageReset(message: string): Promise<boolean> {
  const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
  return new Promise((resolve) => {
    const finish = (accepted: boolean) => {
      resolve(accepted)
      terminal.close()
    }

    terminal.once('close', () => resolve(false))
    terminal.once('SIGINT', () => finish(false))
    terminal.question(message, (answer) => finish(answer === 'RESET'))
  })
}

export async function runStorageReset(
  options: StorageResetOptions,
  deps: {confirm?: typeof confirmStorageReset; interactive?: boolean; log?: (message: string) => void} = {},
): Promise<void> {
  const custom = [options.sessionRoot, options.journalRoot, options.logRoot, options.projectFile]
  if (custom.some((value) => value !== undefined) && !custom.every((value) => value !== undefined))
    throw new Error('Custom reset requires --session-root, --journal-root, --log-root and --project-file together')
  const sessionRoot = options.sessionRoot ?? sessionsDir()
  const plan = planStorageReset({
    journalRoot: options.journalRoot ?? path.join(path.dirname(sessionRoot), 'runs'),
    logRoot: options.logRoot ?? logsDir(),
    projectFile: options.projectFile ?? path.join(path.dirname(sessionRoot), 'projects.sqlite'),
    sessionRoot,
  })
  const log = deps.log ?? ((message: string) => process.stdout.write(message + '\n'))
  log(
    [
      options.dryRun ? 'Storage reset preview (no changes):' : 'Storage reset will permanently delete:',
      ...plan.targets.map((target) => `${target.path}${target.identity === null ? ' (absent)' : ''}`),
      'This includes histories, logs, Project memory and recovery evidence inside these targets.',
      options.initialize
        ? 'After deletion: initialize a new session/journal pair.'
        : 'After deletion: leave storage unregistered.',
    ].join('\n'),
  )
  if (options.dryRun) return
  if (options.confirmReset) {
    if (!options.writersStopped || !options.restartersDisabled || !options.exclusiveStorageControl)
      throw new Error('--confirm-reset requires --writers-stopped --restarters-disabled --exclusive-storage-control')
  } else {
    if (!(deps.interactive ?? process.stdin.isTTY))
      throw new Error(
        'Storage reset requires a terminal confirmation or --confirm-reset with all three offline declarations',
      )
    const accepted = await (deps.confirm ?? confirmStorageReset)(
      'Stop all other Orbit CLI, GUI, library and older writer processes; disable automatic restarters; ' +
        'establish exclusive administrative control of every displayed target. Keep that control if reset fails.\n' +
        'Confirm these conditions and permanently clear the displayed storage by typing RESET: ',
    )
    if (!accepted) throw new Error('Storage reset cancelled; no storage was cleared')
  }

  resetStorage(
    plan,
    {
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    },
    options.initialize,
  )
  log(
    options.initialize
      ? 'Storage cleared and initialized.'
      : 'Storage cleared and unregistered. The next interactive startup will offer initialization.',
  )
}
