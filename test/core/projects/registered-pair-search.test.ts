// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Model, ProjectSearchBinding, Session} from '../../../src/core/index.js'

import {
  Agent,
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

describe('Trusted registered-pair Project memory search', () => {
  let root: string
  let first: SessionRepository
  let second: SessionRepository
  let store: MemoryProjectStore
  let firstService: ProjectService
  let secondService: ProjectService
  let memory: ProjectMemoryService
  let homes: Map<string, SessionRepository>
  let closeCalls: string[]
  const active: Session[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-registered-pair-search-'))
    first = new SessionRepository({rootDir: path.join(root, 'first')})
    second = new SessionRepository({rootDir: path.join(root, 'second')})
    store = new MemoryProjectStore()
    homes = new Map()
    closeCalls = []
    const host = {
      async closeThread(id: string) {
        closeCalls.push(id)
      },
      getThread(): undefined {},
    }
    firstService = new ProjectService(store, first, host, root)
    secondService = new ProjectService(store, second, host, root)
    memory = new ProjectMemoryService(firstService, host, {resolveSearchRepository: (id) => homes.get(id)})
  })

  afterEach(async () => {
    await Promise.all(active.splice(0).map((session) => session.close()))
    await memory.close()
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  async function fixture() {
    const from = await firstService.create({name: 'Former', operationId: randomUUID()})
    const to = await secondService.create({name: 'Current', operationId: randomUUID()})
    const add = async (service: ProjectService, projectId: string, body: string) => {
      const source = await service.createSession(projectId, randomUUID(), async () => ({formatVersion: 3}))
      const [message] = source.appendMessages([new Message(MessageType.User, {content: body})])
      await source.synchronize('file-sync')
      const id = source.getId()
      const file = source.getFile()!
      await source.close()
      const lexical = new ProjectMemoryService(service, {async closeThread() {}, getThread(): undefined {}})
      const entry = await lexical.saveExcerpt(projectId, {
        excerpt: body,
        messageId: message.id,
        operationId: randomUUID(),
        sessionId: id,
        title: 'Catalog',
      })
      homes.set(id, service.repository)
      return {entry, file, id, message}
    }

    const moved = await add(firstService, from.id, 'Former project catalog decision: amber.')
    const native = await add(secondService, to.id, 'Current project catalog decision: cobalt.')
    const member = await firstService.changeMembership(moved.id, {
      expectedRevision: 1,
      operationId: randomUUID(),
      projectId: to.id,
      sourceProjectId: from.id,
    })
    closeCalls = []
    const requester = first.open(moved.file)
    active.push(requester)
    expect(member.pairId).not.equals(second.scope(native.id).pairId)
    return {from, member, moved, native, requester, to}
  }

  async function bound<T>(requester: Session, work: (binding: ProjectSearchBinding) => Promise<T>): Promise<T> {
    const release = requester.acquireWriterLease()
    try {
      const binding = await memory.resolveSearchBinding(requester)
      if (!binding) throw new Error('Expected a bound Project Session')
      return await work(binding)
    } finally {
      release()
    }
  }

  it('dispatches actual Core search from a moved Session against the destination native pair, not former Project memory', async () => {
    const f = await fixture()
    let invokes = 0
    const model: Model = {
      getModel: () => 'synthetic',
      getName: () => 'synthetic',
      getProvider: () => 'openai',
      async invoke(messages, options) {
        invokes++
        expect(options?.tools?.map(({name}) => name)).deep.equals(['project_memory_search'])
        if (invokes === 1) {
          expect(JSON.stringify(messages)).not.contains('cobalt')
          return new Message(MessageType.Assistant, {
            payload: {toolCalls: [{id: 'search', input: {query: 'catalog decision'}, name: 'project_memory_search'}]},
          })
        }

        const result = getToolResult(messages.at(-1)!)!
        expect(result.isError).not.equals(true)
        const retrieved = JSON.parse(toolResultText(normalizeToolResult(result.output)))
        expect(retrieved.projectId).equals(f.to.id)
        expect(retrieved.results.map((entry: {id: string}) => entry.id)).deep.equals([f.native.entry.id])
        expect(retrieved.results[0].sources[0]).deep.equals(f.native.entry.sources[0])
        expect(JSON.stringify(retrieved)).not.contains('amber')
        return new Message(MessageType.Assistant, {content: 'Found destination evidence.'})
      },
    }
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => model},
      logStore: new MemorySessionLogStore(),
      projectMemory: memory,
      state: new State(f.requester),
      toolProfile: 'none',
    })
    try {
      const handle = await agent.startRun(
        [new Message(MessageType.User, {content: 'What was the current catalog decision?'})],
        {
          memorySearch(scope) {
            expect(scope).deep.equals({projectId: f.to.id, sessionId: f.moved.id})
            return true
          },
          requestId: randomUUID(),
        },
      )
      expect((await handle.finished).outcome).equals('completed')
      expect(invokes).equals(2)
      expect(closeCalls).deep.equals([])
      expect((await store.query({id: f.moved.entry.id, kind: 'memory'}))?.retired).equals(true)
    } finally {
      await agent.close()
    }
  })

  it('never falls back for a missing source mapping or accepts a different registered pair', async () => {
    const f = await fixture()
    const local = new ProjectMemoryService(firstService, {async closeThread() {}, getThread(): undefined {}})
    // Save a new, explicitly selected current-Project excerpt in the moved Session's original pair.
    await f.requester.close()
    const localId = randomUUID()
    const source = await firstService.createSession(f.to.id, localId, async () => ({formatVersion: 3}))
    const [message] = source.appendMessages([new Message(MessageType.User, {content: 'Catalog local detail.'})])
    await source.synchronize('file-sync')
    await source.close()
    const entry = await local.saveExcerpt(f.to.id, {
      excerpt: message.content,
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: localId,
      title: 'Catalog',
    })
    const reopened = first.open(f.moved.file)
    active.push(reopened)
    homes.set(f.native.id, first)
    await bound(reopened, async (binding) => {
      expect((await memory.searchLeasedSession(reopened, binding, {query: 'catalog'})).results).deep.equals([])
      homes.set(localId, first)
      const result = await memory.searchLeasedSession(reopened, binding, {query: 'catalog'})
      expect(result.results.map(({id}) => id)).deep.equals([entry.id])
    })
  })

  it('finds newly curated destination memory from the moved original pair and uses the requester lease for itself', async () => {
    const f = await fixture()
    const [message] = f.requester.appendMessages([
      new Message(MessageType.User, {content: 'Catalog destination note.'}),
    ])
    await f.requester.synchronize('file-sync')
    await f.requester.close()
    const local = new ProjectMemoryService(firstService, {async closeThread() {}, getThread(): undefined {}})
    const curated = await local.saveExcerpt(f.to.id, {
      excerpt: message.content,
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: f.moved.id,
      title: 'Destination note',
    })
    const destination = second.open(f.native.file)
    active.push(destination)
    await bound(destination, async (binding) => {
      expect(binding.pairId).equals(second.scope(f.native.id).pairId)
      const result = await memory.searchLeasedSession(destination, binding, {query: 'catalog'})
      expect(result.results.map(({id}) => id)).to.have.members([curated.id, f.native.entry.id])
    })
    expect(closeCalls).deep.equals([])
  })

  it('rejects requester registration mismatch and missing lease', async () => {
    const f = await fixture()
    await rejects(() => memory.resolveSearchBinding(f.requester), 'live lease')
    const release = f.requester.acquireWriterLease()
    try {
      homes.set(f.moved.id, second)
      await rejects(() => memory.resolveSearchBinding(f.requester), 'live lease')
      homes.delete(f.moved.id)
      await rejects(() => memory.resolveSearchBinding(f.requester), 'live lease')
    } finally {
      release()
    }
  })

  it('does not displace an existing peer writer and releases its own successful peer claim', async () => {
    const f = await fixture()
    const peer = second.open(f.native.file)
    active.push(peer)
    await bound(f.requester, async (binding) => {
      const search = () => memory.searchLeasedSession(f.requester, binding, {query: 'catalog'})
      await rejects(search, 'already open for writing')
      expect(closeCalls).deep.equals([])
      await peer.close()
      expect((await search()).results).length(1)
      const reacquired = second.open(f.native.file)
      await reacquired.close()
    })
  })

  it('excludes archived, deleted or digest-mismatched provenance on the original pair', async () => {
    const f = await fixture()
    const id = randomUUID()
    const {body, sources, title} = f.native.entry
    await store.mutate(id, {
      entry: {
        body,
        edited: false,
        id,
        projectId: f.to.id,
        retired: false,
        sources: [{...sources[0], digest: '0'.repeat(64)}],
        title,
      },
      expectedRevision: 0,
      kind: 'memory',
    })
    await bound(f.requester, async (binding) => {
      const search = () => memory.searchLeasedSession(f.requester, binding, {query: 'catalog'})
      expect((await search()).results.map((result) => result.id)).deep.equals([f.native.entry.id])
      await second.setArchived(f.native.id, true)
      expect((await search()).results).deep.equals([])
      await second.setArchived(f.native.id, false)
      await fs.unlink(f.native.file)
      expect((await search()).results).deep.equals([])
    })
  })

  for (const change of ['source membership', 'source registry', 'catalog generation'] as const)
    it(`discards already read evidence if ${change} changes before return`, async () => {
      const f = await fixture()
      const query = store.query.bind(store)
      let armed = true
      let called = 0
      store.query = async (input) => {
        if (armed && input.kind === 'membership' && input.sessionId === f.native.id && ++called === 2) {
          armed = false
          if (change === 'source registry') homes.delete(f.native.id)
          if (change === 'source membership') {
            await store.mutate(randomUUID(), {
              expectedRevision: 1,
              kind: 'membership',
              pairId: f.native.entry.sources[0].pairId,
              projectId: f.from.id,
              sessionId: f.native.id,
              sourceProjectId: f.to.id,
              unavailable: false,
            })
          }

          if (change === 'catalog generation') {
            await memory.edit(f.to.id, f.native.entry.id, {
              body: f.native.entry.body,
              expectedRevision: f.native.entry.revision,
              operationId: randomUUID(),
              retired: true,
              title: f.native.entry.title,
            })
          }
        }

        return query(input)
      }

      await bound(f.requester, async (binding) => {
        await rejects(
          () => memory.searchLeasedSession(f.requester, binding, {query: 'catalog'}),
          change === 'source membership' ? 'authorization changed' : 'changed',
        )
      })
      expect(armed).equals(false)
      const reopened = second.open(f.native.file)
      await reopened.close()
    })
})

async function rejects(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run()
  } catch (error) {
    expect(String(error)).contains(message)
    return
  }

  expect.fail('Expected the search to fail closed')
}
