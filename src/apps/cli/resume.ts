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
import {Agent, createLogger, runInteractiveSession, SessionRepository} from '../../core/index.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from '../cli-flags.js'

type AgentClass = typeof Agent

const resumableOriginators = ['orbit-interactive', 'orbit-thread-manager']

export interface ResumeSessionCommandOptions extends AgentOptions {
  all?: boolean
  cwd?: string
  last?: boolean
}

export interface ResumeSessionCommandDependencies {
  agentClass?: AgentClass
  contextLoader?: typeof loadSystemContexts
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
  validateSelection(sessionId, options)
  requireTty(deps)
  const repository = deps.repository ?? new SessionRepository()
  const launchCwd = path.resolve(options.cwd ?? process.cwd())
  const summary = await selectSession(repository, sessionId, options, launchCwd)
  await requireDirectory(summary.cwd)
  const session = openSession(repository, summary)

  try {
    const metadata = session.getMetadata()
    const resolvedOptions = await resolveWorkspaceAgentOptions(
      resumedAgentOptions(options, session),
      metadata.cwd,
      deps.settingsLoader,
    )
    const systemPrompt = metadata.systemPrompt ?? (await loadContextText(metadata.cwd, deps.contextLoader))
    const logger = createLogger({destination: process.stderr, level: resolvedOptions.debug ? 'debug' : 'info'})
    await (deps.sessionRunner ?? runInteractiveSession)({
      agentClass: deps.agentClass ?? Agent,
      cwd: metadata.cwd,
      initialModel: resolvedOptions.model,
      initialProvider: resolvedOptions.provider,
      logger,
      session,
      settings: resolvedOptions.settings,
      systemPrompt,
    })
    return summary
  } finally {
    await session.close()
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

async function selectSession(
  repository: SessionRepository,
  sessionId: string | undefined,
  options: ResumeSessionCommandOptions,
  launchCwd: string,
): Promise<SessionSummary> {
  const summary =
    sessionId === undefined
      ? await repository.findLatest({
          ...(options.all === true ? {} : {cwd: launchCwd}),
          originators: resumableOriginators,
        })
      : await repository.findById(sessionId)
  if (summary !== undefined) return summary
  if (sessionId !== undefined) throw new Error(`Unknown session: ${sessionId}`)
  if (options.all === true) throw new Error('No saved interactive sessions found.')
  throw new Error(`No saved interactive sessions found for ${launchCwd}.`)
}

function validateSelection(sessionId: string | undefined, options: ResumeSessionCommandOptions): void {
  if (sessionId !== undefined && options.last === true) {
    throw new Error('Pass either a session ID or --last, not both.')
  }

  if (sessionId === undefined && options.last !== true) {
    throw new Error('Pass a session ID or --last. Interactive session selection is not available yet.')
  }

  if (options.all === true && options.last !== true) {
    throw new Error('--all requires --last.')
  }
}
