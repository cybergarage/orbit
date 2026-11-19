// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Agent,
  createProjectMemorySearchTool,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  ProjectMemoryService,
  ProjectService,
  State,
} from '../../../src/core/index.js'
import {getToolResult} from '../../../src/core/models/adapters/tools.js'
import {normalizeToolResult, toolResultText} from '../../../src/core/tools/definition.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Opt-in Project memory search', () => {
  let root: string
  let repository: SessionRepository
  let store: MemoryProjectStore
  let projects: ProjectService
  let memory: ProjectMemoryService

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-search-'))
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

  async function fixture(value = 'PostgreSQL') {
    const project = await projects.create({name: 'Synthetic', operationId: randomUUID()})
    const a = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
    const [message] = a.appendMessages([new Message(MessageType.User, {content: `Use ${value} for catalog storage.`})])
    await a.synchronize('file-sync')
    const file = a.getFile()!
    const sourceId = a.getId()
    await a.close()
    const entry = await memory.saveExcerpt(project.id, {
      excerpt: message.content,
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: sourceId,
      title: 'Catalog storage',
    })
    const b = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
    const sessionId = b.getId()
    await b.close()
    return {entry, file, message, project, sessionId, sourceId}
  }

  it('exports the opt-in factory through the package entry point', async () => {
    const api = await import('../../../src/index.js')
    expect(api.createProjectMemorySearchTool).equals(createProjectMemorySearchTool)
  })

  it('dispatches a real tool round in separate Session B without pre-injecting Session A or its answer', async () => {
    const f = await fixture()
    let calls = 0
    const b = repository.open((await repository.findById(f.sessionId))!.file)
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'deterministic-fixture',
          getName: () => 'fixture',
          getProvider: () => 'openai',
          async invoke(messages, options) {
            calls++
            if (calls === 1) {
              expect(JSON.stringify(messages)).not.contains('PostgreSQL')
              expect(JSON.stringify(messages)).not.contains(f.sourceId)
              expect(options?.tools?.map((t) => t.name)).deep.equals(['project_memory_search'])
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: [{id: 'recall', input: {query: 'catalog storage'}, name: 'project_memory_search'}],
                },
              })
            }

            const result = messages.map((message) => getToolResult(message)).find(Boolean)!
            expect(result.isError).not.equals(true)
            const data = JSON.parse(toolResultText(normalizeToolResult(result.output)))
            expect(data.results[0].id).equals(f.entry.id)
            expect(data.results[0].sources[0].sessionId).equals(f.sourceId)
            expect(data.results[0].sources[0].messageId).equals(f.message.id)
            return new Message(MessageType.Assistant, {content: `${data.results[0].body} [${data.results[0].id}]`})
          },
        }),
      },
      logStore: new MemorySessionLogStore(),
      state: new State(b),
      toolDefinitions: [createProjectMemorySearchTool(memory, {projectId: f.project.id, sessionId: f.sessionId})],
      toolProfile: 'none',
    })
    try {
      const run = await agent.startRun(
        [new Message(MessageType.User, {content: 'Which database did we choose for catalog storage?'})],
        {requestId: randomUUID()},
      )
      const result = await run.finished
      expect(result.outcome).equals('completed')
      expect(calls).equals(2)
      expect(b.getMessages().at(-1)?.content).contains('PostgreSQL').and.contains(f.entry.id)
    } finally {
      await agent.close()
      await b.close()
    }
  })

  it('leaves the tool disabled unless explicitly registered', async () => {
    const f = await fixture()
    const b = repository.open((await repository.findById(f.sessionId))!.file)
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'fixture',
          getProvider: () => 'openai',
          async invoke(messages, options) {
            expect(options?.tools ?? []).length(0)
            expect(JSON.stringify(messages)).not.contains('PostgreSQL')
            return new Message(MessageType.Assistant, {content: 'Insufficient evidence.'})
          },
        }),
      },
      logStore: new MemorySessionLogStore(),
      state: new State(b),
      toolProfile: 'none',
    })
    try {
      const run = await agent.startRun([new Message(MessageType.User, {content: 'Which database did we choose?'})], {
        requestId: randomUUID(),
      })
      expect((await run.finished).outcome).equals('completed')
    } finally {
      await agent.close()
      await b.close()
    }
  })

  it('isolates identical keys in different Projects and rejects model-supplied scope', async () => {
    const a = await fixture('PostgreSQL')
    const b = await fixture('SQLite')
    expect((await memory.search(a.sessionId, a.project.id, {query: 'catalog'})).results.map((r) => r.id)).deep.equals([
      a.entry.id,
    ])
    expect((await memory.search(b.sessionId, b.project.id, {query: 'catalog'})).results.map((r) => r.id)).deep.equals([
      b.entry.id,
    ])
    const tool = createProjectMemorySearchTool(memory, {projectId: a.project.id, sessionId: a.sessionId})
    expect(() => tool.input.parse({projectId: b.project.id, query: 'catalog'})).throws()
    try {
      await memory.search(a.sessionId, b.project.id, {query: 'catalog'})
      expect.fail('Expected refusal')
    } catch (error) {
      expect(String(error)).contains('outside')
    }
  })

  it('re-reads corrections and tombstones, suppresses unrelated and deleted-source memories', async () => {
    const f = await fixture()
    expect((await memory.search(f.sessionId, f.project.id, {query: 'unfindable'})).results).length(0)
    await memory.edit(f.project.id, f.entry.id, {
      body: 'Use SQLite for catalog storage.',
      expectedRevision: f.entry.revision,
      operationId: randomUUID(),
      retired: false,
      title: f.entry.title,
    })
    const corrected = (await memory.search(f.sessionId, f.project.id, {query: 'catalog'})).results[0]
    expect(corrected.body).contains('SQLite').and.not.contains('PostgreSQL')
    await memory.edit(f.project.id, f.entry.id, {
      body: corrected.body,
      expectedRevision: corrected.revision,
      operationId: randomUUID(),
      retired: true,
      title: corrected.title,
    })
    expect((await memory.search(f.sessionId, f.project.id, {query: 'catalog'})).results).length(0)
    const other = await fixture()
    await fs.unlink(other.file)
    expect((await memory.search(other.sessionId, other.project.id, {query: 'catalog'})).results).length(0)
  })

  it('accepts registered non-UUID Session IDs while keeping Project scope fixed', async () => {
    const project = await projects.create({name: 'Legacy ID', operationId: randomUUID()})
    const session = repository.create({id: 'registered-legacy-session'})
    const sessionId = session.getId()
    await session.synchronize('file-sync')
    await session.close()
    await projects.changeMembership(sessionId, {
      expectedRevision: 0,
      operationId: randomUUID(),
      projectId: project.id,
      sourceProjectId: null,
    })
    await memory.create(project.id, {
      body: 'Use SQLite for catalog storage.',
      operationId: randomUUID(),
      title: 'Storage',
    })
    const tool = createProjectMemorySearchTool(memory, {projectId: project.id, sessionId})
    const result = await tool.execute(
      {query: 'catalog'},
      {callId: 'legacy', cwd: root, emitUpdate() {}, signal: new AbortController().signal},
    )
    expect(JSON.parse(toolResultText(result)).results).length(1)
  })

  it('performs no catalog mutation and refuses a stale host binding after membership changes', async () => {
    const f = await fixture()
    const sourceBefore = await fs.readFile(f.file, 'utf8')
    const mutate = store.mutate.bind(store)
    let writes = 0
    store.mutate = async (id, operation) => {
      writes++
      return mutate(id, operation)
    }

    const result = await memory.search(f.sessionId, f.project.id, {query: 'catalog'})
    expect(result.results[0].id).equals(f.entry.id)
    expect(writes).equals(0)
    expect(await fs.readFile(f.file, 'utf8')).equals(sourceBefore)
    const membership = (await projects.membership(f.sessionId))!
    await projects.changeMembership(f.sessionId, {
      expectedRevision: membership.revision,
      operationId: randomUUID(),
      projectId: null,
      sourceProjectId: f.project.id,
    })
    try {
      await memory.search(f.sessionId, f.project.id, {query: 'catalog'})
      expect.fail('Expected stale binding refusal')
    } catch (error) {
      expect(String(error)).contains('outside')
    }
  })

  it('refuses a membership switch before preparing any memory from the replacement Project', async () => {
    const a = await fixture('PostgreSQL')
    const b = await fixture('SQLite')
    const requireActive = projects.requireActive.bind(projects)
    let calls = 0
    projects.requireActive = async (sessionId) => {
      const membership = await requireActive(sessionId)
      if (++calls === 1)
        await projects.changeMembership(a.sessionId, {
          expectedRevision: membership!.revision,
          operationId: randomUUID(),
          projectId: b.project.id,
          sourceProjectId: a.project.id,
        })
      return membership
    }

    try {
      await memory.search(a.sessionId, a.project.id, {query: 'catalog'})
      expect.fail('Expected scope refusal')
    } catch (error) {
      expect(String(error)).contains('outside the bound Project')
    }

    expect(calls).equals(2)
  })

  it('skips oversized results and enforces the serialized output budget and result limit', async () => {
    const f = await fixture()
    for (let index = 0; index < 10; index++) {
      // eslint-disable-next-line no-await-in-loop -- Populate the canonical store in a stable order.
      await memory.create(f.project.id, {
        body: `Catalog storage detail ${index}.`,
        operationId: randomUUID(),
        title: 'Catalog',
      })
    }

    const oversized = await memory.create(f.project.id, {
      body: `${randomUUID()} `.repeat(200),
      operationId: randomUUID(),
      title: 'Catalog',
    })
    const result = await memory.search(f.sessionId, f.project.id, {limit: 2, query: 'catalog'})
    expect(result.results.map((entry) => entry.id)).not.includes(oversized.id)
    expect(result.results).length(2)
    expect(result.truncated).equals(true)
    const {GptTokenizer} = await import('../../../src/core/tokenizer/index.js')
    expect(new GptTokenizer().encode(JSON.stringify(result)).length).at.most(2048)
  })

  it('bounds inputs and output, supports Japanese matches and respects cancellation', async () => {
    const f = await fixture()
    await memory.create(f.project.id, {body: '日本語の検索を確認する。', operationId: randomUUID(), title: '日本語'})
    expect((await memory.search(f.sessionId, f.project.id, {query: '日本語'})).results).length(1)
    for (const input of [{query: ''}, {query: 'x'.repeat(513)}, {limit: 17, query: 'catalog'}]) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Exercise invalid inputs separately.
        await memory.search(f.sessionId, f.project.id, input)
        expect.fail('Expected refusal')
      } catch (error) {
        expect(String(error)).contains('Search')
      }
    }

    const controller = new AbortController()
    controller.abort()
    try {
      await memory.search(f.sessionId, f.project.id, {query: 'catalog'}, controller.signal)
      expect.fail('Expected cancellation')
    } catch (error) {
      expect(String(error)).contains('Abort')
    }
  })
})
