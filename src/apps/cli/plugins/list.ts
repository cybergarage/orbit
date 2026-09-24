// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {Command, Flags} from '@oclif/core'

import {pluginFlags, productPluginCatalog} from '../../plugins.js'

export default class PluginList extends Command {
  static description = 'Inspect explicitly selected local plugins without starting servers'
  static flags = {...pluginFlags, json: Flags.boolean({description: 'Print plugin metadata and diagnostics as JSON'})}

  async run(): Promise<void> {
    const {flags} = await this.parse(PluginList)
    const inspection = await productPluginCatalog(process.cwd(), flags.plugin, flags['plugin-data-dir']).inspect()
    // Configuration environment values are package data, but never print them.
    const result = {complete: inspection.complete, diagnostics: inspection.diagnostics, plugins: inspection.plugins}
    this.log(
      flags.json
        ? JSON.stringify(result)
        : [
            ...result.plugins.map((p) => `${p.id} ${JSON.stringify(p.manifest.name)} ${JSON.stringify(p.root)}`),
            ...result.diagnostics.map((d) => JSON.stringify(d)),
          ].join('\n'),
    )
  }
}
