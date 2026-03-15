// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'
import process from 'node:process'

import {Agent} from '../lib/agent.js'
import {loadContext} from '../lib/context.js'

export default class Exec extends Command {
  static args = {
    prompt: Args.string({
      description: 'Prompt to send to the agent',
      required: true,
    }),
  }
  static description = 'Send a prompt to the agent and print the response'
  static examples = [
    `<%= config.bin %> <%= command.id %> "Write a haiku about TypeScript"
`,
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(Exec)
    const {text: systemPrompt} = await loadContext(process.cwd())
    const agent = new Agent(systemPrompt || undefined)
    const response = await agent.chat(args.prompt)
    this.log(response)
  }
}
