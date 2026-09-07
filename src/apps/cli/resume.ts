// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type {AgentOptions} from '../../core/chat.js'
import type {Session, SessionSummary} from '../../core/index.js'

import {resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadSystemContexts} from '../../core/context.js'
import {Agent, runInteractiveSession, SessionRepository} from '../../core/index.js'
import {selectOllamaModel} from '../../core/models/adapters/ollama.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from '../cli-flags.js'
import {selectSessionSummary} from '../session-selection.js'

type AgentClass = typeof Agent

export interface ResumeSessionCommandOptions extends AgentOptions {
  all?: boolean
  cwd?: string
  last?: boolean
}

export interface ResumeSessionCommandDependencies {
  agentClass?: AgentClass
  contextLoader?: typeof loadSystemContexts
  ollamaModelSelector?: typeof selectOllamaModel
  repository?: SessionRepository
  sessionRunner?: typeof runInteractiveSession
  settingsLoader?: typeof loadWorkspaceSettings
  stdinIsTTY?: boolean
  stdoutIsTTY?: boolean
}

export async function runResumeSessionCommand(
  sessionId: string | undefined,
  options: ResumeSessionCommandOptions = {},
  deps: ResumeSessionCommandDependencies = {},
): Promise<SessionSummary> {
  requireTty(deps)
  const repository = deps.repository ?? new SessionRepository()
  const launchCwd = path.resolve(options.cwd ?? process.cwd())
  const summary = await selectSessionSummary(repository, sessionId, options, launchCwd)
  await requireDirectory(summary.cwd)
  const session = openSession(repository, summary)

  try {
    const metadata = session.getMetadata()
    const resolvedOptions = await resolveWorkspaceAgentOptions(
      resumedAgentOptions(options, session),
      metadata.cwd,
      deps.settingsLoader,
      deps.ollamaModelSelector,
    )
    const systemPrompt = metadata.systemPrompt ?? (await loadContextText(metadata.cwd, deps.contextLoader))
    await (deps.sessionRunner ?? runInteractiveSession)({
      agentClass: deps.agentClass ?? Agent,
      cwd: metadata.cwd,
      debug: resolvedOptions.debug,
      executionPolicy: resolvedOptions.executionPolicy,
      initialModel: resolvedOptions.model,
      initialProvider: resolvedOptions.provider,
      journalLevel: resolvedOptions.journalLevel,
      session,
      settings: resolvedOptions.settings,
      systemPrompt,
    })
    return summary
  } finally {
    if (session.hasManagedLease()) session.close().catch(() => {})
    else await session.close()
    // A pending managed owner retains the writer until its own late cleanup finishes.
  }
}

export default class Resume extends Command {
  static args = {
    session: Args.string({
      description: 'Exact ID of the saved session to resume',
      required: false,
    }),
  }
  static description = 'Resume a saved interactive session'
  static examples = [
    '<%= config.bin %> <%= command.id %> --last',
    '<%= config.bin %> <%= command.id %> <SESSION_ID>',
    '<%= config.bin %> <%= command.id %> --last --all',
  ]
  static flags = {
    ...agentFlags,
    all: Flags.boolean({
      default: false,
      description: 'Search all working directories (requires --last)',
    }),
    last: Flags.boolean({
      default: false,
      description: 'Resume the most recently updated eligible session',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Resume)
    try {
      await runResumeSessionCommand(args.session, {
        ...toAgentOptions(flags),
        all: flags.all,
        last: flags.last,
      })
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Session resume failed.')
    }
  }
}

async function loadContextText(cwd: string, loader: typeof loadSystemContexts = loadSystemContexts): Promise<string> {
  const contexts = await loader(cwd)
  return contexts.map((context) => context.content).join('\n\n')
}

function openSession(repository: SessionRepository, summary: SessionSummary): Session {
  try {
    return repository.open(summary.file)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Session file is already open for writing:')) {
      throw new Error(`Session is already open in another Orbit process: ${summary.id}`)
    }

    throw error
  }
}

function requireTty(deps: ResumeSessionCommandDependencies): void {
  if ((deps.stdinIsTTY ?? process.stdin.isTTY) !== true || (deps.stdoutIsTTY ?? process.stdout.isTTY) !== true) {
    throw new Error('Session resume requires a TTY.')
  }
}

function resumedAgentOptions(options: ResumeSessionCommandOptions, session: Session): AgentOptions {
  const metadata = session.getMetadata()
  return {
    ...(options.debug === undefined ? {} : {debug: options.debug}),
    ...(options.lang === undefined ? {} : {lang: options.lang}),
    model: options.model ?? metadata.model,
    provider: options.provider ?? metadata.provider,
    ...(options.settings === undefined ? {} : {settings: options.settings}),
  }
}

async function requireDirectory(cwd: string): Promise<void> {
  try {
    const stat = await fs.stat(cwd)
    if (stat.isDirectory()) return
  } catch {}

  throw new Error(`Saved session working directory does not exist: ${cwd}`)
}
