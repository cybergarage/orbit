// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command, Flags} from '@oclif/core'

import type {SessionListOptions} from '../../../core/index.js'

import {SessionRepository} from '../../../core/index.js'

export async function runSessionListCommand(options: SessionListOptions = {}, repository = new SessionRepository()) {
  const page = await repository.listPage(options)
  if (page.errors.length > 0)
    throw new Error(
      `Session listing failed: ${page.errors.map((error) => `${error.file}: ${error.message}`).join('; ')}`,
    )
  return page
}

export default class SessionList extends Command {
  static description = 'List saved sessions including their archive state'
  static examples = ['<%= config.bin %> <%= command.id %> --archive archived']
  static flags = {
    archive: Flags.string({
      description: 'Archive state (omission includes all)',
      options: ['active', 'archived', 'all'],
    }),
    cursor: Flags.string({description: 'Continuation cursor from the previous page'}),
    limit: Flags.integer({description: 'Page size', max: 200, min: 1}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(SessionList)
    try {
      this.log(
        JSON.stringify(
          await runSessionListCommand({...flags, archive: flags.archive as SessionListOptions['archive']}),
          null,
          2,
        ),
      )
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session listing failed.')
    }
  }
}
