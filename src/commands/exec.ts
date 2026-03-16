// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {type ChatMessage, createAgent, type Provider} from '../lib/agent.js'
import {agentFlags, type AgentOptions, buildSystemPrompt} from '../lib/chat.js'
import {loadContext} from '../lib/context.js'

export async function runExecCommand(
  options: AgentOptions & {prompt?: string},
  stdin = process.stdin,
  cwd = process.cwd(),
  deps: {
    agentFactory?: typeof createAgent
    contextLoader?: typeof loadContext
  } = {},
): Promise<string> {
  let {prompt} = options
  if (!prompt) {
    if (stdin.isTTY) {
      throw new Error('No prompt provided. Pass a prompt as an argument or via stdin.')
    }

    prompt = readFileSync(stdin.fd, 'utf8').trim()
  }

  const {text: contextText} = await (deps.contextLoader ?? loadContext)(cwd)
  const systemPrompt = buildSystemPrompt(contextText, options.lang)
  const agent = (deps.agentFactory ?? createAgent)(options.provider as Provider, options.model, systemPrompt)
  const messages: ChatMessage[] = [{content: prompt, role: 'user'}]
  return agent.chat(messages)
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
      const response = await runExecCommand({...flags, prompt: args.prompt} as AgentOptions & {prompt?: string})
      this.log(response)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Exec command failed.')
    }
  }
}
