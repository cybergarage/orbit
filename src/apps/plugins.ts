// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {Flags} from '@oclif/core'
import os from 'node:os'
import path from 'node:path'

import {PluginCatalog} from '../core/plugins/index.js'
import {productSkillCatalog} from './skill-catalog.js'

export const pluginFlags = {
  plugin: Flags.string({description: 'Enable local plugin ID=DIRECTORY (repeatable)', multiple: true}),
  'plugin-data-dir': Flags.string({description: 'Persistent plugin instance data root'}),
}
export function productPluginCatalog(cwd: string, entries: string[] = [], dataRoot?: string): PluginCatalog {
  return new PluginCatalog(
    entries.map((entry) => {
      const at = entry.indexOf('=')
      if (at < 1 || at === entry.length - 1) throw new Error('Use --plugin ID=DIRECTORY')
      return {directory: path.resolve(cwd, entry.slice(at + 1)), id: entry.slice(0, at)}
    }),
    {dataRoot: dataRoot ? path.resolve(cwd, dataRoot) : path.join(os.homedir(), '.orbit', 'plugins', 'data')},
  )
}

export async function productExtensions(
  cwd: string,
  options: {pluginDataDir?: string; plugins?: string[]; skillRoots?: string[]},
) {
  const existing = await productSkillCatalog(cwd, options.skillRoots)
  if (!options.plugins?.length) return {skillCatalog: existing}
  const plugins = await productPluginCatalog(cwd, options.plugins, options.pluginDataDir).load(existing)
  return {plugins, skillCatalog: plugins.skillCatalog}
}
