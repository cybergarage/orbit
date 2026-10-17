// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

import {
  executeInitialization,
  type InitializationMode,
  planInitialization,
} from '../../core/maintenance/initialization.js'
import {orbitInitializationProfile} from '../initialization.js'

export default class Initialize extends Command {
  static args = {mode: Args.string({options: ['settings', 'data', 'all'], required: true})}
  static description = 'Permanently initialize selected Orbit settings, saved data, or both; preserve user work'
  static flags = {
    'confirm-initialize': Flags.boolean({description: 'Confirm permanent deletion without prompting'}),
    'dry-run': Flags.boolean({description: 'Display paths, file counts and retained scope without changes'}),
    'exclusive-storage-control': Flags.boolean({
      description: 'Declare external exclusive control, including shared settings',
    }),
    'restarters-disabled': Flags.boolean({description: 'Declare automatic restarters disabled'}),
    'settings-file': Flags.string({
      description: 'Explicit settings.json to reset; may contain credentials or affect other projects',
      multiple: true,
    }),
    'writers-stopped': Flags.boolean({description: 'Declare all CLI, GUI, library and older writers stopped'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Initialize)
    if (args.mode === 'data' && flags['settings-file']?.length) this.error('data mode does not accept settings files')
    const plan = planInitialization(
      orbitInitializationProfile((flags['settings-file'] ?? []).map((file) => path.resolve(file))),
      args.mode as InitializationMode,
    )
    this.log(JSON.stringify(plan, null, 2))
    if (flags['dry-run']) return
    if (!flags['writers-stopped'] || !flags['restarters-disabled'] || !flags['exclusive-storage-control'])
      this.error('All three offline declarations are required; other idle processes cannot be proven stopped')
    if (!flags['confirm-initialize']) {
      if (!process.stdin.isTTY) this.error('Use an interactive terminal or --confirm-initialize')
      const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
      try {
        const answer = await new Promise<string>((resolve) => {
          terminal.question(
            'Permanently remove the displayed targets (not Trash)? Shared settings may contain credentials. Type INITIALIZE: ',
            resolve,
          )
        })
        if (answer !== 'INITIALIZE') this.error('Initialization cancelled')
      } finally {
        terminal.close()
      }
    }

    executeInitialization(plan, {
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      confirmation: 'INITIALIZE',
      exclusiveStorageControl: true,
    })
    this.log(
      'Initialization completed. Restart Orbit; missing storage remains unregistered. No user workspace was removed.',
    )
  }
}
