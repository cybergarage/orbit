// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'
import process from 'node:process'

import {createAgent, type Provider} from '../../core/agent.js'
import {type AgentOptions, buildSystemPrompt, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadContext} from '../../core/context.js'
import {runInteractiveSession} from '../../core/interactive.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from './flags.js'

export async function runInteractiveCommand(
  options: AgentOptions,
  sessionRunner: typeof runInteractiveSession = runInteractiveSession,
  deps: {
    agentFactory?: typeof createAgent
    contextLoader?: typeof loadContext
    settingsLoader?: typeof loadWorkspaceSettings
  } = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive mode requires a TTY.')
  }

  const resolvedOptions = await resolveWorkspaceAgentOptions(options, process.cwd(), deps.settingsLoader)
  const {text: contextText} = await (deps.contextLoader ?? loadContext)(process.cwd())
  const systemPrompt = buildSystemPrompt(contextText, resolvedOptions.lang)
  const agentFactory = deps.agentFactory ?? createAgent
  await sessionRunner({
    createAgent: (provider: Provider, model: string, prompt?: string) => agentFactory(provider, model, prompt),
    initialModel: resolvedOptions.model,
    initialProvider: resolvedOptions.provider,
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
