// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import path from 'node:path'
import process from 'node:process'

import type {SessionRepository as SessionRepositoryType, SessionSummary} from '../../core/index.js'

import {formatSessionInformation, SessionRepository} from '../../core/index.js'
import {selectSessionSummary} from '../session-selection.js'

export interface SessionInformationCommandOptions {
  all?: boolean
  cwd?: string
  idOnly?: boolean
  json?: boolean
  last?: boolean
}

export interface SessionInformationCommandDependencies {
  repository?: SessionRepositoryType
  write?: (value: string) => void
}

export async function runSessionInformationCommand(
  sessionId: string | undefined,
  options: SessionInformationCommandOptions = {},
  deps: SessionInformationCommandDependencies = {},
): Promise<SessionSummary> {
  if (options.idOnly === true && options.json === true) {
    throw new Error('Pass either --id-only or --json, not both.')
  }

  const repository = deps.repository ?? new SessionRepository()
  const launchCwd = path.resolve(options.cwd ?? process.cwd())
  const summary = await selectSessionSummary(repository, sessionId, options, launchCwd)
  const output = options.idOnly
    ? summary.id
    : options.json
      ? JSON.stringify(summary, null, 2)
      : formatSessionInformation(summary)
  const write = deps.write ?? ((value: string) => process.stdout.write(value))
  write(`${output}\n`)
  return summary
}

export default class SessionInformationCommand extends Command {
  static args = {
    session: Args.string({
      description: 'Exact ID of the saved session to inspect',
      required: false,
    }),
  }
  static description = 'Show saved session information'
  static examples = [
    '<%= config.bin %> <%= command.id %> <SESSION_ID>',
    '<%= config.bin %> <%= command.id %> --last',
    '<%= config.bin %> <%= command.id %> --last --all --id-only',
    '<%= config.bin %> <%= command.id %> <SESSION_ID> --json',
  ]
  static flags = {
    all: Flags.boolean({
      default: false,
      description: 'Search all working directories (requires --last)',
    }),
    'id-only': Flags.boolean({
      default: false,
      description: 'Print only the full session ID',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Print the session summary as JSON',
    }),
    last: Flags.boolean({
      default: false,
      description: 'Inspect the most recently updated eligible session',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(SessionInformationCommand)
    try {
      await runSessionInformationCommand(args.session, {
        all: flags.all,
        idOnly: flags['id-only'],
        json: flags.json,
        last: flags.last,
      })
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session inspection failed.')
    }
  }
}
