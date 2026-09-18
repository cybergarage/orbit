// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

describe('inventory CLI commands', () => {
  let root: string
  const launcher = fileURLToPath(new URL('../../../bin/run.js', import.meta.url))

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-cli-inventory-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(
      path.join(root, '.orbit', 'settings.json'),
      JSON.stringify({
        mcp: {
          servers: {fixture: {args: ['--version'], command: process.execPath, env: {API_KEY: 'fake-private-value'}}},
        },
        tools: {include: ['read'], profile: 'none'},
      }),
    )
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  for (const args of [
    ['tools', '--json'],
    ['mcp', 'list', '--json'],
  ]) {
    it(`lists ${args.join(' ')} without credentials or process startup`, async () => {
      const {stdout} = await promisify(execFile)(process.execPath, [launcher, ...args], {cwd: root})
      const result = JSON.parse(stdout)
      expect(result.servers).deep.equal([{name: 'fixture', status: 'not-connected', toolCount: null}])
      expect(stdout).not.include('fake-private-value')
      expect(stdout).not.include(process.execPath)
      if (args[0] === 'tools') expect(result.tools.map((tool: {name: string}) => tool.name)).deep.equal(['read'])
    })
  }

  it('returns JSON and a failing exit code when noninteractive discovery lacks approval', async () => {
    let failure: unknown
    try {
      await promisify(execFile)(process.execPath, [launcher, 'tools', '--json', '--connect'], {cwd: root})
    } catch (error) {
      failure = error
    }

    expect(failure).to.have.property('code', 1)
    const {stdout} = failure as {stdout: string}
    const result = JSON.parse(stdout)
    expect(result.complete).equal(false)
    expect(result.servers[0].status).equal('failed')
    expect(result.inspection.operations[0].status).equal('denied')
    expect(stdout).not.include('fake-private-value')
  })
})
