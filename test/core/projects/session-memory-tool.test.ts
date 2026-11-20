// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentInvokeOptions, Model, ModelCapabilities} from '../../../src/core/index.js'

import {
  Agent,
  AppleFoundationModelsAgent,
  AppleProjectMemoryAgent,
  createProjectMemorySearchTool,
  createProvider,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  ProjectMemoryService,
  ProjectService,
  State,
} from '../../../src/core/index.js'
import {getToolResult} from '../../../src/core/models/adapters/tools.js'
import {normalizeToolResult, toolResultText} from '../../../src/core/tools/definition.js'
import {SessionRepository} from '../../session-storage-fixture.js'

const NAME = 'project_memory_search'

function driver(support: ModelCapabilities['tools'] = 'unknown') {
  let id = 'synthetic'
  let provider = 'openai'
  let capability = support
  const seen: string[][] = []
  const results: ReturnType<typeof JSON.parse>[] = []
  let onRequest: (() => Promise<void> | void) | undefined
  let input: unknown = {limit: 2, query: 'catalog status'}
  const model: Model = {
    async getCapabilities() {
      return {source: 'adapter', tools: capability}
    },
    getModel: () => id,
    getName: () => 'synthetic',
    getProvider: () => provider,
    async invoke(messages, options) {
      expect(options).not.have.property('memorySearch')
      seen.push(options?.tools?.map((spec) => spec.name) ?? [])
      const prior = getToolResult(messages.at(-1)!)
      if (prior) {
        if (prior.isError) return new Message(MessageType.Assistant, {content: 'Search was refused.'})
        const result = JSON.parse(toolResultText(normalizeToolResult(prior.output)))
        results.push(result)
        return new Message(MessageType.Assistant, {
          content: result.results.map((entry: {body: string}) => entry.body).join('\n') || 'No evidence.',
        })
      }

      if (seen.length === 1) expect(JSON.stringify(messages)).not.contains('cobalt')
      await onRequest?.()
      return seen.at(-1)!.includes(NAME)
        ? new Message(MessageType.Assistant, {payload: {toolCalls: [{id: `call-${seen.length}`, input, name: NAME}]}})
        : new Message(MessageType.Assistant, {content: 'No search available.'})
    },
  }
  return {
    model,
    onRequest(value: typeof onRequest) {
      onRequest = value
    },
    results,
    seen,
    setCapability(value: ModelCapabilities['tools']) {
      capability = value
    },
    setId(value: string) {
      id = value
    },
    setInput(value: unknown) {
      input = value
    },
    setProvider(value: string) {
      provider = value
    },
  }
}

async function run(a: Agent, permit?: AgentInvokeOptions['memorySearch'], requestId = randomUUID()) {
  const handle = await a.startRun(
    [new Message(MessageType.User, {content: 'What is the saved catalog status choice?'})],
    {requestId, ...(permit ? {memorySearch: permit} : {})},
  )
  return handle.finished
}

