// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {Command, Flags} from '@oclif/core'

import {pluginFlags, productExtensions} from '../plugins.js'
export default class Skills extends Command {
  static description = 'List bounded Skill metadata and source digests without running a model'
  static flags = {
    ...pluginFlags,
    json: Flags.boolean({description: 'Print JSON metadata'}),
    'skill-root': Flags.string({
      description: 'Explicit root ID=DIRECTORY; replaces the workspace default',
      multiple: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Skills)
    const {skillCatalog: catalog} = await productExtensions(process.cwd(), {
      pluginDataDir: flags['plugin-data-dir'],
      plugins: flags.plugin,
      skillRoots: flags['skill-root'],
    })
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.on('SIGINT', stop)
    try {
      const result = catalog
        ? await catalog.list(controller.signal)
        : {candidates: [], complete: true, issues: ['No marked workspace or explicit roots']}
      this.log(
        flags.json
          ? JSON.stringify(result)
          : [
              ...result.candidates.map(
                (c) =>
                  `${c.id}@${c.digest} ${JSON.stringify(c.name)} ${JSON.stringify(c.file)} ${JSON.stringify(c.description)}${c.license === undefined ? '' : ` license=${JSON.stringify(c.license)}`}${c.compatibility === undefined ? '' : ` compatibility=${JSON.stringify(c.compatibility)}`}`,
              ),
              ...result.issues.map((issue) => JSON.stringify(issue)),
            ].join('\n'),
      )
    } finally {
      try {
        await catalog?.settle()
      } finally {
        process.removeListener('SIGINT', stop)
      }
    }
  }
}
