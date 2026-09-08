// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sinon from 'sinon'

import type {
  ExecutionPolicy,
  OperationPreparation,
  PreparedOperation,
} from '../../../src/core/execution/authorization.js'
import type {JournalRecord} from '../../../src/core/execution/journal.js'
import type {RunContext} from '../../../src/core/execution/run.js'

import {executePrepared} from '../../../src/core/execution/authorization.js'
import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {inspectExecutionJournal, recordReconciliation} from '../../../src/core/execution/recovery.js'
import {DEFAULT_RUN_LIMITS, RunSupervisor} from '../../../src/core/execution/run.js'
import {openTestJournal} from '../../session-storage-fixture.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return {promise, reject, resolve}
}

function delay(ms = 0) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const unrestricted: ExecutionPolicy = {generation: 'test', profile: 'unrestricted', roots: []}
const options = (journal = new MemoryExecutionJournal('session')) => ({
  configuration: {},
  input: {},
  journal: async () => journal,
  requestId: 'request',
  sessionId: 'session',
})
function operate(
  run: RunContext,
  id: string,
  execute: OperationPreparation['execute'],
  policy = unrestricted,
  revalidate = async () => true,
) {
  const preparation: OperationPreparation = {
    binding: {},
    effect: 'command',
    execute,
    preview: {command: 'test'},
    revalidate,
    targets: [],
  }
  const descriptor: PreparedOperation = {
    binding: {},
    cwd: path.join(os.tmpdir(), `orbit-contract-${run.id}`),
    effect: 'command',
    id,
    input: {},
    name: 'test',
    preview: preparation.preview,
    runId: run.id,
    sessionId: 'session',
    targets: [],
    variant: 'tool-call',
    version: 1,
  }
  return executePrepared(run, descriptor, preparation, policy)
}

class HookJournal extends MemoryExecutionJournal {
  hook: (record: JournalRecord) => Promise<void> = async () => {}

  protected override persist(record: JournalRecord) {
    return this.hook(record)
  }
}

