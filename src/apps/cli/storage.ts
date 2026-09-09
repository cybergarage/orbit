// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'

import type {RegistrationResumeOptions} from '../../core/index.js'

import {
  inspectTranscriptMigration,
  migrateSessionTranscript,
  recoverSessionWriter,
  SessionRepository,
} from '../../core/index.js'

export default class StorageCommand extends Command {
  static args = {
    action: Args.string({
      options: ['initialize', 'inspect', 'recover', 'resume', 'migrate-transcript', 'resume-transcript'],
      required: true,
    }),
    session: Args.string({description: 'Exact session ID for inspection, recovery or transcript migration'}),
  }
  static description = 'Inspect storage or initialize, resume and recover it under external offline exclusion'
  static flags = {
    'exclusive-storage-control': Flags.boolean({
      description: 'Confirm external exclusive administration of both roots',
    }),
    'journal-root': Flags.string({description: 'Matching execution journal root'}),
    'restarters-disabled': Flags.boolean({
      description: 'Confirm automatic restarters remain disabled through interruption',
    }),
    'reviewed-artifacts': Flags.string({
      description: 'JSON file mapping reviewed artifact absolute paths to SHA-256 values; resume only',
    }),
    'session-root': Flags.string({description: 'Session repository root'}),
    'writers-stopped': Flags.boolean({description: 'Confirm all current and old writer processes are stopped'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(StorageCommand)
    const repository = new SessionRepository({journalRoot: flags['journal-root'], rootDir: flags['session-root']})
    if (!['inspect', 'migrate-transcript', 'recover', 'resume-transcript'].includes(args.action) && args.session)
      this.error('Only inspection, recovery or transcript migration takes a session ID')
    if (flags['reviewed-artifacts'] && args.action !== 'resume')
      this.error('Reviewed artifacts are only accepted by resume')
    if (args.action === 'inspect') {
      this.log(
        JSON.stringify(
          args.session ? inspectTranscriptMigration(repository.scope(args.session)) : repository.inspectStorage(),
          null,
          2,
        ),
      )
      return
    }

    if (!flags['writers-stopped'] || !flags['restarters-disabled'] || !flags['exclusive-storage-control'])
      this.error(
        'Stop all writers and restarters and establish external exclusive storage control before maintenance. All three confirmations are required.',
      )
    const conditions = {
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    } as const
    switch (args.action) {
      case 'initialize': {
        if (args.session) this.error('Initialization registers roots; do not specify a session ID')
        repository.initializeStorage(conditions)

        break
      }

      case 'migrate-transcript':
      case 'resume-transcript': {
        if (!args.session) this.error('Transcript migration requires an exact session ID')
        const summary = await repository.findById(args.session)
        if (!summary) this.error('Transcript not found; inspect interrupted migration offline')
        migrateSessionTranscript(
          repository.scope(args.session),
          summary.file,
          conditions,
          args.action === 'resume-transcript',
        )

        break
      }

      case 'resume': {
        const options: RegistrationResumeOptions = {}
        if (flags['reviewed-artifacts']) {
          const reviewed: unknown = JSON.parse(fs.readFileSync(flags['reviewed-artifacts'], 'utf8'))
          if (
            !reviewed ||
            typeof reviewed !== 'object' ||
            Array.isArray(reviewed) ||
            !Object.keys(reviewed).every((file) => path.isAbsolute(file)) ||
            !Object.values(reviewed).every((value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value))
          )
            this.error('Reviewed artifacts must map absolute paths to SHA-256 values')
          options.reviewedArtifacts = reviewed as Record<string, string>
        }

        repository.resumeStorage(conditions, options)

        break
      }

      default: {
        if (!args.session) this.error('Recovery requires an exact session ID')
        recoverSessionWriter(repository.scope(args.session), conditions)
      }
    }

    this.log(
      'Storage procedure completed. Review outcomes separately before re-enabling compatible writers; no operation was replayed.',
    )
  }
}
