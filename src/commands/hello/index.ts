// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'

import {Agent} from '../../lib/agent.js'

export default class Hello extends Command {
  static description = 'Say hello'
  static examples = [
    `<%= config.bin %> <%= command.id %>
`,
  ]

  async run(): Promise<void> {
    const agent = new Agent();
    const response = await agent.chat("hello");
    this.log(response);
  }
}
