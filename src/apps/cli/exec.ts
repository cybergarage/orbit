// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {type AgentOptions, buildSystemPrompt, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadContext} from '../../core/context.js'
import {Agent, type Prompt} from '../../core/index.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from './flags.js'

type AgentClass = new (options?: ConstructorParameters<typeof Agent>[0]) => Agent

export async function runExecCommand(
  options: AgentOptions & {prompt?: string},
  stdin = process.stdin,
  cwd = process.cwd(),
  deps: {
    agentClass?: AgentClass
    contextLoader?: typeof loadContext
    settingsLoader?: typeof loadWorkspaceSettings
  } = {},
): Promise<string> {
  let {prompt} = options
  if (!prompt) {
    if (stdin.isTTY) {
      throw new Error('No prompt provided. Pass a prompt as an argument or via stdin.')
    }

    prompt = readFileSync(stdin.fd, 'utf8').trim()
  }

  const resolvedOptions = await resolveWorkspaceAgentOptions(options, cwd, deps.settingsLoader)
  const {text: contextText} = await (deps.contextLoader ?? loadContext)(cwd)
  const systemPrompt = buildSystemPrompt(contextText, resolvedOptions.lang)
  const AgentClass = deps.agentClass ?? Agent
  const agent = new AgentClass({
    model: {
      name: resolvedOptions.model,
      provider: resolvedOptions.provider,
    },
  })
  const messages: Prompt[] = [
    ...(systemPrompt ? [{content: systemPrompt, role: 'system'} as Prompt] : []),
    {content: prompt, role: 'user'},
  ]
  const response = await agent.prompt(messages)
  return response.content
}

export default class Exec extends Command {
  static args = {
    prompt: Args.string({
      description: 'Prompt to send to the agent',
      required: false,
    }),
  }
  static description = 'Send a prompt to the agent and print the response'
  static examples = [
    `<%= config.bin %> <%= command.id %> "Write a haiku about TypeScript"`,
    `echo "Write a haiku about TypeScript" | <%= config.bin %> <%= command.id %>`,
  ]
  static flags = {
    ...agentFlags,
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Exec)
    try {
      const response = await runExecCommand({...toAgentOptions(flags), prompt: args.prompt})
      this.log(response)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Exec command failed.')
    }
  }
}
