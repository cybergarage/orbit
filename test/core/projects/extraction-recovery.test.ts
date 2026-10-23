// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import Database from 'better-sqlite3'
import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import type {ProjectExtractionJob} from '../../../src/core/projects/types.js'

import {AutomaticProjectMemory} from '../../../src/core/projects/automatic-memory.js'
import {catalogDigest} from '../../../src/core/projects/engine.js'
import {SqliteProjectStore} from '../../../src/core/projects/sqlite-store.js'

const child = promisify(execFile)
async function fixture(file: string) {
  const pairId = randomUUID(); const projectId = randomUUID(); const sessionId = randomUUID(); const store = await SqliteProjectStore.open({file})
  await store.mutate(projectId, {directory: null, expectedRevision: 0, id: projectId, kind: 'create', name: 'Synthetic recovery'})
  await store.mutate(randomUUID(), {expectedRevision: 0, kind: 'membership', pairId, projectId, sessionId, unavailable: false})
  const messages = [{digest: catalogDigest('source'), id: randomUUID(), role: 'user', text: 'Use PostgreSQL.'}]
  const job: ProjectExtractionJob = {attempt: 0, id: randomUUID(), inputTokens: 0, membershipRevision: 1, messages, outputTokens: 0,
    pairId, projectId, revision: 0, runId: randomUUID(), sessionId, sourceDigest: catalogDigest(messages), state: 'pending'}
  await store.mutate(job.id, {entries: [], expectedRevision: 0, generation: 0, job, kind: 'extraction'})
  await store.close(); return job
}

function runner(store: SqliteProjectStore, job: ProjectExtractionJob) {
  return new AutomaticProjectMemory(store, async () => ({inputTokens: 123, outputTokens: 45,
    text: JSON.stringify({candidates: [{body: 'Use PostgreSQL.', condition: '', importance: 3, kind: 'decision', messageId: job.messages[0].id,
      quote: job.messages[0].text, title: 'Storage'}]})}), async (_job, apply) => {await apply?.(); return true})
}

describe('Extraction crash and transaction recovery', function () {
  this.timeout(60_000)
  for (const boundary of ['before-claim', 'after-claim', 'after-inference', 'after-apply']) it(`recovers process death at ${boundary} without duplicate memory or refunded reservations`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-extraction-crash-')); const file = path.join(root, 'catalog.sqlite')
    try {
      const job = await fixture(file)
      try {await child(process.execPath, ['test/core/projects/fixtures/extraction-crash.mjs', file, job.id, boundary], {timeout: 15_000})}
      catch (error) {expect((error as {signal?: string}).signal).equals('SIGKILL')}

      const store = await SqliteProjectStore.open({file})
      try {
        await runner(store, job).process((await store.query({id: job.id, kind: 'extraction'}))!)
        const status = await store.query({kind: 'automation-status', projectId: job.projectId})
        expect(status.entries).length(1)
        expect(status.jobs[0].state).equals('completed')
        expect(status.config?.inputTokens).equals(['after-claim', 'after-inference'].includes(boundary) ? 8192 : 4096)
      } finally {await store.close()}
    } finally {await fs.rm(root, {force: true, recursive: true})}
  })

  it('rolls back a candidate when completion fails inside the catalog transaction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-extraction-atomic-')); const file = path.join(root, 'catalog.sqlite')
    try {
      const db = new Database(file); const job = await fixture(file)
      db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON extractions WHEN json_extract(new.payload, '$.state') = 'completed' BEGIN SELECT RAISE(ABORT, 'synthetic completion failure'); END;")
      db.close()
      const store = await SqliteProjectStore.open({file})
      try {
        await runner(store, job).process((await store.query({id: job.id, kind: 'extraction'}))!)
        expect(await store.query({kind: 'memories', projectId: job.projectId})).length(0)
        expect((await store.query({id: job.projectId, kind: 'automation'}))?.inputTokens).equals(4096)
      } finally {await store.close()}
    } finally {await fs.rm(root, {force: true, recursive: true})}
  })
})
