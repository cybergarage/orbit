// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {performance} from 'node:perf_hooks'
import {spy} from 'sinon'

import type {ExecutionLimit} from '../../../src/core/index.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor, until} from '../../../src/core/execution/run.js'
import {DEFAULT_RUN_LIMITS, parseRunLimits, Session} from '../../../src/core/index.js'
import {encodeSessionEntry, parseSessionFile} from '../../../src/core/session/codec.js'
import {mergeWorkspaceSettings} from '../../../src/core/settings.js'

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

describe('unlimited aggregate execution budgets', () => {
  it('accepts explicit JSON limits, merges them and keeps lifecycle limits finite', () => {
    const unlimited = {
      elapsedMs: 'unlimited',
      modelCalls: 'unlimited',
      toolRequests: 'unlimited',
      toolRounds: 'unlimited',
    } as const
    expect(DEFAULT_RUN_LIMITS).include(unlimited)
    const encodedLimits = JSON.stringify(unlimited)
    expect(parseRunLimits(JSON.parse(encodedLimits))).deep.equal(unlimited)
    expect(
      mergeWorkspaceSettings({executionLimits: {toolRounds: 2}}, {executionLimits: unlimited}).executionLimits,
    ).deep.equal(unlimited)
    expect(
      mergeWorkspaceSettings({executionLimits: unlimited}, {executionLimits: {toolRounds: 2}}).executionLimits,
    ).deep.equal({...unlimited, toolRounds: 2})
    for (const key of ['approvalMs', 'cleanupMs', 'mcpStartupMs', 'mcpServers'])
      expect(() => parseRunLimits({[key]: 'unlimited'})).to.throw('Invalid run limit')
    for (const value of [null, Infinity, Number.NaN, 'Infinity', 'Unlimited', '10000', -1, 1.1])
      expect(() => parseRunLimits({toolRounds: value})).to.throw('Invalid run limit')
    expect(parseRunLimits({elapsedMs: 1, modelCalls: 0, toolRounds: 10_000})).deep.equal({
      elapsedMs: 1,
      modelCalls: 0,
      toolRounds: 10_000,
    })
  })

  it('consumes beyond former ceilings without installing an aggregate timer', async () => {
    const timers = spy(globalThis, 'setTimeout')
    const supervisor = new RunSupervisor()
    try {
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          run.consume('toolRounds', 10_001)
          run.consume('modelCalls', 10_002)
          run.consume('toolRequests', 80_008)
          expect(run.remaining()).equal(Infinity)
          expect(timers.getCalls()).length(0)
          return 'complete'
        },
        input: {},
        journal: async () => new MemoryExecutionJournal('unlimited'),
        requestId: 'unlimited',
        sessionId: 'unlimited',
      })
      expect((await handle.finished).outcome).equal('completed')
      expect(handle.getSnapshot().budget).deep.equal({modelCalls: 10_002, toolRequests: 80_008, toolRounds: 10_001})
      const encodedSnapshot = JSON.stringify(handle.getSnapshot())
      expect(JSON.parse(encodedSnapshot).limits).include({elapsedMs: 'unlimited'})
    } finally {
      timers.restore()
      await supervisor.close()
    }
  })

  it('does not convert an unlimited settlement deadline into a one millisecond timeout', async () => {
    expect(
      await until(
        delay(15).then(() => 'settled'),
        Infinity,
      ),
    ).equal('settled')
  })

  for (const limit of [0, 2])
    it(`enforces a finite ${limit}-call override with unlimited total time`, async () => {
      const supervisor = new RunSupervisor()
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          run.consume('modelCalls', limit + 1)
        },
        input: {},
        journal: async () => new MemoryExecutionJournal('finite'),
        limits: {modelCalls: limit},
        requestId: 'finite',
        sessionId: 'finite',
      })
      expect((await handle.finished).outcome).equal('budget-exceeded')
      expect((await handle.finished).reason).equal(`budget-exceeded:modelCalls:${limit}:0:${limit + 1}`)
      await supervisor.close()
    })

  it('retains a finite elapsed deadline when all counters are unlimited', async () => {
    const supervisor = new RunSupervisor()
    const handle = await supervisor.startRun({
      configuration: {},
      async execute(run) {
        await run.ready([])
        await new Promise<void>((resolve) => {
          run.signal.addEventListener('abort', () => resolve(), {once: true})
        })
      },
      input: {},
      journal: async () => new MemoryExecutionJournal('deadline'),
      limits: {elapsedMs: 20},
      requestId: 'deadline',
      sessionId: 'deadline',
    })
    expect((await handle.finished).outcome).equal('budget-exceeded')
    await supervisor.close()
  })

  for (const stop of ['user', 'close'] as const)
    it(`stops unlimited work through ${stop}`, async () => {
      const supervisor = new RunSupervisor()
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          const stopped = new Promise<void>((resolve) => {
            run.signal.addEventListener('abort', () => resolve(), {once: true})
          })
          entered()
          await stopped
        },
        input: {},
        journal: async () => new MemoryExecutionJournal(stop),
        requestId: stop,
        sessionId: stop,
      })
      await started
      if (stop === 'user') handle.requestStop()
      else await supervisor.close()
      expect((await handle.finished).outcome).equal('cancelled')
      expect((await handle.finished).quiescence).equal(true)
      await supervisor.close()
    })

  it('cancels unlimited admission and closes a journal that opens after cancellation', async () => {
    const supervisor = new RunSupervisor()
    const signal = new AbortController()
    const journal = new MemoryExecutionJournal('opening')
    const close = spy(journal, 'close')
    let opened!: (value: MemoryExecutionJournal) => void
    const opening = new Promise<MemoryExecutionJournal>((resolve) => {
      opened = resolve
    })
    const started = supervisor
      .startRun({
        configuration: {},
        async execute() {
          throw new Error('Must not execute')
        },
        input: {},
        journal: () => opening,
        requestId: 'opening',
        sessionId: 'opening',
        signal: signal.signal,
      })
      .then(
        () => 'unexpected',
        (error: Error) => error.message,
      )
    signal.abort()
    expect(await started).equal('Settlement cancelled')
    opened(journal)
    await delay(0)
    expect(close.calledOnce).equal(true)
    await supervisor.close(performance.now() + 100)
  })

  it('bounds shutdown of pending unlimited admission without claiming quiescence', async () => {
    const supervisor = new RunSupervisor()
    const journal = new MemoryExecutionJournal('pending')
    let opened!: (value: MemoryExecutionJournal) => void
    const opening = new Promise<MemoryExecutionJournal>((resolve) => {
      opened = resolve
    })
    const start = supervisor
      .startRun({
        configuration: {},
        execute: async () => 'unexpected',
        input: {},
        journal: () => opening,
        requestId: 'pending',
        sessionId: 'pending',
      })
      .catch((error: Error) => error)
    const result = await supervisor.close(performance.now() + 100)
    expect(result.incomplete).equal(true)
    expect(await start).instanceOf(Error)
    opened(journal)
    await delay(0)
  })

  for (const version of [1, 2, 3] as const)
    for (const limit of [5, 'unlimited'] as ExecutionLimit[]) {
      it(`round-trips ${limit} turn iterations in transcript v${version}`, () => {
        const session = new Session({formatVersion: version})
        session.recordTurnContext({
          cwd: '/workspace',
          maxToolIterations: limit,
          model: 'test',
          provider: 'ollama',
          turnId: 'turn',
        })
        const header = {
          cwd: '/workspace',
          id: 'session',
          rootMessageId: 'root',
          timestamp: new Date().toISOString(),
          type: 'session' as const,
          version,
        }
        const parsed = parseSessionFile(
          [header, ...session.getEntries()].map((entry) => encodeSessionEntry(entry)).join(''),
          'fixture.jsonl',
        )
        expect(parsed.entries.find((entry) => entry.type === 'turn_context')).property('maxToolIterations', limit)
      })
    }
})
