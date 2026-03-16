// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'
import process from 'node:process'

import {createAgent, type Provider} from '../lib/agent.js'
import {agentFlags, type AgentOptions, buildSystemPrompt} from '../lib/chat.js'
import {loadContext} from '../lib/context.js'
import {runInteractiveSession} from '../lib/interactive.js'

export async function runInteractiveCommand(
  options: AgentOptions,
  sessionRunner: typeof runInteractiveSession = runInteractiveSession,
  deps: {
    agentFactory?: typeof createAgent
    contextLoader?: typeof loadContext
  } = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive mode requires a TTY.')
  }

  const {text: contextText} = await (deps.contextLoader ?? loadContext)(process.cwd())
  const systemPrompt = buildSystemPrompt(contextText, options.lang)
  const agent = (deps.agentFactory ?? createAgent)(options.provider as Provider, options.model, systemPrompt)
  await sessionRunner({agent})
}

export default class Interactive extends Command {
  static description = 'Internal interactive mode'
  static flags = agentFlags
  static hidden = true

  async run(): Promise<void> {
    const {flags} = await this.parse(Interactive)

    try {
      await runInteractiveCommand(flags as AgentOptions)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Interactive mode failed.')
    }
  }
}
