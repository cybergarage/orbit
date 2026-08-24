// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import process from 'node:process'
import readline from 'node:readline'

import type {SessionLogStore, SessionSummary} from '../../core/index.js'

import {FileSessionLogStore, SessionDeletionService, SessionRepository} from '../../core/index.js'

export interface DeleteSessionCommandOptions {
  confirm?: (session: SessionSummary) => Promise<boolean>
  force?: boolean
  logStore?: SessionLogStore
  repository?: SessionRepository
}

export interface DeleteSessionCommandResult {
  deleted: boolean
  session: SessionSummary
}

export async function runDeleteSessionCommand(
  sessionId: string,
  options: DeleteSessionCommandOptions = {},
): Promise<DeleteSessionCommandResult> {
  const repository = options.repository ?? new SessionRepository()
  const session = await repository.findById(sessionId)
  if (session === undefined) throw new Error(`Unknown session: ${sessionId}`)

  const confirmed = options.force === true || (await (options.confirm ?? confirmDeletion)(session))
  if (!confirmed) return {deleted: false, session}

  const logs = options.logStore ?? new FileSessionLogStore()
  try {
    const deleted = await new SessionDeletionService(repository, logs).delete(sessionId)
    if (deleted === undefined) throw new Error(`Session no longer exists: ${sessionId}`)
    return {deleted: true, session: deleted}
  } finally {
    if (options.logStore === undefined) await logs.close()
  }
}

export default class Delete extends Command {
  static args = {
    session: Args.string({
      description: 'ID of the saved session to delete',
      required: true,
    }),
  }
  static description = 'Permanently delete a saved session'
  static examples = [
    '<%= config.bin %> <%= command.id %> <SESSION_ID>',
    '<%= config.bin %> <%= command.id %> <SESSION_ID> --force',
  ]
  static flags = {
    force: Flags.boolean({
      default: false,
      description: 'Delete without asking for confirmation',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Delete)
    try {
      const result = await runDeleteSessionCommand(args.session, {force: flags.force})
      this.log(result.deleted ? `Deleted session ${result.session.id}.` : 'Deletion cancelled.')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session deletion failed.')
    }
  }
}

async function confirmDeletion(session: SessionSummary): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Session deletion requires confirmation. Re-run with --force in non-interactive mode.')
  }

  const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
  try {
    const answer = await new Promise<string>((resolve) => {
      terminal.question(`Permanently delete session ${session.id}? [y/N] `, resolve)
    })
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  } finally {
    terminal.close()
  }
}
