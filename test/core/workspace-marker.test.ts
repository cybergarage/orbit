// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {loadSystemContexts} from '../../src/core/context.js'
import {loadWorkspaceSettings, loadWorkspaceSettingsSync, LocalWorkspaceLocator} from '../../src/core/index.js'

describe('workspace directory markers', () => {
  let root: string
  let child: string

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-marker-')))
    child = path.join(root, 'child')
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.mkdir(child)
    await fs.writeFile(path.join(root, '.orbit', 'settings.json'), JSON.stringify({model: 'parent'}))
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'Parent instruction')
    await fs.writeFile(path.join(child, 'AGENTS.md'), 'Child instruction')
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })
  for (const kind of ['file', 'file-link', 'directory-link']) {
    it(`keeps loaders and contexts consistent for a ${kind} marker`, async () => {
      const marker = path.join(child, '.orbit')
      if (kind === 'file') await fs.writeFile(marker, 'ordinary file')
      else {
        const target = path.join(root, 'marker-target')
        if (kind === 'directory-link') {
          await fs.mkdir(target)
          await fs.writeFile(path.join(target, 'settings.json'), JSON.stringify({model: 'child'}))
        } else await fs.writeFile(target, 'ordinary file')
        await fs.symlink(target, marker, kind === 'directory-link' ? 'junction' : 'file')
      }

      const included = kind === 'directory-link'
      expect(await new LocalWorkspaceLocator({start: child}).directories()).to.deep.equal(
        included ? [root, child] : [root],
      )
      expect(await loadWorkspaceSettings(child)).to.deep.equal({model: included ? 'child' : 'parent'})
      expect(loadWorkspaceSettingsSync(child)).to.deep.equal({model: included ? 'child' : 'parent'})
      expect((await loadSystemContexts(child)).map((context) => context.content)).to.deep.equal(
        included ? ['Parent instruction', 'Child instruction'] : ['Parent instruction'],
      )
    })
  }
})
