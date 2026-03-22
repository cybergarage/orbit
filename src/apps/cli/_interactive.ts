// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'
import process from 'node:process'

import {type AgentOptions, buildSystemPrompt, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadContext} from '../../core/context.js'
import {Agent, runInteractiveSession} from '../../core/index.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from './flags.js'

type AgentClass = typeof Agent

export async function runInteractiveCommand(
  options: AgentOptions,
  sessionRunner: typeof runInteractiveSession = runInteractiveSession,
  deps: {
    agentClass?: AgentClass
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
  const agentClass = deps.agentClass ?? Agent
  await sessionRunner({
    agentClass,
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
