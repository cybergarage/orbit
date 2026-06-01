// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {type AgentOptions, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadSystemContexts} from '../../core/context.js'
import {Agent, createLogger, Message, MessageType, Role} from '../../core/index.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {agentFlags, toAgentOptions} from './flags.js'

type AgentClass = new (options?: ConstructorParameters<typeof Agent>[0]) => Agent

export async function runExecCommand(
  options: AgentOptions & {prompt?: string},
  stdin = process.stdin,
  cwd = process.cwd(),
  deps: {
    agentClass?: AgentClass
    contextLoader?: typeof loadSystemContexts
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
  const systemContexts = await (deps.contextLoader ?? loadSystemContexts)(cwd)
  const systemPrompts = systemContexts.filter((context) => context.content).map((context) => context.content)
  const systemMessages: Message[] = systemPrompts.map(
    (systemPrompt) => new Message(MessageType.Session, {content: systemPrompt, role: Role.System}),
  )

  const AgentClass = deps.agentClass ?? Agent
  const logger = createLogger({destination: process.stderr, level: resolvedOptions.debug ? 'debug' : 'info'})
  const agent = new AgentClass({
    cwd,
    logger,
    messages: systemMessages,
    model: {
      name: resolvedOptions.model,
      provider: resolvedOptions.provider,
    },
    settings: resolvedOptions.settings,
  })
  const userMessages: Message[] = [new Message(MessageType.User, {content: prompt, role: Role.User})]
  try {
    const response = await agent.invoke(userMessages)
    return response.content
  } finally {
    await agent.close()
  }
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
