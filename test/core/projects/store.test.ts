// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import Database from 'better-sqlite3'
import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Project, ProjectMemoryEntry, ProjectMutation, ProjectStore} from '../../../src/core/projects/index.js'

import {MemoryProjectStore, ProjectStoreError, SqliteProjectStore} from '../../../src/core/projects/index.js'

async function refuses(action: Promise<unknown>, code: ProjectStoreError['code']): Promise<void> {
  try {
    await action
  } catch (error) {
    expect(error).instanceOf(ProjectStoreError)
    expect((error as ProjectStoreError).code).equals(code)
    return
  }

  throw new Error(`Expected ${code} failure`)
}

async function create(store: ProjectStore, name = 'Example'): Promise<Project> {
  return (await store.mutate(randomUUID(), {
    directory: null,
    expectedRevision: 0,
    id: randomUUID(),
    kind: 'create',
    name,
  })) as Project
}

for (const adapter of ['memory', 'sqlite'] as const) {
  describe(`${adapter} ProjectStore conformance`, () => {
    let root: string
    let store: ProjectStore

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-project-test-'))
      store =
        adapter === 'memory'
          ? new MemoryProjectStore()
          : await SqliteProjectStore.open({file: path.join(root, 'catalog', 'projects.sqlite')})
    })

    afterEach(async () => {
      await store.close()
      await fs.rm(root, {force: true, recursive: true})
    })

    it('keeps identity independent of directory and paginates with a stable ID cursor', async () => {
      const a = await create(store)
      const b = await create(store)
      expect(a.id).not.equals(b.id)
      const page = await store.query({kind: 'projects', limit: 1})
      const next = await store.query({after: page[0].id, kind: 'projects', limit: 1})
      expect([...page, ...next].map((p) => p.id)).deep.equals([a.id, b.id].sort())
      page[0].name = 'Mutated caller copy'
      expect((await store.query({id: page[0].id, kind: 'project'}))?.name).equals('Example')
    })

    it('records exact retry results while rejecting changed input and stale revisions', async () => {
      const project = await create(store)
      const operationId = randomUUID()
      const mutation: ProjectMutation = {
        archived: false,
        directory: null,
        expectedRevision: 1,
        id: project.id,
        kind: 'update',
        name: 'Renamed',
      }
      const result = await store.mutate(operationId, mutation)
      expect(await store.mutate(operationId, mutation)).deep.equals(result)
      await refuses(store.mutate(operationId, {...mutation, name: 'Different'}), 'conflict')
      await refuses(store.mutate(randomUUID(), mutation), 'conflict')
      expect(await store.query({id: operationId, kind: 'operation'}))
        .property('result')
        .deep.equals(result)
    })

    it('preserves one revisioned membership and rejects work in archived projects', async () => {
      const a = await create(store)
      const b = await create(store)
      const pairId = randomUUID()
      const mutation: ProjectMutation = {
        expectedRevision: 0,
        kind: 'membership',
        pairId,
        projectId: a.id,
        sessionId: 'session',
        unavailable: false,
      }
      await store.mutate(randomUUID(), mutation)
      await refuses(store.mutate(randomUUID(), {...mutation, projectId: b.id}), 'conflict')
      await store.mutate(randomUUID(), {...mutation, expectedRevision: 1, projectId: b.id})
      expect((await store.query({kind: 'membership', pairId, sessionId: 'session'}))?.projectId).equals(b.id)
      expect((await store.query({id: a.id, kind: 'project'}))?.memoryGeneration).equals(1)
      await store.mutate(randomUUID(), {
        archived: true,
        directory: null,
        expectedRevision: 1,
        id: b.id,
        kind: 'update',
        name: b.name,
      })
      await refuses(store.mutate(randomUUID(), {...mutation, expectedRevision: 2, projectId: b.id}), 'archived')
      await store.mutate(randomUUID(), {...mutation, expectedRevision: 2, projectId: null})
      expect(await store.query({kind: 'memberships', limit: 10, pairId, projectId: null})).length(1)
    })

    it('retains pending creation when project state changes and commits membership atomically', async () => {
      const project = await create(store)
      const reservation = {
        cwd: root,
        id: randomUUID(),
        pairId: randomUUID(),
        projectId: project.id,
        projectRevision: 1,
        sessionId: randomUUID(),
      }
      await store.mutate(randomUUID(), {kind: 'reserve', reservation})
      const committed = await store.mutate(randomUUID(), {kind: 'commit-reservation', reservationId: reservation.id})
      expect(committed).property('state', 'committed')
      expect(
        (await store.query({kind: 'membership', pairId: reservation.pairId, sessionId: reservation.sessionId}))
          ?.projectId,
      ).equals(project.id)
      const pending = {...reservation, id: randomUUID(), sessionId: randomUUID()}
      await store.mutate(randomUUID(), {kind: 'reserve', reservation: pending})
      await store.mutate(randomUUID(), {
        archived: false,
        directory: null,
        expectedRevision: 1,
        id: project.id,
        kind: 'update',
        name: 'Changed',
      })
      await refuses(store.mutate(randomUUID(), {kind: 'commit-reservation', reservationId: pending.id}), 'conflict')
      expect(await store.query({id: pending.id, kind: 'reservation'})).property('state', 'pending')
      expect(await store.query({kind: 'membership', pairId: pending.pairId, sessionId: pending.sessionId})).equals(null)
    })

    it('binds memory capture to membership and generation without replacing exact retries', async () => {
      const project = await create(store)
      const pairId = randomUUID()
      await store.mutate(randomUUID(), {
        expectedRevision: 0,
        kind: 'membership',
        pairId,
        projectId: project.id,
        sessionId: 'session',
        unavailable: false,
      })
      const capture: ProjectMutation = {
        generation: 0,
        kind: 'capture',
        membershipRevision: 1,
        pairId,
        projectId: project.id,
        sessionId: 'session',
        snapshotDigest: 'a'.repeat(64),
      }
      const operationId = randomUUID()
      await store.mutate(operationId, capture)
      const entry = {
        body: 'Use a temporary database.',
        edited: false,
        id: randomUUID(),
        projectId: project.id,
        retired: false,
        sources: [],
        title: 'Tests',
      }
      const saved = (await store.mutate(randomUUID(), {
        entry,
        expectedRevision: 0,
        kind: 'memory',
      })) as ProjectMemoryEntry
      expect(saved.revision).equals(1)
      await refuses(store.mutate(randomUUID(), capture), 'conflict')
      expect(await store.mutate(operationId, capture)).deep.equals({snapshotDigest: capture.snapshotDigest})
      expect(
        (await store.query({kind: 'snapshot', pairId, projectId: project.id, sessionId: 'session'})).entries,
      ).length(1)
      await store.mutate(randomUUID(), {entry: {...entry, retired: true}, expectedRevision: 1, kind: 'memory'})
      expect((await store.query({kind: 'memories', projectId: project.id}))[0]).include({retired: true, revision: 2})
    })

    it('rejects excess bytes and provenance changes without partial mutations', async () => {
      const project = await create(store)
      const entry = {
        body: 'Source text',
        edited: false,
        id: randomUUID(),
        projectId: project.id,
        retired: false,
        sources: [{digest: 'b'.repeat(64), messageId: 'message', pairId: randomUUID(), sessionId: 'source'}],
        title: 'Evidence',
      }
      await store.mutate(randomUUID(), {entry, expectedRevision: 0, kind: 'memory'})
      await refuses(
        store.mutate(randomUUID(), {entry: {...entry, sources: []}, expectedRevision: 1, kind: 'memory'}),
        'conflict',
      )
      await refuses(
        store.mutate(randomUUID(), {entry: {...entry, body: '語'.repeat(3000)}, expectedRevision: 1, kind: 'memory'}),
        'invalid',
      )
      expect((await store.query({id: project.id, kind: 'project'}))?.memoryGeneration).equals(1)
      expect((await store.query({kind: 'memories', projectId: project.id}))[0].body).equals(entry.body)
    })

    it('retires source-derived entries when a source moves and does not reactivate them on return', async () => {
      const a = await create(store)
      const b = await create(store)
      const pairId = randomUUID()
      const membership: ProjectMutation = {expectedRevision: 0, kind: 'membership', pairId, projectId: a.id, sessionId: 'source', unavailable: false}
      await store.mutate(randomUUID(), membership)
      const entry = {body: 'Source fact', edited: false, id: randomUUID(), projectId: a.id, retired: false, sources: [{digest: 'c'.repeat(64), messageId: 'message', pairId, sessionId: 'source'}], title: 'Fact'}
      await store.mutate(randomUUID(), {entry, expectedRevision: 0, kind: 'memory'})
      await store.mutate(randomUUID(), {...membership, expectedRevision: 1, projectId: b.id})
      await store.mutate(randomUUID(), {...membership, expectedRevision: 2})
      expect((await store.query({kind: 'memories', projectId: a.id}))[0]).include({retired: true, revision: 2})
      expect(await store.query({kind: 'memories', projectId: b.id})).deep.equals([])
    })

    it('rejects invalid paths and IDs and drains before closing', async () => {
      await refuses(
        store.mutate(randomUUID(), {
          directory: '../relative',
          expectedRevision: 0,
          id: randomUUID(),
          kind: 'create',
          name: 'Invalid',
        }),
        'invalid',
      )
      const pending = create(store)
      await store.close()
      expect(await pending).property('revision', 1)
      await refuses(store.query({kind: 'projects', limit: 10}), 'closed')
    })
  })
}

