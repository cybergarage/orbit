// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentOptions} from '../../../src/core/index.js'

import {
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  PLUGIN_SCHEMA,
  PluginCatalog,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Project application runtime', () => {
  it('isolates workspace settings and instructions, keeps unassigned creation synchronous, and restores saved models', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-project-app-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const store = new MemoryProjectStore()
    const agents: AgentOptions[] = []
    for (const name of ['a', 'b']) {
      // Each workspace is independently initialized before concurrent use.
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.join(root, name, '.orbit'), {recursive: true})
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(
        path.join(root, name, '.orbit', 'settings.json'),
        JSON.stringify({model: `model-${name}`, provider: 'openai'}),
      )
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(root, name, 'AGENTS.md'), `Instructions for ${name}`)
    }

    const packageRoot = path.join(root, 'plugin')
    await fs.mkdir(path.join(packageRoot, 'skills', 'shared'), {recursive: true})
    await fs.writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({$schema: PLUGIN_SCHEMA, name: 'shared'}))
    await fs.writeFile(
      path.join(packageRoot, 'skills', 'shared', 'SKILL.md'),
      '---\nname: shared\ndescription: Shared skill\n---\nInstruction',
    )
    const plugins = await new PluginCatalog([{directory: packageRoot, id: 'shared'}], {
      dataRoot: path.join(root, 'plugin-data'),
    }).load()
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent(options) {
        agents.push(options)
        return {
          async close() {},
          async invoke(messages, invocation) {
            options.state!.getSession().appendMessages(messages, {turnId: invocation?.turnId})
            const reply = new Message(MessageType.Assistant, {content: `Reply in ${options.cwd}`})
            options.state!.getSession().appendMessages([reply], {turnId: invocation?.turnId})
            return reply
          },
        }
      },
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'startup',
      plugins,
      projectStore: store,
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    })
    try {
      const unassigned = service.createThread()
      expect(unassigned.id).a('string')
      expect(await service.projects!.membership(unassigned.id)).equals(null)
      const [a, b] = await Promise.all(
        ['a', 'b'].map((name) =>
          service.projects!.create({directory: path.join(root, name), name, operationId: randomUUID()}),
        ),
      )
      const [at, bt] = await Promise.all(
        [a, b].map((project) => service.createProjectThread(project.id, {operationId: randomUUID()})),
      )
      expect(at).include({cwd: path.join(root, 'a'), model: 'model-a'})
      expect(bt).include({cwd: path.join(root, 'b'), model: 'model-b'})
      expect(agents.find((agent) => agent.cwd === at.cwd)?.messages?.[0].content).equals('Instructions for a')
      expect(agents.find((agent) => agent.cwd === bt.cwd)?.messages?.[0].content).equals('Instructions for b')
      expect(service.runtime.cwd).equals(root)
      expect(service.pluginInspection(at.id).plugins.map((p) => p.id)).deep.equals(['shared'])
      const projectRuntime = agents.find((agent) => agent.cwd === at.cwd)!
      expect((await projectRuntime.skillCatalog!.list()).candidates.map((c) => c.name)).deep.equals(['shared'])
      expect(projectRuntime.plugins?.skillCatalog).equals(projectRuntime.skillCatalog)
      const finished = new Promise<void>((resolve) => {
        const pending = new Set([at.id, bt.id])
        const unsubscribe = service.subscribe((event) => {
          if (event.type === 'run.completed' && event.threadId) {
            pending.delete(event.threadId)
            if (pending.size === 0) {
              unsubscribe()
              resolve()
            }
          }
        })
      })
      await Promise.all([service.startRun(at.id, 'First'), service.startRun(bt.id, 'Second')])
      await finished
      // Resume after an explicit idle move, retaining the original workspace and model.
      await service.projects!.changeMembership(at.id, {
        expectedRevision: 1,
        operationId: randomUUID(),
        projectId: b.id,
        sourceProjectId: a.id,
      })
      await fs.writeFile(
        path.join(root, 'a', '.orbit', 'settings.json'),
        JSON.stringify({model: 'changed', provider: 'openai'}),
      )
      expect(await service.resumeSession(at.id)).include({cwd: at.cwd, model: 'model-a'})
      const archived = await service.projects!.update(b.id, {
        archived: true,
        directory: b.defaultDirectory,
        expectedRevision: b.revision,
        name: b.name,
        operationId: randomUUID(),
      })
      expect(archived.archived).equals(true)
      try {
        await service.startRun(at.id, 'Blocked')
        throw new Error('Expected archive refusal')
      } catch (error) {
        expect(String(error)).contains('archived')
      }

      expect(await service.deleteSession(at.id)).equals(true)
      expect(await service.projects!.membership(at.id)).include({projectId: null, unavailable: true})
    } finally {
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