describe('cross-contract execution races', () => {
  it('rejects invalid limits before opening a journal', async () => {
    for (const value of [Number.NaN, Infinity, -1, 0, 1.5]) {
      let opens = 0
      // Each invalid-input case must finish before checking its counter.
      // eslint-disable-next-line no-await-in-loop
      await new RunSupervisor()
        .startRun({
          ...options(),
          async execute() {},
          async journal() {
            opens++
            return new MemoryExecutionJournal('session')
          },
          limits: {elapsedMs: value},
        })
        .then(
          () => {
            throw new Error('Unexpected admission')
          },
          () => {},
        )
      expect(opens).equal(0)
    }
  })

  it('enforces the finite product deadline with a yielding fake clock', async () => {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance']})
    try {
      const supervisor = new RunSupervisor()
      const handle = await supervisor.startRun({
        ...options(),
        async execute(run) {
          await run.ready([])
          await new Promise<void>((resolve) => {
            run.signal.addEventListener('abort', () => resolve(), {once: true})
          })
        },
        limits: {cleanupMs: 10, elapsedMs: 40},
      })
      await clock.tickAsync(40)
      expect((await handle.finished).outcome).equal('budget-exceeded')
      expect(DEFAULT_RUN_LIMITS).includes({
        cleanupMs: 5000,
        elapsedMs: 600_000,
        modelCalls: 6,
        toolRequests: 32,
        toolRounds: 5,
      })
    } finally {
      clock.restore()
    }
  })

  it('counts the entire tool batch before dispatch', async () => {
    let dispatches = 0
    const handle = await new RunSupervisor().startRun({
      ...options(),
      async execute(run) {
        await run.ready([])
        run.consume('toolRequests', 3)
        dispatches++
      },
      limits: {toolRequests: 2},
    })
    expect((await handle.finished).outcome).equal('budget-exceeded')
    expect(dispatches).equal(0)
  })

  it('deduplicates accepted input after ambient configuration changes', async () => {
    const supervisor = new RunSupervisor()
    let resources = 0
    const start = {
      ...options(),
      async execute() {
        resources++
        return 1
      },
    }
    const first = await supervisor.startRun(start)
    await first.finished
    const duplicate = await supervisor.startRun({
      ...start,
      configuration: {changed: true},
      async journal() {
        throw new Error('Must not reopen')
      },
    })
    expect(duplicate.id).equal(first.id)
    expect(resources).equal(1)
  })

  it('does not execute an admission that races with close', async () => {
    const gate = deferred<MemoryExecutionJournal>()
    let dispatches = 0
    const supervisor = new RunSupervisor()
    const start = supervisor.startRun({
      ...options(),
      async execute() {
        dispatches++
      },
      journal: () => gate.promise,
    })
    const closed = supervisor.close()
    expect(supervisor.close()).equal(closed)
    gate.resolve(new MemoryExecutionJournal('session'))
    await start.catch(() => {})
    expect((await closed).incomplete).equal(false)
    expect(dispatches).equal(0)
  })

  it('retains a late mutation and early rejection as separate outcomes', async () => {
    const gate = deferred<{content: []}>()
    const started = deferred<void>()
    const journal = new MemoryExecutionJournal('session')
    const supervisor = new RunSupervisor()
    const handle = await supervisor.startRun({
      ...options(journal),
      async execute(run) {
        await run.ready([])
        const late = operate(run, 'late', async () => {
          started.resolve()
          return gate.promise
        })
        await started.promise
        const early = operate(run, 'early', async () => {
          throw new Error('Unknown external response')
        })
        await Promise.allSettled([late, early])
      },
      limits: {cleanupMs: 10},
    })
    const result = await handle.finished
    expect(result.outcome).equal('incomplete')
    expect(result.operations).length(2)
    gate.resolve({content: []})
    await delay(10)
    expect(handle.getSnapshot().result).deep.equal(result)
    expect(handle.getSnapshot().quarantined).equal(true)
    await supervisor.reconcileRun(handle.id, {
      confirmedStopped: true,
      operations: [
        {id: 'early', status: 'failed'},
        {id: 'late', status: 'succeeded'},
      ],
    })
    expect(handle.getSnapshot().quarantined).equal(false)
    expect(journal.records().filter((record) => record.kind === 'run-terminal')).length(1)
    expect(journal.records().filter((record) => record.kind === 'late-settlement')).length(1)
  })

  it('attempts independent cleanup while a model ignores stop', async () => {
    const gate = deferred<void>()
    const started = deferred<void>()
    let cleanups = 0
    const handle = await new RunSupervisor().startRun({
      ...options(),
      async cleanup() {
        cleanups++
      },
      async execute() {
        started.resolve()
        await gate.promise
      },
      limits: {cleanupMs: 10},
    })
    await started.promise
    handle.requestStop()
    expect((await handle.finished).outcome).equal('incomplete')
    expect(cleanups).equal(1)
    gate.resolve()
    await delay(5)
    expect(cleanups).equal(1)
  })

  it('keeps a pending writer owned after the bounded result', async () => {
    const gate = deferred<void>()
    const writing = deferred<void>()
    const journal = new HookJournal('session')
    journal.hook = async (record) => {
      if (record.kind === 'operation-intent') {
        writing.resolve()
        await gate.promise
      }
    }

    const handle = await new RunSupervisor().startRun({
      ...options(journal),
      async execute(run) {
        await run.ready([])
        return operate(run, 'operation', async () => ({content: []}))
      },
      limits: {cleanupMs: 10},
    })
    await writing.promise
    handle.requestStop()
    const result = await handle.finished
    expect(result.outcome).equal('incomplete')
    expect(result.recording.status).equal('failed')
    gate.resolve()
    await delay(15)
    expect(handle.getSnapshot().result).deep.equal(result)
    expect(journal.records().filter((record) => record.kind === 'run-terminal')).length(1)
  })

  it('rejects wrong, opposite and expired approval replies and coalesces identical replies', async () => {
    const supervisor = new RunSupervisor()
    let dispatches = 0
    const handle = await supervisor.startRun({
      ...options(),
      async execute(run) {
        await run.ready([])
        return operate(
          run,
          'operation',
          async () => {
            dispatches++
            return {content: []}
          },
          {...unrestricted, decide: () => 'ask'},
        )
      },
      async onApproval(request) {
        const reply = {approve: true, digest: request.digest, requestId: request.id, responderScope: 'owner'}
        await supervisor.replyApproval(request.runId, {...reply, responderScope: 'stranger'}).then(
          () => {
            throw new Error('Wrong scope accepted')
          },
          () => {},
        )
        const replies = await Promise.all([
          supervisor.replyApproval(request.runId, reply),
          supervisor.replyApproval(request.runId, reply),
        ])
        expect(replies).deep.equal(['recorded', 'recorded'])
        await supervisor.replyApproval(request.runId, {...reply, approve: false}).then(
          () => {
            throw new Error('Opposite reply accepted')
          },
          () => {},
        )
      },
      responderScope: 'owner',
    })
    expect((await handle.finished).outcome).equal('completed')
    expect(dispatches).equal(1)
  })

  it('does not dispatch after policy revocation during intent acknowledgement', async () => {
    let revoked = false
    let dispatches = 0
    const journal = new HookJournal('session')
    journal.hook = async (record) => {
      if (record.kind === 'operation-intent') revoked = true
    }

    const handle = await new RunSupervisor().startRun({
      ...options(journal),
      async execute(run) {
        await run.ready([])
        return operate(
          run,
          'operation',
          async () => {
            dispatches++
            return {content: []}
          },
          {...unrestricted, revoked: () => revoked},
        )
      },
    })
    const result = await handle.finished
    expect(dispatches).equal(0)
    expect(result.operations[0].status).equal('cancelled-before-start')
  })

  it('does not dispatch without an approval responder', async () => {
    let dispatches = 0
    const handle = await new RunSupervisor().startRun({
      ...options(),
      async execute(run) {
        await run.ready([])
        return operate(
          run,
          'operation',
          async () => {
            dispatches++
            return {content: []}
          },
          {...unrestricted, decide: () => 'ask'},
        )
      },
    })
    expect((await handle.finished).operations[0].status).equal('denied')
    expect(dispatches).equal(0)
  })

  it('does not complete after an operation-result acknowledgement fails', async () => {
    const journal = new HookJournal('session')
    journal.hook = async (record) => {
      if (record.kind === 'operation-result') throw new Error('storage failure')
    }

    const handle = await new RunSupervisor().startRun({
      ...options(journal),
      async execute(run) {
        await run.ready([])
        return operate(run, 'operation', async () => ({content: []}))
      },
    })
    const result = await handle.finished
    expect(result.operations[0].status).equal('succeeded')
    expect(result.outcome).equal('failed')
    expect(result.recording.status).equal('failed')
  })

  it('recovers a complete write with lost acknowledgement without redispatch', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-lost-ack-'))
    let failSync = true
    const io = {
      ...fs,
      async open(
        file: Parameters<typeof fs.open>[0],
        flags: Parameters<typeof fs.open>[1],
        mode?: Parameters<typeof fs.open>[2],
      ) {
        const handle = await fs.open(file, flags, mode)
        if (!String(file).endsWith('events.jsonl')) return handle
        return new Proxy(handle, {
          get(target, key) {
            if (key === 'sync')
              return async () => {
                if (failSync) {
                  failSync = false
                  throw new Error('ack lost after full write')
                }

                await target.sync()
              }

            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      },
    } as typeof fs
    try {
      const journal = await openTestJournal('session', {io, releaseLease() {}, root})
      const digest = journal.digest({})
      await journal
        .append('run', 'run-admitted', {requestDigest: digest, requestId: 'request'}, 0, 'event')
        .catch(() => {})
      await journal.close().catch(() => {})
      const reopened = await openTestJournal('session', {releaseLease() {}, root})
      expect(
        (await reopened.append('run', 'run-admitted', {requestDigest: digest, requestId: 'request'}, 0, 'event'))
          .sequence,
      ).equal(1)
      let dispatches = 0
      const supervisor = new RunSupervisor()
      const recovered = await supervisor.startRun({
        ...options(reopened),
        async execute() {
          dispatches++
        },
      })
      expect((await recovered.finished).outcome).equal('incomplete')
      expect(dispatches).equal(0)
      expect(supervisor.getRun('run')?.quarantined).equal(true)
      await recordReconciliation(reopened, 'run', {confirmedStopped: true, operations: []})
      const next = await supervisor.startRun({
        ...options(reopened),
        async execute(run) {
          await run.ready([])
        },
        requestId: 'new',
      })
      expect((await next.finished).outcome).equal('completed')
      await reopened.close()
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('preserves torn bytes in a read-only inspection and rejects missing keys', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-inspect-'))
    try {
      const journal = await openTestJournal('session', {releaseLease() {}, root})
      await journal.append('run', 'run-admitted', {})
      await journal.close()
      const file = path.join(root, 'session/run/events.jsonl')
      await fs.appendFile(file, '{partial')
      const inspection = await inspectExecutionJournal(root, 'session')
      expect(inspection.runs[0].records).length(1)
      expect(inspection.runs[0].issue).contains('Torn')
      expect((await fs.readFile(file, 'utf8')).endsWith('{partial')).equal(true)
      await fs.unlink(path.join(root, 'session/key'))
      await openTestJournal('session', {releaseLease() {}, root}).then(
        () => {
          throw new Error('Missing key accepted')
        },
        (error) => {
          expect(String(error)).contains('key missing')
        },
      )
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('records a stop during transcript finalization without a second terminal result', async () => {
    const gate = deferred<void>()
    const entered = deferred<void>()
    const journal = new MemoryExecutionJournal('session')
    const handle = await new RunSupervisor().startRun({
      ...options(journal),
      async execute(run) {
        await run.ready([])
      },
      async synchronize() {
        entered.resolve()
        await gate.promise
        return 7
      },
    })
    await entered.promise
    expect(handle.requestStop()).equal('requested')
    gate.resolve()
    const result = await handle.finished
    expect(result.outcome).equal('cancelled')
    expect(journal.records().filter((record) => record.kind === 'run-terminal')).length(1)
  })

  it('does not await or leak an asynchronously rejecting snapshot observer', async () => {
    const handle = await new RunSupervisor().startRun({
      ...options(),
      async execute(run) {
        await run.ready([])
      },
      async onSnapshot() {
        throw new Error('optional observer')
      },
    })
    expect((await handle.finished).outcome).equal('completed')
    await delay()
  })
})
