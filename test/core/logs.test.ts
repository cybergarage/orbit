// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  FileSessionLogStore,
  MemorySessionLogStore,
  SessionDeletionService,
  SessionRepository,
  StoreSessionLoggerFactory,
} from '../../src/core/index.js'

describe('session logs', () => {
  it('routes structured logger records to bounded memory partitions', async () => {
    const store = new MemorySessionLogStore({maxRecordsPerSession: 2})
    const factory = new StoreSessionLoggerFactory(store)
    const published: string[] = []
    const unsubscribe = store.subscribe((record) => published.push(record.message))
    const first = factory.forSession('session-1', {component: 'test'})
    const second = factory.forSession('session-2')

    first.info({runId: 'run-1'}, 'first')
    first.debug('hidden')
    first.setDebugEnabled(true)
    first.child({iteration: 1}).debug({authorization: 'Bearer secret', value: 'needle'}, 'second')
    first.info('third')
    second.warn('other')

    const firstPage = await store.list('session-1')
    expect(firstPage.data.map((record) => record.message)).to.deep.equal(['second', 'third'])
    expect(firstPage.data[0]).to.include({component: 'test', iteration: 1, sessionId: 'session-1'})
    expect(firstPage.data[0].fields).to.deep.equal({authorization: '[REDACTED]', value: 'needle'})
    expect((await store.list('session-1', {levels: ['debug'], search: 'needle'})).data).to.have.length(1)
    expect((await store.list('session-2')).data.map((record) => record.message)).to.deep.equal(['other'])
    expect(published).to.deep.equal(['first', 'second', 'third', 'other'])
    unsubscribe()
    await store.close()
  })

  it('persists, resumes, queries, and deletes isolated JSONL partitions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-logs-'))
    const firstStore = new FileSessionLogStore({rootDir: root})
    const firstFactory = new StoreSessionLoggerFactory(firstStore, {level: 'debug'})
    firstFactory.forSession('session-1').info({value: 'alpha'}, 'created')
    firstFactory.forSession('session-2').warn('preserved')
    await firstStore.close()

    const secondStore = new FileSessionLogStore({rootDir: root})
    const sinkErrors: string[] = []
    const secondFactory = new StoreSessionLoggerFactory(secondStore, {
      onError: (error) => sinkErrors.push(error.message),
    })
    secondFactory.forSession('session-1').info({value: 'beta'}, 'resumed')
    await secondStore.flush('session-1')

    const page = await secondStore.list('session-1', {search: 'beta'})
    expect(page.data.map((record) => record.message)).to.deep.equal(['resumed'])
    expect(await secondStore.deleteSession('session-1')).to.equal(true)
    secondFactory.forSession('session-1').info('must not be recreated')
    expect(sinkErrors).to.deep.equal(['Session log partition has been deleted: session-1'])
    expect((await secondStore.list('session-2')).data.map((record) => record.message)).to.deep.equal(['preserved'])
    expect(await secondStore.deleteSession('session-1')).to.equal(false)
    await expectRejected(secondStore.list('../escape'), 'Invalid session log identifier')

    if (process.platform !== 'win32') {
      const mode = (await fs.stat(path.join(root, 'session-2', 'events.jsonl'))).mode % 0o1000
      expect(mode).to.equal(0o600)
    }

    await secondStore.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('deletes logs before transcripts and preserves a session when log cleanup fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-log-delete-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({id: 'session-1'})
    await session.close()
    const logs = new MemorySessionLogStore()
    new StoreSessionLoggerFactory(logs).forSession('session-1').info('ready')
    const service = new SessionDeletionService(repository, logs)

    expect(await service.delete('session-1')).to.include({id: 'session-1'})
    expect((await logs.list('session-1')).data).to.deep.equal([])

    const retry = repository.create({id: 'session-2'})
    await retry.close()
    const failingLogs = new FailingMemorySessionLogStore()
    await expectRejected(
      new SessionDeletionService(repository, failingLogs).delete('session-2'),
      'simulated log deletion failure',
    )
    expect(await repository.findById('session-2')).to.include({id: 'session-2'})
    await fs.rm(root, {force: true, recursive: true})
  })
})

class FailingMemorySessionLogStore extends MemorySessionLogStore {
  override async deleteSession(_sessionId: string): Promise<boolean> {
    throw new Error('simulated log deletion failure')
  }
}

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected promise to reject.')
  } catch (error) {
    expect((error as Error).message).to.contain(message)
  }
}
