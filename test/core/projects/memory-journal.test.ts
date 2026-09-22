// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'

import {type JournalRecord, MemoryExecutionJournal, validateNext} from '../../../src/core/execution/journal.js'
import {recoveredRunSnapshot, type RunContext, RunSupervisor} from '../../../src/core/execution/run.js'
import {selectProjectMemory} from '../../../src/core/index.js'
  const snapshot = () => {
    const projectId = randomUUID()
    return selectProjectMemory(
      {
        entries: [],
        membership: {pairId: randomUUID(), projectId, revision: 1, sessionId: 'session', unavailable: false},
        project: {
          archived: false,
          createdAt: new Date().toISOString(),
          defaultDirectory: null,
          id: projectId,
          memoryGeneration: 0,
          name: 'Fixture',
          revision: 1,
          updatedAt: new Date().toISOString(),
        },
      },
      {captureId: randomUUID(), execution: 'agent'},
    )
  }


describe('Project journal version boundaries', () => {
  it('records v3 before effects, supports mixed runs, and recovers without preparing again', async () => {
    const journal = new MemoryExecutionJournal('session')
    const supervisor = new RunSupervisor()
    const context = snapshot()
    const options = {
      configuration: {secret: 'not-in-journal'},
      async execute(run: RunContext) {
        await run.ready([])
        return 1
      },
      input: {content: 'test'},
      journal: async () => journal,
      requestId: 'memory-run',
      sessionId: 'session',
    }
    const handle = await supervisor.startRun({...options, prepareProjectContext: async () => context})
    expect((await handle.finished).outcome).equals('completed')
    expect(journal.records().map((record) => record.kind)).deep.equals([
      'run-admitted',
      'project-context',
      'run-ready',
      'run-terminal',
    ])
    expect(JSON.stringify(journal.records())).not.contains('not-in-journal')
    expect(handle.getSnapshot().projectContext?.digest).equals(context.digest)
    const replay = await new RunSupervisor().startRun({
      ...options,
      async prepareProjectContext() {
        throw new Error('Must not prepare on recovery')
      },
    })
    expect(replay.id).equals(handle.id)
    const ordinary = await supervisor.startRun({...options, requestId: 'ordinary'})
    await ordinary.finished
    expect(
      journal
        .records()
        .filter((record) => record.kind === 'run-admitted')
        .map((record) => record.version),
    ).deep.equals([3, 1])
    await supervisor.close()
  })

  it('refuses missing, duplicate, changed and cross-version context before dispatch', async () => {
    const journal = new MemoryExecutionJournal('session')
    const supervisor = new RunSupervisor()
    const handle = await supervisor.startRun({
      configuration: {},
      async execute() {},
      input: {},
      journal: async () => journal,
      prepareProjectContext: async () => snapshot(),
      requestId: 'test',
      sessionId: 'session',
    })
    await handle.finished
    const [admission, context] = journal.records()
    const next = {...context, data: {catalog: 'a'.repeat(64)}, eventId: randomUUID(), kind: 'run-ready' as const}
    expect(() => validateNext([admission], next)).throws('acknowledgement')
    expect(() => validateNext([admission, context], {...context, eventId: randomUUID(), sequence: 3})).throws(
      'immediately',
    )
    expect(() => validateNext([admission], {...context, version: 2})).throws('v3')
    expect(() =>
      validateNext([admission], {...context, data: {snapshot: {...snapshot(), rendered: 'tampered'}}}),
    ).throws('mismatch')
    expect(recoveredRunSnapshot(admission.runId, 'session', [admission], journal).result?.reason).equals(
      'interrupted-project-preparation',
    )
    expect(() =>
      validateNext([admission, context], {
        ...next,
        data: {catalog: 'a'.repeat(64), transcriptHighWater: 0},
        sequence: 3,
      }),
    ).throws('Graph evidence')
    await supervisor.close()
  })

  it('never dispatches when the context record cannot be acknowledged', async () => {
    class FailedJournal extends MemoryExecutionJournal {
      protected override async persist(record: JournalRecord) {
        if (record.kind === 'project-context') throw new Error('Injected sync failure')
      }
    }
    const journal = new FailedJournal('session')
    const supervisor = new RunSupervisor()
    let dispatched = false
    try {
      await supervisor.startRun({
        configuration: {},
        async execute() {
          dispatched = true
        },
        input: {},
        journal: async () => journal,
        prepareProjectContext: async () => snapshot(),
        requestId: 'test',
        sessionId: 'session',
      })
      throw new Error('Expected acknowledgement failure')
    } catch (error) {
      expect(String(error)).contains('Injected sync failure')
    }

    expect(dispatched).equals(false)
    expect(journal.records().map((record) => record.kind)).deep.equals(['run-admitted'])
    await supervisor.close().catch(() => {})
  })
})
