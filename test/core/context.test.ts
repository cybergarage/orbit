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
})
