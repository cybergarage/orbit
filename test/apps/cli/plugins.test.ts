// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import {runExecCommand} from '../../../src/apps/cli/exec.js'
import {productExtensions} from '../../../src/apps/plugins.js'
import {Agent, MemorySessionLogStore, Message, MessageType, PLUGIN_SCHEMA} from '../../../src/core/index.js'
import {createInitialInteractiveState, handleSkillCommand} from '../../../src/core/interactive.js'

describe('plugin product integration', () => {
  it('inspects without executing, selects plugin Skills in Ink and executes with a fixed model', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-plugin-cli-')))
    const pkg = path.join(root, 'package')
    try {
      await fs.mkdir(path.join(pkg, 'skills', 'review'), {recursive: true})
      await fs.writeFile(path.join(pkg, 'plugin.json'), JSON.stringify({$schema: PLUGIN_SCHEMA, name: 'review-plugin'}))
      await fs.writeFile(
        path.join(pkg, 'skills', 'review', 'SKILL.md'),
        '---\nname: review\ndescription: Review\nallowed-tools: read\n---\nPLUGIN_INSTRUCTION',
      )
      const options = {pluginDataDir: path.join(root, 'data'), plugins: ['review=package']}
      const {plugins, skillCatalog} = await productExtensions(root, options)
      const listing = await skillCatalog!.list()
      const selected = listing.candidates[0]
      expect(selected.plugin?.id).equal('review')
      const state = createInitialInteractiveState({model: 'fixture', plugins, provider: 'ollama', skillCatalog})
      expect(state.plugins).equal(plugins)
      expect((await handleSkillCommand(state, '/skills'))?.message).contains('review')
      const launcher = fileURLToPath(new URL('../../../bin/run.js', import.meta.url))
      const result = await promisify(execFile)(
        process.execPath,
        [
          launcher,
          'plugins',
          'list',
          '--plugin',
          'review=package',
          '--plugin-data-dir',
          path.join(root, 'data'),
          '--json',
        ],
        {cwd: root},
      )
      expect(JSON.parse(result.stdout).plugins[0].id).equal('review')
      expect(result.stdout).not.contains('PLUGIN_INSTRUCTION')
      class Fixture extends Agent {
        constructor(config: ConstructorParameters<typeof Agent>[0]) {
          super({
            ...config,
            deps: {
              createModel: () => ({
                getModel: () => 'fixture',
                getName: () => 'fixture',
                getProvider: () => 'ollama',
                async invoke(messages) {
                  expect(messages.some((m) => m.content.includes('PLUGIN_INSTRUCTION'))).equal(true)
                  return new Message(MessageType.Assistant, {content: 'plugin selected'})
                },
              }),
            },
            logStore: new MemorySessionLogStore(),
            toolProfile: 'none',
          })
        }
      }
      const answer = await runExecCommand(
        {
          ...options,
          model: 'fixture',
          prompt: 'review',
          provider: 'ollama',
          skills: [`${selected.id}@${selected.digest}`],
        },
        undefined,
        root,
        {
          agentClass: Fixture,
          contextLoader: async () => [],
          ollamaModelSelector: async () => 'fixture',
          settingsLoader: async () => ({}),
        },
      )
      expect(answer).equal('plugin selected')
      await skillCatalog?.settle()
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
