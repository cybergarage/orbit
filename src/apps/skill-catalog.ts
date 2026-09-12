// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import path from 'node:path'

import {SkillCatalog} from '../core/skills/index.js'
import {LocalWorkspaceLocator} from '../core/workspace.js'
export async function productSkillCatalog(cwd: string, roots?: string[]): Promise<SkillCatalog | undefined> {
  if (roots?.length)
    return new SkillCatalog(
      roots.map((value) => {
        const separator = value.indexOf('=')
        if (separator < 1 || separator === value.length - 1) throw new Error('Use --skill-root ID=DIRECTORY')
        return {directory: path.resolve(cwd, value.slice(separator + 1)), id: value.slice(0, separator)}
      }),
    )
  const nearest = (await new LocalWorkspaceLocator({start: cwd}).directories()).at(-1)
  return nearest ? new SkillCatalog([{directory: path.join(nearest, '.orbit', 'skills'), id: 'workspace'}]) : undefined
}
