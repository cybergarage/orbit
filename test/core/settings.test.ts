// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {configureApp, SETTINGS_FILE_NAME} from '../../src/core/index.js'
import {loadWorkspaceSettings, loadWorkspaceSettingsSync} from '../../src/core/settings.js'

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

  it('overrides shallow workspace settings with deeper workspace settings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})
    await fs.writeFile(
      path.join(root, '.orbit', SETTINGS_FILE_NAME),
      JSON.stringify({model: 'root-model', provider: 'openai'}),
    )

    await fs.writeFile(path.join(child, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({model: 'child-model'}))

    expect(await loadWorkspaceSettings(grandchild)).to.deep.equal({model: 'child-model', provider: 'openai'})
  })

  it('loads provider and MCP settings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(
      path.join(root, '.orbit', SETTINGS_FILE_NAME),
      JSON.stringify({
        mcp: {
          servers: {
            filesystem: {
              args: ['--root', '.'],
              command: 'mcp-filesystem',
              env: {DEBUG: '1'},
            },
          },
        },
        providers: {
          anthropic: {apiKeyEnv: 'ANTHROPIC_KEY'},
          ollama: {host: 'http://localhost:11434'},
          openai: {apiKeyEnv: 'OPENAI_KEY'},
        },
      }),
    )

    expect(await loadWorkspaceSettings(root)).to.deep.equal({
      mcp: {
        servers: {
          filesystem: {
            args: ['--root', '.'],
            command: 'mcp-filesystem',
            env: {DEBUG: '1'},
          },
        },
      },
      providers: {
        anthropic: {apiKeyEnv: 'ANTHROPIC_KEY'},
        ollama: {host: 'http://localhost:11434'},
        openai: {apiKeyEnv: 'OPENAI_KEY'},
      },
    })
  })

  it('merges nested settings from shallowest to deepest workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    const child = path.join(root, 'child')
    const grandchild = path.join(child, 'grandchild')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.mkdir(grandchild, {recursive: true})
    await fs.writeFile(
      path.join(root, '.orbit', SETTINGS_FILE_NAME),
      JSON.stringify({
        mcp: {
          servers: {
            search: {args: ['root'], command: 'root-search', env: {ROOT: '1'}},
          },
        },
        providers: {
          anthropic: {apiKeyEnv: 'ROOT_ANTHROPIC_KEY'},
          openai: {apiKeyEnv: 'ROOT_OPENAI_KEY'},
        },
      }),
    )
    await fs.writeFile(
      path.join(child, '.orbit', SETTINGS_FILE_NAME),
      JSON.stringify({
        mcp: {
          servers: {
            search: {args: ['child'], command: 'child-search'},
            shell: {command: 'child-shell'},
          },
        },
        providers: {
          openai: {apiKeyEnv: 'CHILD_OPENAI_KEY'},
        },
      }),
    )

    expect(await loadWorkspaceSettings(grandchild)).to.deep.equal({
      mcp: {
        servers: {
          search: {args: ['child'], command: 'child-search', env: {ROOT: '1'}},
          shell: {command: 'child-shell'},
        },
      },
      providers: {
        anthropic: {apiKeyEnv: 'ROOT_ANTHROPIC_KEY'},
        openai: {apiKeyEnv: 'CHILD_OPENAI_KEY'},
      },
    })
  })

  it('throws for invalid provider settings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({providers: {openai: {apiKeyEnv: 1}}}))

    await expectReject(loadWorkspaceSettings(root), 'providers.openai.apiKeyEnv must be a string')
  })

  it('throws for invalid MCP server settings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({mcp: {servers: {bad: {args: ['ok']}}}}))

    await expectReject(loadWorkspaceSettings(root), 'mcp.servers.bad.command must be a string')
  })

  it('returns the same result from sync and async loaders', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.writeFile(
      path.join(root, '.orbit', SETTINGS_FILE_NAME),
      JSON.stringify({provider: 'ollama', providers: {ollama: {host: 'http://localhost:11434'}}}),
    )

    expect(loadWorkspaceSettingsSync(root)).to.deep.equal(await loadWorkspaceSettings(root))
  })

  it('uses the current working directory when no start directory is provided', async () => {
    const previousCwd = process.cwd()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'))
    const child = path.join(root, 'child')
    await fs.mkdir(path.join(root, '.orbit'), {recursive: true})
    await fs.mkdir(child)
    await fs.writeFile(path.join(root, '.orbit', SETTINGS_FILE_NAME), JSON.stringify({provider: 'openai'}))

    try {
      process.chdir(child)

      expect(await loadWorkspaceSettings()).to.deep.equal({provider: 'openai'})
    } finally {
      process.chdir(previousCwd)
    }
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
