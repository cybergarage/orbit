// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  FileSessionLogStore,
  LogCategory,
  LogEventType,
  LogOutcome,
  MemorySessionLogStore,
  runWithLogContext,
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
    first.child({iteration: 1}).debug(
      {
        authorization: 'Bearer secret',
        eventType: LogEventType.ToolCallCompleted,
        outcome: LogOutcome.Succeeded,
        toolCallId: 'tool-1',
        value: 'needle Bearer abc.def.ghi sk-ant-abcdefghijklmnop',
      },
      'second',
    )
    first.info('third')
    second.warn('other')

    const firstPage = await store.list('session-1')
    expect(firstPage.data.map((record) => record.message)).to.deep.equal(['second', 'third'])
    expect(firstPage.data[0]).to.include({
      category: LogCategory.Tool,
      component: 'test',
      eventType: LogEventType.ToolCallCompleted,
      outcome: LogOutcome.Succeeded,
      version: 2,
    })
    expect(firstPage.data[0].correlation).to.include({
      iteration: 1,
      sessionId: 'session-1',
      toolCallId: 'tool-1',
    })
    expect(firstPage.data[0].fields).to.deep.equal({
      authorization: '[REDACTED]',
      value: 'needle Bearer [REDACTED] [REDACTED]',
    })
    expect(
      (
        await store.list('session-1', {
          categories: [LogCategory.Tool],
          eventTypes: [LogEventType.ToolCallCompleted],
          levels: ['debug'],
          outcomes: [LogOutcome.Succeeded],
          search: 'needle',
        })
      ).data,
    ).to.have.length(1)
    expect((await store.list('session-2')).data.map((record) => record.message)).to.deep.equal(['other'])
    expect(published).to.deep.equal(['first', 'second', 'third', 'other'])
    expect(store.getHealth()).to.include({accepted: 4, dropped: 1, redacted: 3, written: 4})
    unsubscribe()
    await store.close()
  })

  it('upgrades legacy records and pages with opaque cursors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-log-legacy-'))
    const directory = path.join(root, 'session-1')
    await fs.mkdir(directory, {recursive: true})
    await fs.writeFile(
      path.join(directory, 'events.jsonl'),
      `${JSON.stringify({
        fields: {eventType: 'turn.started'},
        id: 'legacy-1',
        level: 'info',
        message: 'legacy turn',
        runId: 'turn-1',
        sessionId: 'session-1',
        threadId: 'session-1',
        timestamp: '2026-08-25T00:00:00.000Z',
        version: 1,
      })}\n`,
    )
    const store = new FileSessionLogStore({rootDir: root})
    const logger = new StoreSessionLoggerFactory(store).forSession('session-1')
    logger.info({eventType: LogEventType.TurnCompleted}, 'current turn')
    logger.info({eventType: LogEventType.SessionClosed}, 'closed')
    await store.flush('session-1')

    const page = await store.list('session-1', {after: 'legacy-1', limit: 1})
    expect(page.data.map((record) => record.eventType)).to.deep.equal([LogEventType.TurnCompleted])
    expect(page.next).to.be.a('string').and.not.equal(page.data[0].id)
    expect((await store.list('session-1', {after: page.next})).data.map((record) => record.eventType)).to.deep.equal([
      LogEventType.SessionClosed,
    ])
    expect((await store.list('session-1')).data[0]).to.include({
      category: LogCategory.Lifecycle,
      eventType: LogEventType.TurnStarted,
      version: 2,
    })
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('inherits correlation through asynchronous execution context', async () => {
    const store = new MemorySessionLogStore()
    const logger = new StoreSessionLoggerFactory(store).forApplication()

    await runWithLogContext(
      {requestId: 'request-1', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', turnId: 'turn-1'},
      async () => {
        await Promise.resolve()
        logger.info('inside context')
      },
    )

    expect((await store.list('session-1')).data[0].correlation).to.deep.equal({
      requestId: 'request-1',
      runId: 'run-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    await store.close()
  })

  it('rotates and bounds file partitions while reporting sink health', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-log-retention-'))
    const store = new FileSessionLogStore({
      maxBytesPerSession: 100_000,
      maxRecordsPerSession: 3,
      maxSegmentBytes: 250,
      now: () => Date.parse('2026-08-25T12:00:00.000Z'),
      rootDir: root,
    })
    const logger = new StoreSessionLoggerFactory(store).forSession('session-1')
    for (let index = 0; index < 5; index += 1) {
      logger.info({eventType: LogEventType.RuntimeEvent, index, value: 'x'.repeat(80)}, `record ${index}`)
    }

    await store.flush('session-1')

    expect((await store.list('session-1')).data.map((record) => record.message)).to.deep.equal([
      'record 2',
      'record 3',
      'record 4',
    ])
    expect(store.getHealth()).to.include({accepted: 5, dropped: 2, written: 5})
    expect(store.getHealth().rotated).to.be.greaterThan(0)
    expect(
      (await fs.readdir(path.join(root, 'session-1'))).every((file) => /^events(?:-\d{13}-\d+)?\.jsonl$/u.test(file)),
    ).to.equal(true)
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('bounds pending writes and repairs an incomplete active line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-log-queue-'))
    const directory = path.join(root, 'session-1')
    await fs.mkdir(directory, {recursive: true})
    await fs.writeFile(path.join(directory, 'events.jsonl'), '{"incomplete":')
    const store = new FileSessionLogStore({maxPendingRecords: 2, rootDir: root})
    const logger = new StoreSessionLoggerFactory(store).forSession('session-1')

    logger.info('first')
    logger.info('second')
    logger.info('dropped')
    await store.flush('session-1')

    expect((await store.list('session-1')).data.map((record) => record.message)).to.deep.equal(['first', 'second'])
    expect(store.getHealth()).to.include({accepted: 2, dropped: 1, failed: 0, written: 2})
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
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
