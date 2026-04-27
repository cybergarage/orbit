// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {loadWorkspaceSettings} from '../../src/core/settings.js'

describe('loadWorkspaceSettings', () => {
  it('prefers .orbit/settings.json over workspace settings.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, '.orbit', 'settings.json'), JSON.stringify({provider: 'openai'}))
    await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({provider: 'anthropic'}))

    expect(await loadWorkspaceSettings(root)).to.deep.equal({provider: 'openai'})
  })

  it('falls back to workspace settings.json when nested settings are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({model: 'gpt-4.1'}))

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
    await fs.writeFile(path.join(root, '.orbit', 'settings.json'), '{')

    await expectReject(loadWorkspaceSettings(root), 'Invalid workspace settings')
  })

  it('throws for invalid provider values', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(path.join(root, '.orbit', 'settings.json'), JSON.stringify({provider: 'local'}))

    await expectReject(loadWorkspaceSettings(root), 'provider must be one of anthropic, ollama, openai')
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