describe('Host-permitted automatic Session memory tools', () => {
  let root: string
  let repository: SessionRepository
  let store: MemoryProjectStore
  let projects: ProjectService
  let memory: ProjectMemoryService

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-memory-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    store = new MemoryProjectStore()
    const host = {async closeThread() {}, getThread(): undefined {}}
    projects = new ProjectService(store, repository, host, root)
    memory = new ProjectMemoryService(projects, host)
  })

  afterEach(async () => {
    await memory.close()
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  async function fixture() {
    const project = await projects.create({name: 'Synthetic', operationId: randomUUID()})
    const a = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
    const [message] = a.appendMessages([new Message(MessageType.User, {content: 'Use cobalt for catalog status.'})])
    await a.synchronize('file-sync')
    const sourceId = a.getId()
    await a.close()
    const entry = await memory.saveExcerpt(project.id, {
      excerpt: message.content,
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: sourceId,
      title: 'Catalog status',
    })
    const b = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
    return {b, entry, message, project, sourceId}
  }

  function agent(
    f: Awaited<ReturnType<typeof fixture>>,
    model: Model,
    extra: ConstructorParameters<typeof Agent>[0] = {},
  ) {
    const logs = new MemorySessionLogStore()
    return new Agent({
      cwd: root,
      deps: {createModel: () => model},
      logStore: logs,
      projectMemory: memory,
      state: new State(f.b),
      toolProfile: 'none',
      ...extra,
    })
  }

  for (const support of ['supported', 'unknown', 'unsupported'] as const)
    it(`offers the canonical search for general ${support} with a host grant`, async () => {
      const f = await fixture()
      const d = driver(support)
      const a = agent(f, d.model)
      try {
        expect((await run(a, () => true)).outcome).equals('completed')
        expect(d.seen[0]).deep.equals(support === 'unsupported' ? [] : [NAME])
        if (support !== 'unsupported') {
          expect(d.results[0].results[0].id).equals(f.entry.id)
          expect(d.results[0].results[0].sources[0]).includes({messageId: f.message.id, sessionId: f.sourceId})
          expect(f.b.getMessages().at(-1)?.content).contains('cobalt')
        }
      } finally {
        await a.close()
        await f.b.close()
      }
    })

  for (const kind of ['absent', 'denied', 'throwing'] as const)
    it(`does not attach when permission is ${kind}`, async () => {
      const f = await fixture()
      const d = driver()
      const a = agent(f, d.model)
      const permit =
        kind === 'absent'
          ? undefined
          : () => {
              if (kind === 'throwing') throw new Error('private permission failure')
              return false
            }

      try {
        expect((await run(a, permit)).outcome).equals('completed')
        expect(d.seen[0]).deep.equals([])
      } finally {
        await a.close()
        await f.b.close()
      }
    })

  it('does not persist attachment across runs and reads corrections and retirement afresh', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    try {
      await run(a, () => true)
      const revised = await memory.edit(f.project.id, f.entry.id, {
        body: 'Use amber for catalog status.',
        expectedRevision: f.entry.revision,
        operationId: randomUUID(),
        retired: false,
        title: 'Catalog status',
      })
      await run(a, () => true)
      expect(d.results.at(-1).results[0].body).contains('amber')
      await memory.edit(f.project.id, revised.id, {
        body: revised.body,
        expectedRevision: revised.revision,
        operationId: randomUUID(),
        retired: true,
        title: revised.title,
      })
      await run(a, () => true)
      expect(d.results.at(-1).results).deep.equals([])
      await run(a)
      expect(d.seen.at(-1)).deep.equals([])
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  for (const change of ['permission', 'model', 'provider', 'capability', 'membership'] as const)
    it(`fails closed when ${change} changes after declaration`, async () => {
      const f = await fixture()
      const d = driver()
      const a = agent(f, d.model)
      let allowed = true
      d.onRequest(async () => {
        if (change === 'permission') allowed = false
        if (change === 'model') d.setId('replacement')
        if (change === 'provider') d.setProvider('replacement')
        if (change === 'capability') d.setCapability('unsupported')
        if (change === 'membership') {
          const other = await projects.create({name: 'Other', operationId: randomUUID()})
          await memory.create(other.id, {body: 'Other catalog SECRET.', operationId: randomUUID(), title: 'Catalog'})
          const membership = (await projects.membership(f.b.getId()))!
          await projects.changeMembership(f.b.getId(), {
            expectedRevision: membership.revision,
            operationId: randomUUID(),
            projectId: other.id,
            sourceProjectId: f.project.id,
          })
        }
      })
      try {
        expect((await run(a, () => allowed)).outcome).not.equals('completed')
        expect(d.results).length(0)
        expect(f.b.getMessages().some((message) => /cobalt|SECRET/u.test(message.content))).equals(false)
      } finally {
        await a.close()
        await f.b.close()
      }
    })

  it('rejects an ambiguous explicit/automatic name but keeps legacy explicit registration compatible', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model, {
      toolDefinitions: [createProjectMemorySearchTool(memory, {projectId: f.project.id, sessionId: f.b.getId()})],
    })
    try {
      expect((await run(a, () => true)).outcome).not.equals('completed')
      expect((await run(a, () => false)).outcome).not.equals('completed')
      expect(d.seen).length(0)
      expect((await run(a)).outcome).equals('completed')
      expect(d.results).length(1)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('isolates Projects and refuses model scope injection', async () => {
    const f = await fixture()
    const other = await projects.create({name: 'Other', operationId: randomUUID()})
    await memory.create(other.id, {body: 'SECRET_OTHER catalog status.', operationId: randomUUID(), title: 'Catalog'})
    const d = driver()
    const a = agent(f, d.model)
    try {
      await run(a, () => true)
      expect(JSON.stringify(d.results)).not.contains('SECRET_OTHER')
      d.setInput({projectId: other.id, query: 'catalog'})
      await run(a, () => true)
      expect(d.results).length(1)
      expect(f.b.getMessages().at(-1)?.content).equals('Search was refused.')
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('omits search for an unassigned registered Session', async () => {
    const f = await fixture()
    await f.b.close()
    f.b = repository.create({formatVersion: 3})
    const d = driver()
    const a = agent(f, d.model)
    try {
      expect((await run(a, () => true)).outcome).equals('completed')
      expect(d.seen[0]).deep.equals([])
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('rejects a live Session from a different registered repository with the same ID', async () => {
    const f = await fixture()
    const id = f.b.getId()
    await f.b.close()
    const foreign = new SessionRepository({rootDir: path.join(root, 'foreign')})
    f.b = foreign.create({formatVersion: 3, id})
    const d = driver()
    const a = agent(f, d.model)
    try {
      expect((await run(a, () => true)).outcome).not.equals('completed')
      expect(d.seen).length(0)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('does not infer Apple named support from a provider label or text-only adapter', async () => {
    const f = await fixture()
    const d = driver()
    d.setProvider('apple')
    d.model.getCapabilities = async () => ({namedTools: [NAME], source: 'adapter', tools: 'unsupported'})
    const a = agent(f, d.model)
    try {
      expect((await run(a, () => true)).outcome).equals('completed')
      expect(d.seen[0]).deep.equals([])
      const old = new AppleFoundationModelsAgent('system', createProvider('apple'), {
        transport: {
          async request() {
            return {text: 'No search.', version: 1}
          },
        },
      })
      await a.close()
      await f.b.close()
      f.b = repository.open((await repository.findById(f.b.getId()))!.file)
      // A new Agent uses the actual text-only route rather than a provider-label simulation.
      const legacy = agent(f, old)
      try {
        expect((await run(legacy, () => true)).outcome).equals('completed')
      } finally {
        await legacy.close()
      }
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('uses the dedicated Apple named-only protocol with no generic defaults and real Core search', async () => {
    const f = await fixture()
    let nonce = ''
    let index = 0
    const fed: string[] = []
    const native = new AppleProjectMemoryAgent(createProvider('apple'), {
      channelFactory(initial) {
        expect(JSON.stringify(initial)).not.contains('cobalt')
        nonce = initial.nonce as string
        return {
          close() {},
          async next() {
            index++
            if (index === 1) return {nonce, tool: NAME, type: 'ready', version: 2}
            if (index === 2)
              return {
                id: 'native',
                input: {limit: 1, query: 'catalog status'},
                name: NAME,
                nonce,
                type: 'call',
                version: 2,
              }
            return {nonce, text: 'Saved choice retrieved.', type: 'final', version: 2}
          },
          send(frame) {
            fed.push(frame.text as string)
          },
        }
      },
    })
    const a = agent(f, native, {toolProfile: 'coding'})
    try {
      expect((await run(a, () => true)).outcome).equals('completed')
      expect(fed).length(1)
      expect(JSON.parse(fed[0]).results[0].id).equals(f.entry.id)
    } finally {
      native.close()
      await a.close()
      await f.b.close()
    }
  })

  it('closes a paused native generation if permission is revoked after its tool call', async () => {
    const f = await fixture()
    let allowed = true
    let closed = false
    let index = 0
    let nonce = ''
    const native = new AppleProjectMemoryAgent(createProvider('apple'), {
      channelFactory(initial) {
        nonce = initial.nonce as string
        return {
          close() {
            closed = true
          },
          async next() {
            index++
            if (index === 1) return {nonce, tool: NAME, type: 'ready', version: 2}
            allowed = false
            return {id: 'paused', input: {limit: 1, query: 'catalog'}, name: NAME, nonce, type: 'call', version: 2}
          },
          send() {
            expect.fail('No result may be fed after revocation')
          },
        }
      },
    })
    const a = agent(f, native)
    try {
      expect((await run(a, () => allowed)).outcome).not.equals('completed')
      expect(closed).equals(true)
    } finally {
      native.close()
      await a.close()
      await f.b.close()
    }
  })

  it('provides immutable Core-derived scope to the host permission decision', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    try {
      await run(a, (scope) => {
        expect(Object.isFrozen(scope)).equals(true)
        expect(scope).deep.equals({projectId: f.project.id, sessionId: f.b.getId()})
        return false
      })
      expect(d.seen[0]).deep.equals([])
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('does not let a host attachment grant bypass the ordinary execution policy', async () => {
    const f = await fixture()
    const d = driver()
    let denied = false
    const a = agent(f, d.model, {
      execution: {
        policy: {
          decide(operation) {
            if (operation.name === NAME) {
              denied = true
              return 'deny'
            }

            return 'allow'
          },
          generation: 'synthetic-denial',
          profile: 'workspace-confirm',
          roots: [root],
        },
      },
    })
    try {
      await run(a, () => true)
      expect(denied).equals(true)
      expect(d.results).length(0)
      expect(f.b.getMessages().at(-1)?.content).equals('Search was refused.')
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('rechecks permission immediately before sending a prepared model request', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    let allowed = true
    try {
      const handle = await a.startRun([new Message(MessageType.User, {content: 'Recall catalog.'})], {
        memorySearch: () => allowed,
        onEvent(event) {
          if (event.type === 'model-started') allowed = false
        },
      })
      expect((await handle.finished).outcome).not.equals('completed')
      expect(d.seen).length(0)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('discards search output if permission is revoked while retrieval completes', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    let allowed = true
    const search = memory.search.bind(memory)
    memory.search = async (...args) => {
      const result = await search(...args)
      allowed = false
      return result
    }

    try {
      expect((await run(a, () => allowed)).outcome).not.equals('completed')
      expect(d.results).length(0)
      expect(f.b.getMessages().some((message) => message.content.includes('cobalt'))).equals(false)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('recomputes capabilities after activating a different model between runs', async () => {
    const f = await fixture()
    const d = driver()
    const after: Model = {
      async getCapabilities() {
        return {source: 'adapter', tools: 'unsupported'}
      },
      getModel: () => 'after',
      getName: () => 'after',
      getProvider: () => 'openai',
      async invoke(_messages, options) {
        expect(options?.tools ?? []).deep.equals([])
        return new Message(MessageType.Assistant, {content: 'No search.'})
      },
    }
    const a = agent(f, d.model, {deps: {createModel: (_provider, name) => (name === 'after' ? after : d.model)}})
    try {
      await run(a, () => true)
      const activate = await a.prepareModelSelection({model: 'after', provider: 'openai'})
      activate()
      a.activateModelSelection()
      expect((await run(a, () => true)).outcome).equals('completed')
      expect(d.results).length(1)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('refuses an archived Project', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    try {
      await projects.update(f.project.id, {
        archived: true,
        expectedRevision: f.project.revision,
        operationId: randomUUID(),
      })
      expect((await run(a, () => true)).outcome).not.equals('completed')
      expect(d.seen).length(0)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('requires the configured trusted service and rejects JSON-like permission values', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model, {projectMemory: undefined})
    try {
      expect((await run(a, () => true)).outcome).not.equals('completed')
      expect(d.seen).length(0)
      let rejected = false
      try {
        await a.startRun([new Message(MessageType.User, {content: 'Recall.'})], {
          memorySearch: true as unknown as AgentInvokeOptions['memorySearch'],
        })
      } catch {
        rejected = true
      }

      expect(rejected).equals(true)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('rejects request ID reuse with a different host permission identity', async () => {
    const f = await fixture()
    const d = driver()
    const a = agent(f, d.model)
    const requestId = randomUUID()
    try {
      await run(a, () => true, requestId)
      let rejected = false
      try {
        await run(a, () => false, requestId)
      } catch {
        rejected = true
      }

      expect(rejected).equals(true)
    } finally {
      await a.close()
      await f.b.close()
    }
  })

  it('passes only the host callback through the ordinary Core Application and Thread path', async () => {
    const f = await fixture()
    await f.b.close()
    const d = driver()
    const app = new OrbitApplicationService({
      contexts: [],
      createAgent: (options) => new Agent({...options, deps: {createModel: () => d.model}, toolProfile: 'none'}),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      projectStore: store,
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    })
    try {
      const thread = await app.createProjectThread(f.project.id, {operationId: randomUUID()})
      const done = new Promise<string>((resolve) => {
        const unsubscribe = app.subscribe((event) => {
          if (event.type === 'run.completed' || event.type === 'run.failed') {
            unsubscribe()
            resolve(event.type)
          }
        })
      })
      const requestId = randomUUID()
      await app.startRun(thread.id, 'What was the catalog status choice?', {memorySearch: () => true, requestId})
      expect(await done).equals('run.completed')
      expect(d.results[0].results[0].id).equals(f.entry.id)
      let conflict = false
      try {
        await app.startRun(thread.id, 'What was the catalog status choice?', {memorySearch: () => false, requestId})
      } catch {
        conflict = true
      }

      expect(conflict).equals(true)
    } finally {
      await app.close()
    }
  })
})
