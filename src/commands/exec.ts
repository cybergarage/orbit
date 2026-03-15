// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'

import {Agent} from '../lib/agent.js'

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
    const agent = new Agent()
    const response = await agent.chat(args.prompt)
    this.log(response)
  }
}
