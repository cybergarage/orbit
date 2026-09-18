// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command} from '@oclif/core'

import {inventoryFlags, runInventoryCommand} from '../tool-inventory.js'

export default class Tools extends Command {
  static description = 'List registered tool metadata without running a model'
  static examples = ['<%= config.bin %> tools --json', '<%= config.bin %> tools --connect']
  static flags = inventoryFlags

  async run(): Promise<void> {
    const {flags} = await this.parse(Tools)
    const result = await runInventoryCommand('tools', flags)
    this.log(result.output)
    if (flags.connect && !result.complete) this.exit(1)
  }
}
