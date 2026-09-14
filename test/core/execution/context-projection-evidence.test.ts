// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {Agent, MemorySessionLogStore, Message, MessageType, Session, State} from '../../../src/core/index.js'
import {persistedContextMessage, sourceDigest} from '../../../src/core/session/compaction.js'

async function evidenceFixture(count = 1) {
  const session = new Session({formatVersion: 3})
  session.recordTurnContext({
    cwd: process.cwd(),
    maxToolIterations: 2,
    model: 'fixed',
    provider: 'ollama',
    turnId: 'old',
  })
  session.recordTurnEvent({phase: 'started', turnId: 'old'})
  session.appendMessages([new Message(MessageType.User, {content: 'old'})], {turnId: 'old'})
  session.appendMessages(
    [
      new Message(MessageType.Assistant, {
        payload: {
          toolCalls: Array.from({length: count}, (_, i) => ({
            id: count === 1 ? 'missing' : 'missing-' + i,
            input: {},
            name: 'write',
          })),
        },
      }),
    ],
    {turnId: 'old'},
  )
  session.recordTurnEvent({phase: 'cancelled', turnId: 'old'})
  const journal = new MemoryExecutionJournal(session.getId(), session.acquireManagedLease())
  await journal.append('old', 'run-admitted', {
    level: 'memory',
    mode: 'memory',
    requestDigest: journal.digest('old'),
    requestId: 'old',
  })
  await journal.append('old', 'run-ready', {catalog: 'fixed'})
  await journal.append('old', 'run-terminal', {
    cleanupErrors: [],
    operations: [],
    outcome: 'cancelled',
    quiescence: true,
    recording: {status: 'acknowledged'},
    transcriptHighWater: session.getEntries().length,
    unresolved: [],
  })
  return {journal, session}
}

