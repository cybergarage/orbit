// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {resolveGuiStartupOptions} from '../../../src/apps/cli/gui.js'

describe('GUI saved model startup', () => {
  it('loads a saved default without discovering an unrelated startup model', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-default-'))
    await fs.mkdir(path.join(root, 'sessions', '.coordination'), {recursive: true})
    await fs.writeFile(
      path.join(root, 'sessions', '.coordination', 'gui-default-model.json'),
      JSON.stringify({model: 'saved-local-model', provider: 'ollama'}),
    )
    try {
      const resolved = await resolveGuiStartupOptions({}, root, path.join(root, 'sessions'))
      expect(resolved).include({model: 'saved-local-model', provider: 'ollama'})
      await fs.mkdir(path.join(root, '.orbit'))
      await fs.writeFile(
        path.join(root, '.orbit', 'settings.json'),
        JSON.stringify({model: 'configured-project-model', provider: 'openai'}),
      )
      const configured = await resolveGuiStartupOptions({}, root, path.join(root, 'sessions'))
      expect(configured).include({model: 'configured-project-model', provider: 'openai'})
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('rejects corrupt stored defaults without silently falling back', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-invalid-default-'))
    await fs.mkdir(path.join(root, '.coordination'))
    await fs.writeFile(path.join(root, '.coordination', 'gui-default-model.json'), 'not-json')
    let failed = false
    try {
      await resolveGuiStartupOptions({}, root, root)
    } catch {
      failed = true
    }

    expect(failed).equal(true)
    expect(await resolveGuiStartupOptions({model: 'manual', provider: 'openai'}, root, root)).include({
      model: 'manual',
      provider: 'openai',
    })
    await fs.rm(root, {force: true, recursive: true})
  })
})
