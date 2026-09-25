// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import type {Model} from '../../../src/core/models/model.js'

import {Agent} from '../../../src/core/agent.js'
import {OrbitApplicationService} from '../../../src/core/application.js'
import {FileExecutionJournal, MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {DEFAULT_RUN_LIMITS, parseBudgetReason, parseRunLimits} from '../../../src/core/execution/limits.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'
import * as library from '../../../src/core/index.js'
import {MemorySessionLogStore} from '../../../src/core/logs/index.js'
import {Message, MessageType} from '../../../src/core/message/index.js'
import {getToolResult} from '../../../src/core/models/adapters/tools.js'
import {continueBudgetRun} from '../../../src/core/session/budget-continuation.js'
import {validateToolGroups} from '../../../src/core/session/compaction.js'
import {Session} from '../../../src/core/session/session.js'
import {tool} from '../../../src/core/tools/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

const user = () => new Message(MessageType.User, {content: 'Finish the task.'})
const call = (id = 'call') =>
  new Message(MessageType.Assistant, {payload: {toolCalls: [{id, input: {}, name: 'inspect'}]}})

async function create(rounds: number, limits = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-budget-agent-'))
  let invocations = 0
  let dispatches = 0
  const model: Model = {
    getModel: () => 'test',
    getName: () => 'model',
    getProvider: () => 'ollama',
    async invoke(messages) {
      validateToolGroups(messages)
      return invocations++ < rounds
        ? call(`call-${invocations}`)
        : new Message(MessageType.Assistant, {content: 'done'})
    },
  }
  const agent = new Agent({
    cwd: root,
    deps: {createModel: () => model},
    execution: {allowLegacyTools: true, limits, policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
    logStore: new MemorySessionLogStore(),
    tools: [
      tool(
        () => {
          dispatches++
          return 'read'
        },
        {description: 'Inspect a fixture.', name: 'inspect', schema: z.object({})},
      ),
    ],
  })
  return {
    agent,
    async close() {
      await agent.close()
      await fs.rm(root, {force: true, recursive: true})
    },
    dispatches: () => dispatches,
  }
}

async function legacyFixture(intent = false) {
  const session = new Session({formatVersion: 2, metadata: {id: 'legacy'}})
  session.recordTurnContext({cwd: '/tmp', maxToolIterations: 5, model: 'test', provider: 'ollama', turnId: 'old'})
  session.recordTurnEvent({phase: 'started', turnId: 'old'})
  session.appendMessages([user(), call()], {turnId: 'old'})
  session.recordTurnEvent({phase: 'cancelled', turnId: 'old'})
  const journal = new MemoryExecutionJournal('legacy')
  await journal.append('old', 'run-admitted', {
    level: 'memory',
    limits: DEFAULT_RUN_LIMITS,
    mode: 'memory',
    requestDigest: journal.digest('old'),
    requestId: 'old',
  })
  await journal.append('old', 'run-ready', {catalog: 'test'})
  if (intent) {
    await journal.append('old', 'operation-intent', {
      call: journal.digest('call'),
      operationId: 'operation',
      variant: 'tool-call',
    })
    await journal.append('old', 'operation-result', {operationId: 'operation', status: 'succeeded'})
  }

  await journal.append('old', 'run-terminal', {
    cleanupErrors: [],
    operations: intent ? [{id: 'operation', status: 'succeeded'}] : [],
    outcome: 'budget-exceeded',
    quiescence: true,
    reason: 'budget-exceeded',
    recording: {level: 'memory', mode: 'memory', status: 'acknowledged'},
    runId: 'old',
    sessionId: 'legacy',
    transcriptHighWater: session.getEntries().length,
    unresolved: [],
  })
  return {journal, session}
}

describe('execution budgets', () => {
  describe('coding budgets and continuation', () => {
    it('completes more than the former 100 tool rounds with unlimited defaults', async function () {
      this.timeout(10_000)
      const {agent, close, dispatches} = await create(110)
      try {
        const handle = await agent.startRun([user()])
        expect((await handle.finished).outcome).equal('completed')
        expect(dispatches()).equal(110)
        expect(handle.getSnapshot().limits).deep.equal(DEFAULT_RUN_LIMITS)
      } finally {
        await close()
      }
    })

    for (const key of ['toolRounds', 'toolRequests', 'modelCalls'] as const) {
      it(`continues in the same session after ${key} exhaustion without replaying tools`, async () => {
        const {agent, close, dispatches} = await create(3, {[key]: 1})
        try {
          const first = await agent.startRun([user()], {requestId: 'first'})
          const result = await first.finished
          expect(result.outcome).equal('budget-exceeded')
          expect(parseBudgetReason(result.reason)?.limitName).equal(key)
          validateToolGroups(agent.getSession().getConversationMessages())
          const before = JSON.stringify(agent.getSession().getEntries())
          const second = await agent.startRun([user()], {
            continueFromRunId: first.id,
            limits: {[key]: 10},
            requestId: 'second',
          })
          expect((await second.finished).outcome).equal('completed')
          expect(dispatches()).equal(key === 'modelCalls' ? 3 : 2)
          expect(JSON.stringify(agent.getSession().getEntries()).startsWith(before.slice(0, -1))).equal(true)
          expect((await first.finished).outcome).equal('budget-exceeded')
        } finally {
          await close()
        }
      })
    }

    it('keeps an explicit Agent iteration ceiling with otherwise unlimited defaults', async () => {
      const {agent, close, dispatches} = await create(5)
      try {
        const handle = await agent.startRun([user()], {maxToolIterations: 2})
        expect((await handle.finished).outcome).equal('budget-exceeded')
        expect(dispatches()).equal(2)
      } finally {
        await close()
      }
    })

    for (const parentLimit of ['unlimited', 2] as const) {
      it(`checks an unlimited Graph Agent override against parent ${parentLimit}`, async () => {
        const {agent, close} = await create(1)
        try {
          const graph = await library.compileProcessorGraph(
            {
              edges: [{from: 'agent', id: 'done', to: 'finished'}],
              entry: 'agent',
              id: 'unlimited',
              nodes: [{adapter: 'agent', configuration: {maxToolIterations: 'unlimited'}, id: 'agent'}],
              terminals: [{id: 'finished', outcome: 'completed'}],
            },
            [{id: 'agent', inputSchema: {}, kind: 'agent', outputSchema: {}, version: '1'}],
          )
          const handle = await agent.startGraphRun(graph, 'inspect', {maxToolIterations: parentLimit})
          expect((await handle.finished).outcome).equal(parentLimit === 'unlimited' ? 'completed' : 'failed')
        } finally {
          await close()
        }
      })
    }

    it('binds continuation and limits into request replay identity', async () => {
      const {agent, close} = await create(1, {toolRounds: 0})
      try {
        const messages = [user()]
        const first = await agent.startRun(messages, {requestId: 'same'})
        await first.finished
        const replay = await agent.startRun(messages, {requestId: 'same'})
        expect(replay.id).equal(first.id)
        for (const change of [{limits: {toolRounds: 10}}, {continueFromRunId: first.id}]) {
          let error: unknown
          try {
            // eslint-disable-next-line no-await-in-loop
            await agent.startRun(messages, {requestId: 'same', ...change})
          } catch (error_) {
            error = error_
          }

          expect(error).instanceOf(Error)
        }
      } finally {
        await close()
      }
    })

    it('exports the limit defaults, validation and exhaustion decoder', () => {
      expect(library.DEFAULT_RUN_LIMITS).equal(DEFAULT_RUN_LIMITS)
      expect(library.parseRunLimits).equal(parseRunLimits)
      expect(library.parseBudgetReason).equal(parseBudgetReason)
    })

    it('rejects unknown, fractional, nonfinite and timer-overflow limits', () => {
      for (const limits of [
        {typo: 1},
        {toolRounds: -1},
        {toolRounds: 1.5},
        {modelCalls: Infinity},
        {elapsedMs: 0},
        {elapsedMs: 2 ** 31},
      ])
        expect(() => parseRunLimits(limits)).to.throw('Invalid run limit')
      expect(parseBudgetReason('budget-exceeded')).equal(undefined)
    })
  })

  describe('legacy budget continuation evidence', () => {
    it('restores a legacy stop after server restart and continues through the application boundary', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-budget-restart-'))
      const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
      const session = repository.create({cwd: root, formatVersion: 2, id: 'legacy', model: 'test', provider: 'ollama'})
      const journal = await FileExecutionJournal.open('legacy', {
        lease: session.acquireWriterLease(),
        level: 'file-sync',
        root: repository.journalRoot,
      })
      session.recordTurnContext({cwd: root, maxToolIterations: 5, model: 'test', provider: 'ollama', turnId: 'old'})
      session.recordTurnEvent({phase: 'started', turnId: 'old'})
      session.appendMessages([user(), call()], {turnId: 'old'})
      session.recordTurnEvent({phase: 'cancelled', turnId: 'old'})
      await session.synchronize('file-sync')
      await journal.append('old', 'run-admitted', {
        level: 'file-sync',
        limits: DEFAULT_RUN_LIMITS,
        mode: 'file',
        requestDigest: journal.digest('old'),
        requestId: 'old',
      })
      await journal.append('old', 'run-ready', {catalog: 'test'})
      await journal.append('old', 'run-terminal', {
        cleanupErrors: [],
        operations: [],
        outcome: 'budget-exceeded',
        quiescence: true,
        reason: 'budget-exceeded',
        recording: {level: 'file-sync', mode: 'file', status: 'acknowledged'},
        runId: 'old',
        sessionId: 'legacy',
        transcriptHighWater: session.getEntries().length,
        unresolved: [],
      })
      const original = await fs.readFile(session.getFile()!, 'utf8')
      await journal.close()
      await session.close()
      let modelCalls = 0
      const service = new OrbitApplicationService({
        contexts: [],
        createAgent: (options) =>
          new Agent({
            ...options,
            deps: {
              createModel: () => ({
                getModel: () => 'test',
                getName: () => 'model',
                getProvider: () => 'ollama',
                async invoke(messages) {
                  modelCalls++
                  validateToolGroups(messages)
                  return new Message(MessageType.Assistant, {content: 'Continued without replay.'})
                },
              }),
            },
            logStore: new MemorySessionLogStore(),
          }),
        cwd: root,
        logStore: new MemorySessionLogStore(),
        model: 'test',
        provider: 'ollama',
        repository,
        settingsSources: [],
      })
      try {
        const restored = await service.resumeSession('legacy')
        expect(restored.run?.result?.outcome).equal('budget-exceeded')
        expect(service.getThread('legacy')?.run?.runId).equal('old')
        const completed = new Promise<void>((resolve, reject) => {
          const unsubscribe = service.subscribe((event) => {
            if (event.type === 'run.completed' || event.type === 'run.failed') {
              unsubscribe()
              if (event.type === 'run.failed') reject(new Error(JSON.stringify(event.data)))
              else resolve()
            }
          })
        })
        const next = await service.startRun('legacy', 'Continue the task.', {
          continueFromRunId: 'old',
          limits: {modelCalls: 90, toolRounds: 80},
          requestId: 'continue',
        })
        await completed
        expect(modelCalls).equal(1)
        expect(service.getRun(next.runId!)?.limits?.toolRounds).equal(80)
        expect((await fs.readFile(session.getFile()!, 'utf8')).startsWith(original)).equal(true)
      } finally {
        await service.close()
        await fs.rm(root, {force: true, recursive: true})
      }
    })

    for (const intent of [false, true])
      it(
        intent
          ? 'refuses missing output with an execution intent'
          : 'appends only verified nondispatch results without changing old evidence',
        async () => {
          const {journal, session} = await legacyFixture(intent)
          const prefix = JSON.stringify(session.getEntries())
          const old = JSON.stringify(journal.records())
          const release = session.acquireManagedLease()
          const supervisor = new RunSupervisor()
          try {
            const handle = await supervisor.startRun({
              configuration: {},
              async execute(run) {
                await continueBudgetRun(session, run, 'old')
              },
              input: {},
              journal: async () => journal,
              requestId: 'new',
              sessionId: 'legacy',
            })
            expect((await handle.finished).outcome).equal(intent ? 'failed' : 'completed')
            expect(JSON.stringify(session.getEntries()).startsWith(prefix.slice(0, -1))).equal(true)
            expect(JSON.stringify(journal.records()).startsWith(old.slice(0, -1))).equal(true)
            if (intent) {
              expect(JSON.stringify(session.getEntries())).equal(prefix)
            } else {
              validateToolGroups(session.getConversationMessages())
              expect(getToolResult(session.getConversationMessages().at(-1)!)?.isError).equal(true)
            }
          } finally {
            release()
            await journal.close()
            await session.close()
          }
        },
      )

    it('refuses stale continuation after another message without mutating history', async () => {
      const {journal, session} = await legacyFixture()
      session.appendMessages([user()])
      const before = JSON.stringify(session.getEntries())
      const release = session.acquireManagedLease()
      try {
        const handle = await new RunSupervisor().startRun({
          configuration: {},
          async execute(run) {
            await continueBudgetRun(session, run, 'old')
          },
          input: {},
          journal: async () => journal,
          requestId: 'new',
          sessionId: 'legacy',
        })
        expect((await handle.finished).outcome).equal('failed')
        expect(JSON.stringify(session.getEntries())).equal(before)
      } finally {
        release()
        await journal.close()
        await session.close()
      }
    })
  })
})
