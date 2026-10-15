// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {SessionRepository} from '../../../core/index.js'

export async function runSessionRenameCommand(
  id: string,
  title: null | string,
  options: {expectedRevision?: number; operationId?: string} = {},
  repository = new SessionRepository(),
) {
  const summary = await repository.findById(id)
  if (!summary) throw new Error('Session not found')
  return repository.rename(id, {
    expectedRevision: options.expectedRevision ?? summary.titleRevision ?? 0,
    operationId: options.operationId ?? randomUUID(),
    title,
  })
}

export default class SessionRename extends Command {
  static readonly args = {
    session: Args.string({description: 'Exact saved session ID', required: true}),
    title: Args.string({description: 'New display name; quote spaces'}),
  }
  static readonly description = 'Rename a saved session without changing its conversation history'
  static readonly examples = ['<%= config.bin %> <%= command.id %> <SESSION_ID> "Design review"']
  static readonly flags = {
    clear: Flags.boolean({description: 'Clear the title and display the original preview'}),
    'expected-revision': Flags.integer({description: 'Expected title revision', min: 0}),
    'operation-id': Flags.string({description: 'Stable operation UUID for an exact retry'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(SessionRename)
    try {
      if (flags.clear ? args.title !== undefined : args.title === undefined)
        throw new Error('Pass a new title or --clear.')
      this.log(
        JSON.stringify(
          await runSessionRenameCommand(args.session, flags.clear ? null : args.title!, {
            expectedRevision: flags['expected-revision'],
            operationId: flags['operation-id'],
          }),
          null,
          2,
        ),
      )
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session rename failed.')
    }
  }
}