describe('SQLite project persistence', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-sqlite-test-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('exports opt-in adapters through the public API', async () => {
    const api = await import('../../../src/index.js')
    expect(api.SqliteProjectStore).equals(SqliteProjectStore)
    expect(api.MemoryProjectStore).equals(MemoryProjectStore)
  })

  it('persists operations and takes a consistent SQLite backup while WAL is live', async () => {
    const file = path.join(root, 'projects.sqlite')
    const store = await SqliteProjectStore.open({file})
    let project: Project
    try {
      project = await create(store)
      await store.backup(path.join(root, 'backup.sqlite'))
    } finally {
      await store.close()
    }

    await Promise.all(
      ['projects.sqlite', 'backup.sqlite'].map(async (name) => {
        const reopened = await SqliteProjectStore.open({file: path.join(root, name)})
        try {
          expect(await reopened.query({id: project!.id, kind: 'project'})).deep.equals(project!)
        } finally {
          await reopened.close()
        }
      }),
    )
  })

  it('serializes competing connections and bounds a busy worker queue', async () => {
    const file = path.join(root, 'projects.sqlite')
    const a = await SqliteProjectStore.open({file})
    const b = await SqliteProjectStore.open({file, queueLimit: 1, timeoutMs: 20})
    try {
      const project = await create(a)
      const mutation: ProjectMutation = {
        archived: false,
        directory: null,
        expectedRevision: 1,
        id: project.id,
        kind: 'update',
        name: 'Winner',
      }
      const outcomes = await Promise.allSettled([a.mutate(randomUUID(), mutation), b.mutate(randomUUID(), mutation)])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).length(1)
      const blocker = new Database(file)
      try {
        blocker.exec('BEGIN IMMEDIATE')
        const busy = b.mutate(randomUUID(), {...mutation, expectedRevision: 2})
        await refuses(b.query({kind: 'projects', limit: 1}), 'busy')
        await refuses(busy, 'busy')
      } finally {
        blocker.exec('ROLLBACK')
        blocker.close()
      }

      expect((await a.query({id: project.id, kind: 'project'}))?.revision).equals(2)
    } finally {
      await a.close()
      await b.close()
    }
  })

  it('refuses future and corrupt schemas without resetting them', async () => {
    const file = path.join(root, 'future.sqlite')
    const db = new Database(file)
    db.pragma('user_version = 99')
    db.close()
    await refuses(SqliteProjectStore.open({file}), 'storage')
    const check = new Database(file)
    expect(check.pragma('user_version', {simple: true})).equals(99)
    check.close()
    const corrupt = path.join(root, 'corrupt.sqlite')
    await fs.writeFile(corrupt, 'not a SQLite database')
    await refuses(SqliteProjectStore.open({file: corrupt}), 'storage')
  })
})
