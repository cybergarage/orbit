// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {Agent} from '../lib/agent.js'
import {loadContext} from '../lib/context.js'

const LANG_INSTRUCTIONS: Record<string, string> = {
  en: 'Respond in English.',
  ja: 'Respond in Japanese.',
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
    `<%= config.bin %> <%= command.id %> "Write a haiku about TypeScript"
`,
    `echo "Write a haiku about TypeScript" | <%= config.bin %> <%= command.id %>
`,
    `<%= config.bin %> <%= command.id %> --lang ja "TypeScriptとは何ですか？"
`,
    `<%= config.bin %> <%= command.id %> --lang en "TypeScriptとは何ですか？"
`,
  ]
  static flags = {
    lang: Flags.string({
      description: 'Output language',
      options: ['en', 'ja'],
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Exec)

    let {prompt} = args
    if (!prompt) {
      if (process.stdin.isTTY) {
        this.error('No prompt provided. Pass a prompt as an argument or via stdin.')
      }

      prompt = readFileSync(process.stdin.fd, 'utf8').trim()
    }

    const {text: contextText} = await loadContext(process.cwd())
    const langInstruction = flags.lang ? LANG_INSTRUCTIONS[flags.lang] : null

    let systemPrompt = contextText || ''
    if (langInstruction) {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${langInstruction}` : langInstruction
    }

    const agent = new Agent(systemPrompt || undefined)
    const response = await agent.chat(prompt)
    this.log(response)
  }
}
