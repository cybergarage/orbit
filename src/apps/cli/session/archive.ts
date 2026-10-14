// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'

import {SessionRepository} from '../../../core/index.js'
import {runSessionListCommand} from './list.js'

export async function runSessionArchiveCommand(id: string, repository = new SessionRepository()) {
  await runSessionListCommand({}, repository)
  return repository.setArchived(id, true)
}

export default class SessionArchive extends Command {
  static args = {session: Args.string({description: 'Exact saved session ID', required: true})}
  static description = 'Archive a saved session while preserving its identity and history'
  static examples = ['<%= config.bin %> <%= command.id %> <SESSION_ID>']

  async run(): Promise<void> {
    const {args} = await this.parse(SessionArchive)
    try {
      const session = await runSessionArchiveCommand(args.session)
      this.log(`Archived session ${session.id}.`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session archive failed.')
    }
  }
}
