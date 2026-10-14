// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'

import {SessionRepository} from '../../../core/index.js'

export async function runSessionUnarchiveCommand(id: string, repository = new SessionRepository()) {
  repository.isArchived(id)
  return repository.setArchived(id, false)
}

export default class SessionUnarchive extends Command {
  static args = {session: Args.string({description: 'Exact saved session ID', required: true})}
  static description = 'Unarchive a saved session while preserving its identity and history'
  static examples = ['<%= config.bin %> <%= command.id %> <SESSION_ID>']

  async run(): Promise<void> {
    const {args} = await this.parse(SessionUnarchive)
    try {
      const session = await runSessionUnarchiveCommand(args.session)
      this.log(`Unarchived session ${session.id}.`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session unarchive failed.')
    }
  }
}
