// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {inspectExecutionJournal} from '../../../src/core/execution/recovery.js'
import {
  Agent,
  compileProcessorGraph,
  inspectGraphRun,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  parseProjectContext,
  ProjectMemoryService,
  ProjectService,
  selectProjectMemory,
  State,
} from '../../../src/core/index.js'
import {freezeModelRequest} from '../../../src/core/models/prepared.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Curated Project memory', () => {
  let root: string
  let repository: SessionRepository
  let store: MemoryProjectStore
  let projects: ProjectService
  let memory: ProjectMemoryService

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-memory-test-'))
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

  it('uses whole-entry budgets and preserves exact captures across later edits', async () => {
    const project = await projects.create({name: 'A', operationId: randomUUID()})
    const session = await projects.createSession(project.id, randomUUID(), async () => ({}))
    const sessionId = session.getId()
    await session.close()
    const small = await memory.create(project.id, {
      body: 'Run tests in temporary directories.',
      operationId: randomUUID(),
      title: 'Testing',
    })
    const large = await memory.create(project.id, {
      body: 'This is a deliberately long memory body. '.repeat(180),
      operationId: randomUUID(),
      title: 'Large',
    })
    const catalog = await store.query({
      kind: 'snapshot',
      pairId: repository.scope(sessionId).pairId,
      projectId: project.id,
      sessionId,
    })
    const options = {captureId: randomUUID(), execution: 'agent' as const, selectedIds: [small.id], tokenBudget: 200}
    const selected = selectProjectMemory(catalog, options)
    expect(selected.entries.map((entry) => entry.id)).deep.equals([small.id])
    expect(selected.exclusions).deep.includes({id: large.id, reason: 'token-budget'})
    expect(selectProjectMemory({...catalog, entries: [...catalog.entries].reverse()}, options)).deep.equals(selected)
    expect(() => selectProjectMemory(catalog, {...options, selectedIds: [large.id]})).throws(
      'Selected memory cannot be used',
    )
    expect(() => parseProjectContext({...selected, rendered: 'Changed'})).throws('mismatch')
    const requestId = randomUUID()
    const captured = await memory.prepare(sessionId, requestId, {mode: 'curated', selectedIds: [small.id]})
    await memory.edit(project.id, small.id, {
      body: 'Edited for future runs.',
      expectedRevision: 1,
      operationId: randomUUID(),
      retired: false,
      title: small.title,
    })
    expect(captured.entries.find((entry) => entry.id === small.id)?.body).equals(small.body)
    try {
      await memory.prepare(sessionId, requestId, {mode: 'curated', selectedIds: [small.id]})
      throw new Error('Expected conflicting capture')
    } catch (error) {
      expect(String(error)).contains('changed')
    }
  })

  it('validates excerpts, retains provenance after editing, and excludes changed or deleted sources', async () => {
    const project = await projects.create({name: 'A', operationId: randomUUID()})
    const source = await projects.createSession(project.id, randomUUID(), async () => ({}))
    const [message] = source.appendMessages([
      new Message(MessageType.Assistant, {content: 'The supported color is blue.'}),
    ])
    const sourceId = source.getId()
    const file = source.getFile()!
    await source.synchronize('file-sync')
    await source.close()
    const destination = await projects.createSession(project.id, randomUUID(), async () => ({}))
    const destinationId = destination.getId()
    await destination.close()
    const saved = await memory.saveExcerpt(project.id, {
      excerpt: 'supported color is blue',
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: sourceId,
      title: 'Color',
    })
    const edited = await memory.edit(project.id, saved.id, {
      body: 'Prefer blue.',
      expectedRevision: 1,
      operationId: randomUUID(),
      retired: false,
      title: 'Color',
    })
    expect(edited.sources).deep.equals(saved.sources)
    expect(edited.edited).equals(true)
    expect((await memory.prepare(destinationId, randomUUID(), {mode: 'curated'})).entries).length(1)
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replace('supported color is blue', 'supported color is gold'),
    )
    const changed = await memory.prepare(destinationId, randomUUID(), {mode: 'curated'})
    expect(changed.entries).length(0)
    expect(changed.exclusions).deep.includes({id: saved.id, reason: 'source-changed'})
    await fs.unlink(file)
    const deleted = await memory.prepare(destinationId, randomUUID(), {mode: 'curated'})
    expect(deleted.exclusions).deep.includes({id: saved.id, reason: 'source-unavailable'})
    try {
      await memory.saveExcerpt(project.id, {
        excerpt: 'Invented',
        messageId: message.id,
        operationId: randomUUID(),
        sessionId: sourceId,
        title: 'Invalid',
      })
      throw new Error('Expected excerpt failure')
    } catch (error) {
      expect(String(error)).contains('Excerpt is not present')
    }
  })

  it('keeps one prefix per tool iteration and Graph stage with mixed journal versions', async () => {
    const project = await projects.create({name: 'Graph', operationId: randomUUID()})
    const session = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 2}))
    await memory.create(project.id, {body: 'MEMORY_SENTINEL', operationId: randomUUID(), title: 'Fixture'})
    const requests: Message[][] = []
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'fixture',
          getProvider: () => 'openai',
          async invoke(messages) {
            requests.push(messages)
            return requests.length === 1
              ? new Message(MessageType.Assistant, {
                  payload: {toolCalls: [{id: 'unknown-call', input: {}, name: 'unavailable'}]},
                })
              : new Message(MessageType.Assistant, {content: 'Done'})
          },
        }),
      },
      logStore: new MemorySessionLogStore(),
      projectMemory: memory,
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const first = await agent.startRun([new Message(MessageType.User, {content: 'Inspect'})], {
        memory: {mode: 'curated'},
        requestId: randomUUID(),
      })
      expect((await first.finished).outcome).equals('completed')
      expect(requests).length(2)
      const graph = await compileProcessorGraph(
        {
          edges: [
            {from: 'first', id: 'next', to: 'second'},
            {from: 'second', id: 'finish', to: 'done'},
          ],
          entry: 'first',
          id: 'memory-graph',
          nodes: [
            {adapter: 'agent', id: 'first'},
            {adapter: 'agent', id: 'second'},
          ],
          terminals: [{id: 'done', outcome: 'completed'}],
        },
        [{id: 'agent', inputSchema: {}, kind: 'agent', outputSchema: {}, version: '1'}],
      )
      const run = await agent.startGraphRun(graph, 'Inspect both stages', {
        memory: {mode: 'curated'},
        requestId: randomUUID(),
      })
      expect((await run.finished).outcome).equals('completed')
      expect(requests).length(4)
      for (const messages of requests) {
        const prefix = messages.filter((message) => message.content.includes('MEMORY_SENTINEL'))
        expect(prefix).length(1)
        expect(prefix[0].type).equals(MessageType.User)
      }

      const inspection = await inspectExecutionJournal(repository.journalRoot, session.getId())
      const graphRun = inspection.runs.find((entry) => entry.runId === run.id)!
      expect(graphRun.issue).to.be.undefined
      expect(inspectGraphRun(graphRun.records).snapshot?.visits).equals(2)
      const off = await agent.startRun([new Message(MessageType.User, {content: 'Without memory'})], {
        memory: {mode: 'off'},
        requestId: randomUUID(),
      })
      await off.finished
      expect(requests.at(-1)!.some((message) => message.content.includes('MEMORY_SENTINEL'))).equals(false)
    } finally {
      await agent.close()
      await session.close()
    }
  })

  it('keeps memory outside compaction sources while binding it to the prepared request', async () => {
    const project = await projects.create({name: 'Budgeted', operationId: randomUUID()})
    const session = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
    const [old] = session.appendMessages([
      new Message(MessageType.User, {content: 'Old topic ' + 'x'.repeat(8000)}),
      new Message(MessageType.Assistant, {content: 'Old reply'}),
    ])
    await memory.create(project.id, {body: 'MEMORY_COMPACTION_SENTINEL', operationId: randomUUID(), title: 'Fixture'})
    const captured: string[][] = []
    const profile = {
      model: 'fixture',
      outputReserve: 1000,
      provider: 'openai',
      revision: 'fixture',
      safetyMargin: 100,
      summaryOutput: 1000,
      target: 2500,
      templateOverhead: 0,
      trigger: 3000,
      window: 30_000,
    }
    const agent = new Agent({
      contextPolicy: {
        estimator: (request) => ({
          components: {json: JSON.stringify(request).length},
          kind: 'estimated',
          model: 'fixture',
          provider: 'openai',
          revision: 'chars',
          tokens: JSON.stringify(request).length,
        }),
        mode: 'budgeted',
        profile,
      },
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'fixture',
          getProvider: () => 'openai',
          async invoke() {
            throw new Error('Prepared request required')
          },
          prepare(messages) {
            const request = freezeModelRequest({messages: messages.map((message) => message.content)})
            return {
              async invoke() {
                captured.push(request.messages as string[])
                return new Message(MessageType.Assistant, {
                  content: String(request.messages[0]).startsWith('Summarize')
                    ? JSON.stringify({
                        changedPaths: [],
                        facts: [],
                        goals: [{sourceIds: [old.id], text: 'Continue old topic'}],
                        tests: [],
                        uncertainties: [],
                        unfinished: [],
                        version: 1,
                      })
                    : 'Done',
                })
              },
              request,
            }
          },
        }),
      },
      logStore: new MemorySessionLogStore(),
      projectMemory: memory,
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const run = await agent.startRun([new Message(MessageType.User, {content: 'Continue'})], {
        memory: {mode: 'curated'},
        requestId: randomUUID(),
      })
      const result = await run.finished
      expect(result.outcome, JSON.stringify({entries: session.getEntries().filter((entry) => entry.type === 'turn_event'), result})).equals('completed')
      expect(captured).length(2)
      expect(captured[0].join('')).not.contains('MEMORY_COMPACTION_SENTINEL')
      expect(captured[1].filter((text) => text.includes('MEMORY_COMPACTION_SENTINEL'))).length(1)
      expect(JSON.stringify(session.getEntries())).not.contains('MEMORY_COMPACTION_SENTINEL')
      expect(session.getEntries().some((entry) => entry.type === 'compaction')).equals(true)
    } finally {
      await agent.close()
      await session.close()
    }
  })

  it('keeps Project memory fixed within a managed Run, records it once, and never adds it to the transcript', async () => {
    const requests: string[][] = []
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: (options) =>
        new Agent({
          ...options,
          deps: {
            createModel: () => ({
              getModel: () => 'fixture',
              getName: () => 'fixture',
              getProvider: () => 'openai',
              async invoke(messages) {
                requests.push(messages.map((message) => message.content))
                entered()
                await gate
                return new Message(MessageType.Assistant, {content: 'Acknowledged.'})
              },
            }),
          },
          toolProfile: 'none',
        }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'fixture',
      projectStore: store,
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    })
    try {
      const a = await service.projects!.create({name: 'A', operationId: randomUUID()})
      const b = await service.projects!.create({name: 'B', operationId: randomUUID()})
      const at = await service.createProjectThread(a.id, {operationId: randomUUID()})
      const bt = await service.createProjectThread(b.id, {operationId: randomUUID()})
      const entry = await service.projectMemory!.create(a.id, {
        body: 'Only Project A knows cobalt.',
        operationId: randomUUID(),
        title: 'Fact',
      })
      const finished = new Promise<void>((resolve) => {
        const off = service.subscribe((event) => {
          if (event.type === 'run.completed' && event.threadId === at.id) {
            off()
            resolve()
          }
        })
      })
      const requestId = randomUUID()
      await service.startRun(at.id, 'Use current context.', {memory: {mode: 'curated'}, requestId})
      await started
      await service.projectMemory!.edit(a.id, entry.id, {
        body: 'The next run uses amber.',
        expectedRevision: 1,
        operationId: randomUUID(),
        retired: false,
        title: entry.title,
      })
      release()
      await finished
      expect(requests[0].join('\n')).contains('cobalt').not.contains('amber')
      const history = await service.projectContextHistory(at.id)
      expect(history[0].snapshots).length(1)
      expect(history[0].snapshots[0].rendered).contains('cobalt')
      expect(await fs.readFile(at.file!, 'utf8'))
        .not.contains('cobalt')
        .not.contains('Untrusted Project memory')
      await service.startRun(at.id, 'Use current context.', {memory: {mode: 'curated'}, requestId})
      expect(requests).length(1)
      const bFinished = new Promise<void>((resolve) => {
        const off = service.subscribe((event) => {
          if (event.type === 'run.completed' && event.threadId === bt.id) {
            off()
            resolve()
          }
        })
      })
      await service.startRun(bt.id, 'Other project.', {memory: {mode: 'curated'}, requestId: randomUUID()})
      await bFinished
      expect(requests[1].join('\n')).not.contains('cobalt').not.contains('amber')
    } finally {
      release()
      await service.close()
    }
  })
})

