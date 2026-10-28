// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentOptions, Model} from '../../src/core/index.js'

import {
  Agent,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  SqliteProjectStore,
  ThreadManager,
} from '../../src/core/index.js'
import {SessionRepository} from '../session-storage-fixture.js'

const initial = {model: 'old', provider: 'openai'}
const selected = {model: 'new', provider: 'openai'}
function factory(options: AgentOptions) {
  return new Agent({
    ...options,
    deps: {
      createModel: (provider, model) =>
        ({
          getModel: () => model!,
          getName: () => 'mock',
          getProvider: () => provider!,
          invoke: async () => new Message(MessageType.Assistant, {content: model!}),
        }) as Model,
    },
    logStore: new MemorySessionLogStore(),
  })
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-model-selection-'))
  const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
  return {repository, root}
}

describe('Conversation model selection', () => {
  it('applies on the next turn, preserves history, isolates conversations and restores after restart', async () => {
    const {repository, root} = await fixture()
    const manager = new ThreadManager({createAgent: factory, sessionRepository: repository})
    try {
      const a = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      const b = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      expect((await manager.sendMessage(a.id, 'first')).content).equal('old')
      await manager.selectModel(a.id, selected)
      expect(manager.getThread(a.id)).include(selected)
      expect((await manager.sendMessage(a.id, 'second')).content).equal('new')
      expect((await manager.sendMessage(b.id, 'other')).content).equal('old')
      const {messages} = manager.getThread(a.id)!
      await manager.close()
      const restarted = new ThreadManager({createAgent: factory, sessionRepository: repository})
      try {
        const summary = await repository.findById(a.id)
        expect(summary).include(selected)
        const restored = restarted.resumeThread(summary!.file)
        expect(restored).include(selected)
        expect(restored.messages).deep.equal(messages)
        expect((await restarted.sendMessage(a.id, 'third')).content).equal('new')
      } finally {
        await restarted.close()
      }
    } finally {
      await manager.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('keeps an in-flight turn on its original model and lets the latest selection win', async () => {
    let finish!: () => void
    let entered!: () => void
    const enteredRun = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const manager = new ThreadManager({
      createAgent: (options) =>
        new Agent({
          ...options,
          deps: {
            createModel: (provider, model) =>
              ({
                getModel: () => model!,
                getName: () => 'mock',
                getProvider: () => provider!,
                async invoke() {
                  if (model === 'old') {
                    entered()
                    await gate
                  }

                  return new Message(MessageType.Assistant, {content: model!})
                },
              }) as Model,
          },
          logStore: new MemorySessionLogStore(),
        }),
    })
    try {
      const a = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      const run = manager.sendMessage(a.id, 'first')
      await enteredRun
      await manager.selectModel(a.id, selected)
      await manager.selectModel(a.id, {model: 'latest', provider: 'openai'})
      finish()
      expect((await run).content).equal('old')
      expect((await manager.sendMessage(a.id, 'second')).content).equal('latest')
    } finally {
      finish()
      await manager.close()
    }
  })

  it('keeps old sessions compatible when selection metadata is absent', async () => {
    const {repository, root} = await fixture()
    const session = repository.create(initial)
    const file = session.getFile()!
    await session.close()
    const manager = new ThreadManager({createAgent: factory, sessionRepository: repository})
    try {
      expect(manager.resumeThread(file)).include(initial)
    } finally {
      await manager.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('preserves saved selection when candidate construction or persistence fails', async () => {
    const {repository, root} = await fixture()
    const manager = new ThreadManager({
      createAgent: (options) =>
        new Agent({
          ...options,
          deps: {
            createModel(provider, model) {
              if (model === 'bad') throw new Error('Unavailable')
              return {
                getModel: () => model!,
                getName: () => 'mock',
                getProvider: () => provider!,
                invoke: async () => new Message(MessageType.Assistant, {content: model!}),
              } as Model
            },
          },
          logStore: new MemorySessionLogStore(),
        }),
      sessionRepository: repository,
    })
    try {
      const a = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      let failed = false
      try {
        await manager.selectModel(a.id, {model: 'bad', provider: 'openai'})
      } catch {
        failed = true
      }

      expect(failed).equal(true)
      expect(manager.getThread(a.id)).include(initial)
      expect((await manager.sendMessage(a.id, 'still old')).content).equal('old')
    } finally {
      await manager.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('persists defaults across restart without overriding existing conversation choices', async () => {
    const {repository, root} = await fixture()
    const options = {
      contexts: [],
      createAgent: factory,
      cwd: root,
      logStore: new MemorySessionLogStore(),
      repository,
      settings: {},
      settingsSources: [],
      ...initial,
      discoverModels: async () => [initial, selected],
    }
    const service = new OrbitApplicationService(options)
    let id = ''
    try {
      id = service.createThread().id
      await service.updateDefaultModel(selected)
      expect(service.createThread()).include(selected)
      expect(service.getThread(id)).include(initial)
      let failed = false
      try {
        await service.updateDefaultModel({model: 'missing', provider: 'openai'})
      } catch {
        failed = true
      }

      expect(failed).equal(true)
      expect(service.getDefaultModel()).deep.equal(selected)
    } finally {
      await service.close()
    }

    const restarted = new OrbitApplicationService({...options, logStore: new MemorySessionLogStore()})
    try {
      expect(restarted.getDefaultModel()).deep.equal(selected)
      expect(restarted.createThread()).include(selected)
      expect(await restarted.resumeSession(id)).include(initial)
    } finally {
      await restarted.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('honors explicit project model settings over the saved GUI default', async () => {
    const {repository, root} = await fixture()
    const projectRoot = path.join(root, 'project')
    await fs.mkdir(path.join(projectRoot, '.orbit'), {recursive: true})
    await fs.writeFile(
      path.join(projectRoot, '.orbit', 'settings.json'),
      JSON.stringify({model: 'project-model', provider: 'openai'}),
    )
    const store = new MemoryProjectStore()
    const options = {
      contexts: [],
      createAgent: factory,
      cwd: root,
      discoverModels: async () => [initial, selected],
      model: 'old',
      projectStore: store,
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    }
    const service = new OrbitApplicationService({...options, logStore: new MemorySessionLogStore()})
    try {
      await service.updateDefaultModel(selected)
      const project = await service.projects!.create({
        directory: projectRoot,
        name: 'Configured project',
        operationId: randomUUID(),
      })
      expect(await service.createProjectThread(project.id, {operationId: randomUUID()})).include({
        model: 'project-model',
        provider: 'openai',
      })
      expect(service.createThread()).include(selected)
    } finally {
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unsafe metadata targets before changing the live or persisted selection', async () => {
    const {repository, root} = await fixture()
    const manager = new ThreadManager({createAgent: factory, sessionRepository: repository})
    try {
      const thread = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      await fs.mkdir(path.join(repository.rootDir, '.coordination', thread.id + '.model.json'))
      let failed = false
      try {
        await manager.selectModel(thread.id, selected)
      } catch {
        failed = true
      }

      expect(failed).equal(true)
      expect(manager.getThread(thread.id)).include(initial)
      expect((await manager.sendMessage(thread.id, 'still old')).content).equal('old')
    } finally {
      await manager.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('recalculates smaller context limits and rejects unknown capacity before persistence', async () => {
    const {repository, root} = await fixture()
    let agent!: Agent
    const manager = new ThreadManager({
      createAgent(options) {
        agent = new Agent({
          ...options,
          contextPolicy: {
            mode: 'budgeted',
            profile: {
              model: 'old',
              outputReserve: 2048,
              provider: 'openai',
              revision: 'test',
              safetyMargin: 512,
              summaryOutput: 1024,
              target: 8192,
              templateOverhead: 256,
              trigger: 16_384,
              window: 32_768,
            },
          },
          deps: {
            createModel: (provider, model) =>
              ({
                getContextInfo: async () => ({
                  contextWindow: model === 'unknown' ? null : 8192,
                  maxInputTokens: null,
                  maxOutputTokens: 2048,
                  runtimeContextWindow: null,
                  source: 'catalog',
                }),
                getModel: () => model!,
                getName: () => model!,
                getProvider: () => provider!,
                invoke: async () => new Message(MessageType.Assistant, {content: 'unused'}),
              }) as Model,
          },
          logStore: new MemorySessionLogStore(),
        })
        return agent
      },
      sessionRepository: repository,
    })
    try {
      const thread = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      await manager.selectModel(thread.id, selected)
      expect(agent.getModel().getModel()).equal('old')
      agent.activateModelSelection()
      expect(agent.getModel().getModel()).equal('new')
      expect(agent.contextPolicy.mode).equal('budgeted')
      if (agent.contextPolicy.mode === 'budgeted') expect(agent.contextPolicy.profile.window).equal(8192)
      let rejected = false
      try {
        await manager.selectModel(thread.id, {model: 'unknown', provider: 'openai'})
      } catch {
        rejected = true
      }

      expect(rejected).equal(true)
      expect(manager.getThread(thread.id)).include(selected)
    } finally {
      await manager.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('rejects late preparation from a superseded selection', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new ThreadManager({
      createAgent(options) {
        const agent = factory(options)
        const original = agent.prepareModelSelection.bind(agent)
        agent.prepareModelSelection = async (selection) => {
          if (selection.model === 'slow') await gate
          return original(selection)
        }

        return agent
      },
    })
    try {
      const thread = manager.createThread({agent: {model: {name: 'old', provider: 'openai'}}})
      const first = manager.selectModel(thread.id, {model: 'slow', provider: 'openai'}).catch((error) => error)
      await manager.selectModel(thread.id, selected)
      release()
      expect(String(await first)).contain('superseded')
      expect(manager.getThread(thread.id)).include(selected)
      expect((await manager.sendMessage(thread.id, 'latest selection')).content).equal('new')
    } finally {
      release()
      await manager.close()
    }
  })

  it('restores project selections and preserves a configured remote choice after switching providers', async () => {
    const {repository, root} = await fixture()
    const projectRoot = path.join(root, 'configured')
    await fs.mkdir(path.join(projectRoot, '.orbit'), {recursive: true})
    await fs.writeFile(path.join(projectRoot, '.orbit', 'settings.json'), JSON.stringify({model: 'project-model'}))
    const file = path.join(root, 'projects.sqlite')
    const catalog = await SqliteProjectStore.open({file})
    const local = {model: 'local', provider: 'ollama'}
    const options = {
      contexts: [],
      createAgent: factory,
      cwd: root,
      repository,
      settings: {},
      settingsSources: [],
      ...initial,
      discoverModels: async (_settings: unknown, configured: typeof initial) => [configured, local],
    }
    const service = new OrbitApplicationService({
      ...options,
      logStore: new MemorySessionLogStore(),
      projectStore: catalog,
    })
    let projectId = ''
    let threadId = ''
    try {
      await service.updateDefaultModel(local)
      const project = await service.projects!.create({
        directory: projectRoot,
        name: 'Configured',
        operationId: randomUUID(),
      })
      projectId = project.id
      const thread = await service.createProjectThread(project.id, {operationId: randomUUID()})
      threadId = thread.id
      expect(thread).include({model: 'project-model', provider: 'openai'})
      await service.selectThreadModel(thread.id, local)
      expect(await service.getModelChoices(thread.id)).deep.include({model: 'project-model', provider: 'openai'})
    } finally {
      await service.close()
    }

    const restarted = new OrbitApplicationService({
      ...options,
      logStore: new MemorySessionLogStore(),
      projectStore: await SqliteProjectStore.open({file}),
    })
    try {
      expect(await restarted.resumeSession(threadId)).include(local)
      expect(await restarted.createProjectThread(projectId, {operationId: randomUUID()})).include({
        model: 'project-model',
        provider: 'openai',
      })
    } finally {
      await restarted.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('opens a stale remote conversation without a key and blocks sending until an eligible pair is selected', async () => {
    const {repository, root} = await fixture()
    const stored = repository.create({model: 'gpt-4o', provider: 'openai'})
    const id = stored.getId()
    await stored.close()
    const service = new OrbitApplicationService({
      contexts: [],
      cwd: root,
      discoverModels: async () => [{model: 'local', provider: 'ollama'}],
      enforceCatalog:true,
      logStore: new MemorySessionLogStore(),
      model: 'local',
      provider: 'ollama',
      repository,
      settings: {providers: {openai: {apiKeyEnv: 'ORBIT_TEST_ABSENT_OPENAI_KEY'}}},
      settingsSources: [],
    })
    try {
      expect(await service.resumeSession(id)).include({model: 'gpt-4o', provider: 'openai'})
      let failed = false
      try {
        await service.startRun(id, 'do not dispatch')
      } catch {
        failed = true
      }

      expect(failed).equal(true)
      expect(service.getThread(id)?.messages).deep.equal([])
      expect(await service.selectThreadModel(id, {model: 'local', provider: 'ollama'})).include({
        model: 'local',
        provider: 'ollama',
      })
    } finally {
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
