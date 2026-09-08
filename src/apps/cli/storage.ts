// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'

import {recoverSessionWriter, SessionRepository} from '../../core/index.js'

export default class StorageCommand extends Command {
  static args = {
    action: Args.string({options: ['initialize', 'recover'], required: true}),
    session: Args.string({description: 'Exact session ID for recovery'}),
  }
  static description = 'Initialize or recover session storage under external offline exclusion'
  static flags = {
    'exclusive-storage-control': Flags.boolean({
      description: 'Confirm external exclusive administration of both roots',
    }),
    'journal-root': Flags.string({description: 'Matching execution journal root'}),
    'restarters-disabled': Flags.boolean({
      description: 'Confirm automatic restarters remain disabled through interruption',
    }),
    'session-root': Flags.string({description: 'Session repository root'}),
    'writers-stopped': Flags.boolean({description: 'Confirm all current and old writer processes are stopped'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(StorageCommand)
    if (!flags['writers-stopped'] || !flags['restarters-disabled'] || !flags['exclusive-storage-control'])
      this.error(
        'Stop all writers and restarters and establish external exclusive storage control before maintenance. All three confirmations are required.',
      )
    const repository = new SessionRepository({journalRoot: flags['journal-root'], rootDir: flags['session-root']})
    const conditions = {
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    } as const
    if (args.action === 'initialize') {
      if (args.session) this.error('Initialization registers roots; do not specify a session ID')
      repository.initializeStorage(conditions)
    } else {
      if (!args.session) this.error('Recovery requires an exact session ID')
      recoverSessionWriter(repository.scope(args.session), conditions)
    }

    this.log(
      'Storage procedure completed. Review outcomes separately before re-enabling compatible writers; no operation was replayed.',
    )
  }
}
