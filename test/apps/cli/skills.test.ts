// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import type {SkillListing} from '../../../src/core/index.js'

import {runExecCommand} from '../../../src/apps/cli/exec.js'
import {productSkillCatalog} from '../../../src/apps/skill-catalog.js'
import {Agent, MemorySessionLogStore, Message, MessageType} from '../../../src/core/index.js'
import {createInitialInteractiveState, handleSkillCommand} from '../../../src/core/interactive.js'

describe('Skill CLI entry points', () => {
  it('lists JSON metadata and passes an explicit selection through exec', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-cli-skill-')))
    const logs = new MemorySessionLogStore()
    try {
      const directory = path.join(root, '.orbit', 'skills', 'review')
      await fs.mkdir(directory, {recursive: true})
      await fs.writeFile(
        path.join(directory, 'SKILL.md'),
        '---\nname: review\ndescription: Isolated CLI fixture\nlicense: MIT\ncompatibility: Requires Node.js\n---\nCLI_SKILL_SENTINEL\n',
      )
      const launcher = fileURLToPath(new URL('../../../bin/run.js', import.meta.url))
      const {stdout} = await promisify(execFile)(process.execPath, [launcher, 'skills', '--json'], {cwd: root})
      const list = JSON.parse(stdout) as SkillListing
      expect(list.candidates).to.have.length(1)
      expect(list.candidates[0].rootId).to.equal('workspace')
      expect(stdout).not.to.include('CLI_SKILL_SENTINEL')
      expect(list.candidates[0]).to.include({compatibility: 'Requires Node.js', license: 'MIT'})
      const text = await promisify(execFile)(process.execPath, [launcher, 'skills'], {cwd: root})
      expect(text.stdout).to.include('license="MIT"').and.include('compatibility="Requires Node.js"')
      const custom = await productSkillCatalog(root, ['chosen=.orbit/skills'])
      expect((await custom!.list()).candidates[0].rootId).to.equal('chosen')
      const state = createInitialInteractiveState({model: 'fixture', provider: 'ollama', skillCatalog: custom})
      const ink = await handleSkillCommand(state, '/skills')
      expect(ink?.message).to.include('license="MIT"').and.include('compatibility="Requires Node.js"')
      class FixtureAgent extends Agent {
        constructor(options: ConstructorParameters<typeof Agent>[0]) {
          super({
            ...options,
            deps: {
              createModel: () => ({
                getModel: () => 'fixture',
                getName: () => 'fixture',
                getProvider: () => 'ollama',
                async invoke(messages) {
                  expect(messages.filter((m) => m.content.includes('CLI_SKILL_SENTINEL'))).to.have.length(1)
                  return new Message(MessageType.Assistant, {content: 'Verified'})
                },
              }),
            },
            logStore: logs,
            toolProfile: 'none',
          })
        }
      }
      const selected = list.candidates[0]
      expect(
        await runExecCommand(
          {model: 'fixture', prompt: 'Inspect', provider: 'ollama', skills: [`${selected.id}@${selected.digest}`]},
          undefined,
          root,
          {agentClass: FixtureAgent, contextLoader: async () => [], ollamaModelSelector: async () => 'fixture'},
        ),
      ).to.equal('Verified')
    } finally {
      await logs.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
