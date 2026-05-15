// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {LocalWorkspaceLocator, type WorkspaceLocator} from '../../src/core/index.js'

describe('LocalWorkspaceLocator', () => {
  it('returns matching workspace directories from shallowest to deepest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})

    expect(await new LocalWorkspaceLocator({start: grandchild}).directories()).to.deep.equal([root, child])
  })

  it('returns an empty list when no workspace directories match', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const child = path.join(root, 'child')
    await fs.mkdir(child)

    expect(await new LocalWorkspaceLocator({start: child}).directories()).to.deep.equal([])
  })

  it('uses the current working directory when no start directory is provided', async () => {
    const previousCwd = process.cwd()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const realRoot = await fs.realpath(root)
    const child = path.join(root, 'child')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(child)

    try {
      process.chdir(child)

      expect(await new LocalWorkspaceLocator().directories()).to.deep.equal([realRoot])
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('is exported from the public core API', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    const locator: WorkspaceLocator = new LocalWorkspaceLocator({start: root})

    expect(await locator.directories()).to.deep.equal([root])
  })
})
