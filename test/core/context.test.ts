// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {loadContext} from '../../src/core/context.js'
import {configureApp} from '../../src/core/index.js'

describe('loadContext', () => {
  afterEach(() => {
    configureApp({appName: 'orbit'})
  })

  it('uses the configured app name for workspace context files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const nested = path.join(root, 'nested')
    configureApp({appName: 'acme'})
    await fs.mkdir(path.join(root, '.acme'))
    await fs.mkdir(nested)
    await fs.writeFile(path.join(root, 'ACME.md'), 'custom context')

    expect(await loadContext(nested)).to.deep.equal({
      source: {file: path.join(root, 'ACME.md'), kind: 'compat'},
      text: 'custom context',
    })
  })

  it('returns the deepest discovered workspace context', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})
    await fs.writeFile(path.join(root, 'ORBIT.md'), 'root context')
    await fs.writeFile(path.join(child, 'ORBIT.md'), 'child context')

    expect(await loadContext(grandchild)).to.deep.equal({
      source: {file: path.join(child, 'ORBIT.md'), kind: 'compat'},
      text: 'child context',
    })
  })
})
