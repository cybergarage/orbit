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

  it('returns matching workspace files from shallowest to deepest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})
    await fs.writeFile(path.join(root, 'ROOT.md'), 'root')
    await fs.writeFile(path.join(child, 'CHILD.md'), 'child')
    await fs.writeFile(path.join(child, 'notes.txt'), 'notes')

    expect(await new LocalWorkspaceLocator({start: grandchild}).files(/\.md$/)).to.deep.equal([
      path.join(root, 'ROOT.md'),
      path.join(child, 'CHILD.md'),
    ])
  })

  it('sorts matching workspace files by name within each workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, 'B.md'), 'b')
    await fs.writeFile(path.join(root, 'A.md'), 'a')

    expect(await new LocalWorkspaceLocator({start: root}).files(/\.md$/)).to.deep.equal([
      path.join(root, 'A.md'),
      path.join(root, 'B.md'),
    ])
  })

  it('ignores directories when matching workspace files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(root, 'DIR.md'))
    await fs.writeFile(path.join(root, 'FILE.md'), 'file')

    expect(await new LocalWorkspaceLocator({start: root}).files(/\.md$/)).to.deep.equal([path.join(root, 'FILE.md')])
  })

  it('returns an empty list when no workspace files match', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, 'notes.txt'), 'notes')

    expect(await new LocalWorkspaceLocator({start: root}).files(/\.md$/)).to.deep.equal([])
  })

  it('matches workspace files with global regular expressions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, 'A.md'), 'a')
    await fs.writeFile(path.join(root, 'B.md'), 'b')

    expect(await new LocalWorkspaceLocator({start: root}).files(/\.md$/g)).to.deep.equal([
      path.join(root, 'A.md'),
      path.join(root, 'B.md'),
    ])
  })

  it('matches workspace files by exact string names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'agents')
    await fs.writeFile(path.join(root, 'AGENTS.local.md'), 'local')

    expect(await new LocalWorkspaceLocator({start: root}).files('AGENTS.md')).to.deep.equal([path.join(root, 'AGENTS.md')])
  })

  it('does not treat string workspace file patterns as partial matches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'agents')

    const locator = new LocalWorkspaceLocator({start: root})

    expect(await locator.files('AGENTS')).to.deep.equal([])
    expect(await locator.files('.md')).to.deep.equal([])
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

    expect(await locator.files('AGENTS.md')).to.deep.equal([])
    expect(await locator.files(/\.md$/)).to.deep.equal([])
  })
})
