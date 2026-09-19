// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {loadSystemContexts} from '../../src/core/context.js'
import {configureApp} from '../../src/core/index.js'

describe('loadSystemContexts', () => {
  afterEach(() => {
    configureApp({appName: 'orbit'})
  })

  it('returns an empty array when no workspace directories are found', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    expect(await loadSystemContexts(nested)).to.deep.equal([])
  })

  it('loads AGENTS.md regardless of the configured app name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const nested = path.join(root, 'nested')
    configureApp({appName: 'acme'})
    await fs.mkdir(path.join(root, '.acme'))
    await fs.mkdir(nested)
    await fs.writeFile(path.join(root, 'ACME.md'), 'ignored context')
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'custom context')

    expect(await loadSystemContexts(nested)).to.deep.equal([
      {
        content: 'custom context',
        source: {file: path.join(root, 'AGENTS.md'), kind: 'compat'},
      },
    ])
  })

  it('returns all discovered workspace contexts from shallowest to deepest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'root context')
    await fs.writeFile(path.join(child, 'AGENTS.md'), 'child context')

    expect(await loadSystemContexts(grandchild)).to.deep.equal([
      {
        content: 'root context',
        source: {file: path.join(root, 'AGENTS.md'), kind: 'compat'},
      },
      {
        content: 'child context',
        source: {file: path.join(child, 'AGENTS.md'), kind: 'compat'},
      },
    ])
  })

  it('loads only AGENTS.md when legacy context files coexist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const nested = path.join(root, 'nested')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(nested)
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'agents context')
    await fs.writeFile(path.join(root, 'ORBIT.md'), 'orbit context')

    expect(await loadSystemContexts(nested)).to.deep.equal([
      {
        content: 'agents context',
        source: {file: path.join(root, 'AGENTS.md'), kind: 'compat'},
      },
    ])
  })

  it('ignores legacy context files when AGENTS.md is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, 'ORBIT.md'), 'legacy context')

    expect(await loadSystemContexts(root)).to.deep.equal([])
  })

  it('skips empty AGENTS.md files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, 'AGENTS.md'), '')

    expect(await loadSystemContexts(root)).to.deep.equal([])
  })

  it('uses the current working directory when no start directory is provided', async () => {
    const previousCwd = process.cwd()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-'))
    const realRoot = await fs.realpath(root)
    const child = path.join(root, 'child')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(child)
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'cwd context')

    try {
      process.chdir(child)

      expect(await loadSystemContexts()).to.deep.equal([
        {
          content: 'cwd context',
          source: {file: path.join(realRoot, 'AGENTS.md'), kind: 'compat'},
        },
      ])
    } finally {
      process.chdir(previousCwd)
    }
  })
})
