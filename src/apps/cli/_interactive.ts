// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'
import process from 'node:process'

import {type AgentOptions, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadSystemContexts} from '../../core/context.js'
import {Agent, runInteractiveSession} from '../../core/index.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from './flags.js'

type AgentClass = typeof Agent

export async function runInteractiveCommand(
  options: AgentOptions,
  sessionRunner: typeof runInteractiveSession = runInteractiveSession,
  deps: {
    agentClass?: AgentClass
    contextLoader?: typeof loadSystemContexts
    settingsLoader?: typeof loadWorkspaceSettings
  } = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive mode requires a TTY.')
  }

  const resolvedOptions = await resolveWorkspaceAgentOptions(options, process.cwd(), deps.settingsLoader)
  const contexts = await (deps.contextLoader ?? loadSystemContexts)(process.cwd())
  const contextText = contexts.map((c) => c.content).join('\n\n')
  const systemPrompt = contextText
  const agentClass = deps.agentClass ?? Agent
  await sessionRunner({
    agentClass,
    initialModel: resolvedOptions.model,
    initialProvider: resolvedOptions.provider,
    settings: resolvedOptions.settings,
    systemPrompt,
  })
}

export default class Interactive extends Command {
  static description = 'Internal interactive mode'
  static flags = agentFlags
  static hidden = true

  async run(): Promise<void> {
    const {flags} = await this.parse(Interactive)

    try {
      await runInteractiveCommand(toAgentOptions(flags))
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Interactive mode failed.')
    }
  }
}
