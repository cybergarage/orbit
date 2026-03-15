// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {Agent} from '../lib/agent.js'
import {loadContext} from '../lib/context.js'

export default class Exec extends Command {
  static args = {
    prompt: Args.string({
      description: 'Prompt to send to the agent',
      required: false,
    }),
  }
  static description = 'Send a prompt to the agent and print the response'
  static examples = [
    `<%= config.bin %> <%= command.id %> "Write a haiku about TypeScript"
`,
    `echo "Write a haiku about TypeScript" | <%= config.bin %> <%= command.id %>
`,
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(Exec)

    let {prompt} = args
    if (!prompt) {
      if (process.stdin.isTTY) {
        this.error('No prompt provided. Pass a prompt as an argument or via stdin.')
      }

      prompt = readFileSync(process.stdin.fd, 'utf8').trim()
    }

    const {text: systemPrompt} = await loadContext(process.cwd())
    const agent = new Agent(systemPrompt || undefined)
    const response = await agent.chat(prompt)
    this.log(response)
  }
}
