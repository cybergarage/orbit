// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {findWorkspaceDirectories} from '../../src/core/workspace.js'

describe('findWorkspaceDirectories', () => {
  it('returns matching workspace directories from shallowest to deepest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})

    expect(await findWorkspaceDirectories(grandchild)).to.deep.equal([root, child])
  })

  it('returns an empty list when no workspace directories match', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-workspace-'))
    const child = path.join(root, 'child')
    await fs.mkdir(child)

    expect(await findWorkspaceDirectories(child)).to.deep.equal([])
  })
})