describe('verified context evidence refusal and ownership', () => {
  for (const count of [128, 129])
    it('checks producer call boundary ' + count, async () => {
      const {journal, session} = await evidenceFixture(count)
      const store = new MemorySessionLogStore()
      let calls = 0
      const agent = new Agent({
        deps: {
          createModel: () => ({
            getModel: () => 'fixed',
            getName: () => 'fixed',
            getProvider: () => 'ollama',
            async invoke() {
              throw new Error('legacy')
            },
            prepare() {
              return {
                async invoke() {
                  calls++
                  return new Message(MessageType.Assistant, {content: 'fixed'})
                },
                request: {},
              }
            },
          }),
        },
        execution: {journalFactory: async () => journal},
        interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
        logStore: store,
        settings: {model: 'fixed', provider: 'ollama'},
        state: new State(session),
        toolProfile: 'none',
      })
      try {
        const result = await (await agent.startRun([new Message(MessageType.User, {content: 'continue'})])).finished
        expect(result.outcome === 'completed').equal(count === 128)
        expect(calls).equal(count === 128 ? 1 : 0)
      } finally {
        await agent.close()
        await store.close()
      }
    })

  for (const fault of ['missing', 'torn', 'unknown', 'lost-output', 'raw-change', 'disabled'] as const)
    it('does not invoke a model for ' + fault, async () => {
      const {journal, session} = await evidenceFixture()
      const store = new MemorySessionLogStore()
      let invoked = 0
      let prepared = 0
      let managers = 0
      let reads = 0
      const read = journal.verifyContextEvidence.bind(journal)
      journal.verifyContextEvidence = async (limit) => {
        reads++
        const records = await read(limit)
        if (fault === 'missing') return records.filter((r) => r.runId !== 'old')
        if (fault === 'torn') throw new Error('Torn context evidence')
        if (fault === 'unknown') records.find((r) => r.kind === 'run-terminal')!.data.quiescence = false
        if (fault === 'lost-output') {
          const terminal = records.findIndex((r) => r.kind === 'run-terminal')
          const base = records[terminal]
          records.splice(
            terminal,
            0,
            {
              ...base,
              data: {call: journal.digest('missing'), operationId: 'op', variant: 'tool-call'},
              eventId: 'intent',
              kind: 'operation-intent',
            },
            {
              ...base,
              data: {operationId: 'op', status: 'succeeded'},
              eventId: 'result',
              kind: 'operation-result',
              sequence: base.sequence + 1,
            },
          )
          records[terminal + 2] = {...base, sequence: base.sequence + 2}
        }

        return records
      }

      const agent = new Agent({
        deps: {
          createMcpToolManager() {
            managers++
            return {async close() {}, getTools: async () => []} as never
          },
          createModel: () => ({
            getModel: () => 'fixed',
            getName: () => 'fixed',
            getProvider: () => 'ollama',
            async invoke() {
              throw new Error('legacy path')
            },
            prepare() {
              prepared++
              if (fault === 'raw-change') session.getConversationMessages()[0].contents[0] = 'mutated'
              return {
                async invoke() {
                  invoked++
                  return new Message(MessageType.Assistant, {content: 'fixed'})
                },
                request: {},
              }
            },
          }),
        },
        execution: {journalFactory: async () => journal},
        interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
        logStore: store,
        settings: {mcp: {servers: {}}, model: 'fixed', provider: 'ollama'},
        state: new State(session),
        toolProfile: 'none',
      })
      try {
        const input = [new Message(MessageType.User, {content: 'continue', id: 'new'})]
        const first = await agent.startRun(input, {requestId: 'new'})
        const result = await first.finished
        if (fault === 'disabled') {
          expect(result.outcome).equal('completed')
          const before = invoked
          // Projection dependence must refuse even without budgets when the policy is turned off.
          const disabled = new Agent({
            deps: {
              createModel: () => ({
                getModel: () => 'fixed',
                getName: () => 'fixed',
                getProvider: () => 'ollama',
                async invoke() {
                  invoked++
                  return new Message(MessageType.Assistant, {content: 'bad'})
                },
              }),
            },
            execution: {journalFactory: async () => journal},
            logStore: store,
            settings: {model: 'fixed', provider: 'ollama'},
            state: new State(session),
            toolProfile: 'none',
          })
          const rejected = await (await disabled.startRun([new Message(MessageType.User, {content: 'off'})])).finished
          expect(rejected.outcome).not.equal('completed')
          expect(invoked).equal(before)
          await disabled.close()
        } else {
          expect(result.outcome).not.equal('completed')
          expect(invoked).equal(0)
          if (fault !== 'raw-change') {
            expect(prepared).equal(0)
            expect(managers).equal(0)
          }

          const readCount = reads
          const replay = await agent.startRun(input, {requestId: 'new'})
          expect(replay.id).equal(first.id)
          expect(reads).equal(readCount)
        }
      } finally {
        await agent.close()
        await store.close()
      }
    })

  it('owns unfinished evidence I/O after cancellation and never dispatches', async () => {
    const {journal, session} = await evidenceFixture()
    const store = new MemorySessionLogStore()
    let enter!: () => void
    let release!: () => void
    let settle!: () => void
    let invoked = 0
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = journal.verifyContextEvidence.bind(journal)
    journal.verifyContextEvidence = async (limit) => {
      enter()
      await pending
      return read(limit)
    }

    const agent = new Agent({
      deps: {
        createModel: () => ({
          getModel: () => 'fixed',
          getName: () => 'fixed',
          getProvider: () => 'ollama',
          async invoke() {
            throw new Error('legacy')
          },
          prepare() {
            invoked++
            return {
              async invoke() {
                return new Message(MessageType.Assistant)
              },
              request: {},
            }
          },
        }),
      },
      execution: {journalFactory: async () => journal, limits: {cleanupMs: 20}},
      interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
      logStore: store,
      settings: {model: 'fixed', provider: 'ollama'},
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const raw = sourceDigest(session.getConversationMessages().map((message) => persistedContextMessage(message)))
      const handle = await agent.startRun([new Message(MessageType.User, {content: 'continue'})], {
        onRunSnapshot(s) {
          if (s.result && s.unresolved.length === 0) settle()
        },
      })
      await entered
      handle.requestStop('user')
      const result = await handle.finished
      expect(result.quiescence).equal(false)
      expect(result.unresolved.some((name) => name.startsWith('context-evidence'))).equal(true)
      expect(session.hasManagedLease()).equal(true)
      expect(invoked).equal(0)
      expect(sourceDigest(session.getConversationMessages().map((message) => persistedContextMessage(message)))).equal(
        raw,
      )
      release()
      await settled
      await agent.supervisor.reconcileRun(handle.id, {confirmedStopped: true, operations: []})
      expect(handle.getSnapshot().result).deep.equal(result)
    } finally {
      release()
      await agent.close()
      await store.close()
    }
  })
})
