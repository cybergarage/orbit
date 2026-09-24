// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import process from 'node:process'
import readline from 'node:readline'

import {SessionRepository} from '../core/session/index.js'

export async function confirmStorageInitialization(message: string): Promise<boolean> {
  const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
  return new Promise((resolve) => {
    const finish = (accepted: boolean) => {
      resolve(accepted)
      terminal.close()
    }

    terminal.once('close', () => resolve(false))
    terminal.once('SIGINT', () => finish(false))
    terminal.question(message, (answer) => finish(/^(?:y|yes)$/iu.test(answer.trim())))
  })
}

/** Startup convenience for explicit offline initialization; never resumes damaged storage. */
export async function ensureStartupStorage(
  repository: SessionRepository = new SessionRepository(),
  options: {
    confirm?: (message: string) => Promise<boolean>
    interactive?: boolean
  } = {},
): Promise<void> {
  const inspection = repository.inspectStorage()
  if (inspection.state === 'ready') return
  const roots = `Session root: ${inspection.sessionRoot}\nJournal root: ${inspection.journalRoot}`
  const instructions =
    'Run orbit storage inspect with these roots. For offline initialization, use orbit storage initialize ' +
    '--writers-stopped --restarters-disabled --exclusive-storage-control; ' +
    'use orbit storage resume for incomplete registration after reviewing the evidence. ' +
    'Pass --session-root and --journal-root when using custom roots.'
  if (inspection.state !== 'unregistered' || !(options.interactive ?? process.stdin.isTTY))
    throw new Error(`Session storage is ${inspection.state}.\n${roots}\n${instructions}`)
  const accepted = await (options.confirm ?? confirmStorageInitialization)(
    `Session storage is not initialized.\n${roots}\n` +
      'Before creating storage, stop all other Orbit writers (including older versions), disable automatic ' +
      'restarters, and establish exclusive administrative control of both roots. Keep that control if initialization fails.\n' +
      'Confirm these conditions and create session storage? (y/N) ',
  )
  if (!accepted) throw new Error(`Storage initialization cancelled.\n${instructions}`)
  // The answer explicitly acknowledges each prerequisite of the existing offline API.
  repository.initializeStorage({
    allWritersStopped: true,
    automaticRestartersDisabled: true,
    exclusiveStorageControl: true,
  })
  if (repository.inspectStorage().state !== 'ready') throw new Error('Storage initialization did not complete')
}
