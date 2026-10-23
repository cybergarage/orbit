// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {ProjectExtractionJob, ProjectStore} from '../../../src/core/projects/types.js'

import {AutomaticProjectMemory} from '../../../src/core/projects/automatic-memory.js'
import {catalogDigest} from '../../../src/core/projects/engine.js'
import {selectProjectMemory} from '../../../src/core/projects/memory-context.js'
import {MemoryProjectStore} from '../../../src/core/projects/memory-store.js'
import {SqliteProjectStore} from '../../../src/core/projects/sqlite-store.js'

for (const adapter of ['memory', 'sqlite'] as const)
  describe(`${adapter} persistent extraction backpressure`, () => {
    it('bounds concurrent enqueue at 32, preserves retries and leaves ordinary context preparation usable', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-queue-'))
      const file = path.join(root, 'catalog.sqlite')
      let store: ProjectStore = adapter === 'memory' ? new MemoryProjectStore() : await SqliteProjectStore.open({file})
      const competing = adapter === 'memory' ? store : await SqliteProjectStore.open({file})
      try {
        const pairId = randomUUID()
        const projectId = randomUUID()
        const sessionId = randomUUID()
        await store.mutate(projectId, {
          directory: null,
          expectedRevision: 0,
          id: projectId,
          kind: 'create',
          name: 'Queue fixture',
        })
        await store.mutate(randomUUID(), {
          expectedRevision: 0,
          kind: 'membership',
          pairId,
          projectId,
          sessionId,
          unavailable: false,
        })
        const messages = [{digest: catalogDigest('source'), id: randomUUID(), role: 'user', text: 'Synthetic decision'}]
        const jobs: ProjectExtractionJob[] = Array.from({length: 40}, () => ({
          attempt: 0,
          id: randomUUID(),
          inputTokens: 0,
          membershipRevision: 1,
          messages,
          outputTokens: 0,
          pairId,
          projectId,
          revision: 0,
          runId: randomUUID(),
          sessionId,
          sourceDigest: catalogDigest(messages),
          state: 'pending',
        }))
        const enqueue = (writer: ProjectStore, job: ProjectExtractionJob) =>
          writer.mutate(job.id, {entries: [], expectedRevision: 0, generation: 0, job, kind: 'extraction'})
        const outcomes = await Promise.allSettled(jobs.map((job, index) => enqueue(index % 2 ? competing : store, job)))
        expect(outcomes.filter((item) => item.status === 'fulfilled')).length(32)
        expect(outcomes.filter((item) => item.status === 'rejected')).length(8)
        expect((await store.query({kind: 'automation-status', projectId})).queue).deep.equals({limit: 32, pending: 32})
        const catalog = await store.query({kind: 'snapshot', pairId, projectId, sessionId})
        expect(
          selectProjectMemory(catalog, {captureId: randomUUID(), execution: 'agent', request: 'Continue normally'})
            .entries,
        ).length(0)
        const first = jobs[outcomes.findIndex((item) => item.status === 'fulfilled')]
        await enqueue(store, first)
        await new AutomaticProjectMemory(
          store,
          async () => ({text: '{"candidates":[]}'}),
          async (_job, apply) => {
            await apply?.()
            return true
          },
        ).process((await store.query({id: first.id, kind: 'extraction'}))!)
        const rejected = jobs[outcomes.findIndex((item) => item.status === 'rejected')]
        await enqueue(store, rejected)
        expect((await store.query({kind: 'automation-status', projectId})).queue.pending).equals(32)
        if (adapter === 'sqlite') {
          await competing.close()
          await store.close()
          store = await SqliteProjectStore.open({file})
        }

        expect((await store.query({kind: 'automation-status', projectId})).queue.pending).equals(32)
      } finally {
        await competing.close()
        await store.close()
        await fs.rm(root, {force: true, recursive: true})
      }
    })
  })
