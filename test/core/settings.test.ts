// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {configureApp, SETTINGS_FILE_NAME} from '../../src/core/index.js'
import {loadWorkspaceSettings} from '../../src/core/settings.js'

describe('loadWorkspaceSettings', () => {
  afterEach(() => {
    configureApp({appName: 'orbit'})
  })

  it('prefers .orbit/settings.json over workspace settings.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({provider: 'openai'}))
    await fs.writeFile(path.join(root, SETTINGS_FILE_NAME), JSON.stringify({provider: 'anthropic'}))

    expect(await loadWorkspaceSettings(root)).to.deep.equal({provider: 'openai'})
  })

  it('falls back to workspace settings.json when nested settings are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, SETTINGS_FILE_NAME), JSON.stringify({model: 'gpt-4.1'}))

    expect(await loadWorkspaceSettings(root)).to.deep.equal({model: 'gpt-4.1'})
  })

  it('returns empty settings when neither file exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))

    expect(await loadWorkspaceSettings(root)).to.deep.equal({})
  })

  it('throws for invalid JSON', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), '{')

    await expectReject(loadWorkspaceSettings(root), 'Invalid workspace settings')
  })

  it('throws for invalid provider values', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({provider: 'local'}))

    await expectReject(loadWorkspaceSettings(root), 'provider must be one of anthropic, ollama, openai')
  })

  it('uses the configured dot app directory name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    const nested = path.join(root, 'nested')
    configureApp({appName: 'acme'})
    await fs.mkdir(path.join(root, '.acme'))
    await fs.mkdir(nested)
    await fs.writeFile(path.join(root, '.acme', SETTINGS_FILE_NAME), JSON.stringify({provider: 'openai'}))

    expect(await loadWorkspaceSettings(nested)).to.deep.equal({provider: 'openai'})
  })
})

async function expectReject(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected promise to reject')
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.contain(expected)
  }
}
