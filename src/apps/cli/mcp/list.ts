// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'

import {inventoryFlags, runInventoryCommand} from '../../tool-inventory.js'

export default class McpList extends Command {
  static description = 'List configured MCP servers and optionally discover their tools'
  static examples = ['<%= config.bin %> mcp list --json', '<%= config.bin %> mcp list --connect']
  static flags = inventoryFlags

  async run(): Promise<void> {
    const {flags} = await this.parse(McpList)
    const result = await runInventoryCommand('mcp', flags)
    this.log(result.output)
    if (flags.connect && !result.complete) this.exit(1)
  }
}
