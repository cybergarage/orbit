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
  SkillCatalog,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Project application runtime', () => {
  it('archives project and unassigned history with filters before pagination and never deletes source files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-lifecycle-app-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const store = new MemoryProjectStore()
    const logs = new MemorySessionLogStore()
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          return new Message(MessageType.Assistant, {content: 'Synthetic reply'})
        },
      }),
      cwd: root,
      logStore: logs,
      model: 'synthetic',
      projectStore: store,
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    })
    try {
      await fs.writeFile(path.join(root, 'source.txt'), 'Synthetic source')
      const project = await service.projects!.create({directory: root, name: 'Synthetic', operationId: randomUUID()})
      const assigned = await service.createProjectThread(project.id, {operationId: randomUUID()})
      const assignedActive = await service.createProjectThread(project.id, {operationId: randomUUID()})
      const unassigned = service.createThread()
      const unassignedActive = service.createThread()
      const membership = await service.projects!.membership(assigned.id)
      const transcript = (await repository.findById(assigned.id))!.file
      const bytes = await fs.readFile(transcript)
      await service.archiveSession(assigned.id)
      await service.archiveSession(unassigned.id)
      expect(await service.projects!.membership(assigned.id)).deep.equals(membership)
      expect(await fs.readFile(transcript)).deep.equals(bytes)
      expect(
        (await service.projects!.listSessions(project.id, {archive: 'archived', limit: 1})).data.map(
          (item) => item.session!.id,
        ),
      ).deep.equals([assigned.id])
      expect(
        (await service.projects!.listSessions(project.id, {archive: 'active', limit: 1})).data.map(
          (item) => item.session!.id,
        ),
      ).deep.equals([assignedActive.id])
      const recent = await service.listUnassignedSessions({archive: 'active', limit: 1})
      expect(recent.data.map((item) => item.id)).deep.equals([unassignedActive.id])
      expect(recent.nextCursor).to.be.undefined
      expect(
        (await service.listUnassignedSessions({archive: 'archived', limit: 1})).data.map((item) => item.id),
      ).deep.equals([unassigned.id])
      expect((await service.listSessions({archive: 'all'})).data).length(4)
      await service.unarchiveSession(assigned.id)
      expect((await service.projects!.listSessions(project.id, {archive: 'active'})).data).length(2)
      try {
        await service.deleteProject(project.id, {expectedRevision: 1, operationId: randomUUID()})
        throw new Error('Expected nonempty refusal')
      } catch (error) {
        expect(String(error)).contains('Move or delete')
      }

      await service.deleteSession(assigned.id)
      await service.deleteSession(assignedActive.id)
      await service.deleteProject(project.id, {expectedRevision: 1, operationId: randomUUID()})
      expect(await store.query({id: project.id, kind: 'project'})).equals(null)
      expect(await fs.readFile(path.join(root, 'source.txt'), 'utf8')).equals('Synthetic source')
    } finally {
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('rejects run admission during archive without interrupting a run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-archive-race-'))
    let release!: () => void
    let closing!: () => void
    const started = new Promise<void>((resolve) => {
      closing = resolve
    })
    const settle = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {
          closing()
          await settle
        },
        async invoke() {
          throw new Error('Must not dispatch')
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      provider: 'openai',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settings: {},
      settingsSources: [],
    })
    try {
      const thread = service.createThread()
      const archive = service.archiveSession(thread.id)
      await started
      try {
        await service.startRun(thread.id, 'Synthetic input')
        throw new Error('Expected refusal')
      } catch (error) {
        expect(String(error)).contains('lifecycle change')
      }

      release()
      expect((await archive).archived).equals(true)
    } finally {
      release()
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('retains a concurrently resumed runtime when archive loses writer admission', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-archive-runtime-race-'))
    const oldCatalog = new SkillCatalog([])
    const resumedCatalog = new SkillCatalog([])
    let entered!: () => void
    let release!: () => void
    const settling = new Promise<void>((resolve) => {
      entered = resolve
    })
    const settled = new Promise<void>((resolve) => {
      release = resolve
    })
    oldCatalog.settle = async () => {
      entered()
      await settled
    }

    let resolutions = 0
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          return new Message(MessageType.Assistant, {content: 'Synthetic reply'})
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      projectStore: new MemoryProjectStore(),
      provider: 'openai',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      resolveProjectRuntime: async (cwd) => ({
        cwd,
        settings: {},
        skillCatalog: resolutions++ === 0 ? oldCatalog : resumedCatalog,
      }),
      settings: {},
      settingsSources: [],
    })
    try {
      const project = await service.projects!.create({name: 'Synthetic', operationId: randomUUID()})
      const thread = await service.createProjectThread(project.id, {operationId: randomUUID()})
      const archive = service.archiveSession(thread.id).then(
        () => {},
        (error: unknown) => error,
      )
      await settling
      await service.resumeSession(thread.id)
      const runtimes = (service as unknown as {threadRuntime: Map<string, AgentOptions>}).threadRuntime
      const resumed = runtimes.get(thread.id)
      expect(resumed?.skillCatalog).equals(resumedCatalog)
      release()
      expect(String(await archive)).contains('already open')
      expect(service.getThread(thread.id)).not.to.be.undefined
      expect(runtimes.get(thread.id)).equals(resumed)
    } finally {
      release()
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('refuses active and quarantined application archive without closing the thread', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-archive-busy-'))
    const service = new OrbitApplicationService({
      contexts: [],
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      provider: 'openai',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settings: {},
      settingsSources: [],
    })
    const original = service.getThread.bind(service)
    try {
      for (const thread of [{status: 'running'}, {run: {quarantined: true}, status: 'idle'}]) {
        service.getThread = (() => thread) as unknown as typeof service.getThread
        try {
          // eslint-disable-next-line no-await-in-loop
          await service.archiveSession('synthetic')
          throw new Error('Expected refusal')
        } catch (error) {
          expect(String(error)).contains('active or quarantined')
        }
      }
    } finally {
      service.getThread = original
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

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
