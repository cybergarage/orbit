// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {CompactionAlgorithmServices} from '../../../src/core/session/compaction-algorithm.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'
import {Message, MessageType} from '../../../src/core/message/index.js'
import {structuredSummaryAlgorithm} from '../../../src/core/session/compaction-algorithm.js'
import {budgetedCompactionStrategy} from '../../../src/core/session/compaction-strategy.js'
import {persistedContextMessage} from '../../../src/core/session/compaction.js'
import {SessionContextBuilder} from '../../../src/core/session/context-builder.js'
import {ContextBudgetError} from '../../../src/core/session/context-error.js'
import {
  ContextBudgetError as ExistingContextBudgetError,
  prepareSessionContext,
} from '../../../src/core/session/context-policy.js'
import {Session} from '../../../src/core/session/session.js'

describe('Internal compaction components', () => {
  it('preserves the existing error constructor across the extraction', () => {
    expect(ExistingContextBudgetError).to.equal(ContextBudgetError)
  })

  it('keeps threshold and hard-limit recovery triggers independent of summarization', () => {
    expect(budgetedCompactionStrategy.shouldCompact({recovery: false, tokens: 99, trigger: 100})).to.equal(false)
    expect(budgetedCompactionStrategy.shouldCompact({recovery: false, tokens: 100, trigger: 100})).to.equal(true)
    expect(budgetedCompactionStrategy.shouldCompact({recovery: true, tokens: 1, trigger: 100})).to.equal(true)
  })

  it('retains the protected turn without requiring a model or algorithm', () => {
    const all = [
      new Message(MessageType.User, {content: 'Old task'}),
      new Message(MessageType.Assistant, {content: 'Old result'}),
      new Message(MessageType.User, {content: 'Continue'}),
    ]
    const plan = budgetedCompactionStrategy.plan({
      all,
      entries: [],
      estimateRetained: () => 10,
      graphVisit: false,
      previousCut: 0,
      protectedMessageId: all[2].id,
      target: 100,
    })
    expect(plan).to.deep.equal({cut: 2, retained: []})
    expect(all.map((message) => message.content)).to.deep.equal(['Old task', 'Old result', 'Continue'])
  })

  it('summarizes selected evidence through services without Session or Run access', async () => {
    const source = new Message(MessageType.User, {content: 'Repair the test'})
    const summary = {
      changedPaths: [],
      facts: [],
      goals: [{sourceIds: [source.id], text: 'Repair the test'}],
      tests: [],
      uncertainties: [],
      unfinished: [],
      version: 1 as const,
    }
    const prompts: string[] = []
    let calls = 0
    const services: CompactionAlgorithmServices = {
      calls: {
        check() {},
        async invoke(request) {
          calls++
          return request.invoke()
        },
      },
      diagnostic() {},
      estimate: () => 1,
      hasVerifiedProjection: false,
      prepare(messages, outputLimit) {
        prompts.push(messages[0].content)
        expect(outputLimit).to.be.undefined
        return {
          async invoke() {
            return new Message(MessageType.Assistant, {content: JSON.stringify(summary)})
          },
          request: {},
        }
      },
      profile: {
        model: 'fixture',
        outputReserve: 1000,
        provider: 'fixture',
        revision: 'v1',
        safetyMargin: 100,
        summaryOutput: 800,
        target: 1500,
        templateOverhead: 0,
        trigger: 2000,
        window: 20_000,
      },
    }
    const result = await structuredSummaryAlgorithm.summarize(
      services,
      [source],
      [persistedContextMessage(source)],
      null,
    )
    expect(result.summary).to.deep.equal(summary)
    expect(calls).to.equal(1)
    expect(prompts[0]).to.include('ORIGINAL_SOURCE_IDS: ' + JSON.stringify([source.id]))
    expect(prompts[0]).to.include('OUTPUT_TOKEN_BUDGET: 800')
  })

  describe('Compaction component composition', () => {
    for (const cut of [2, 4]) {
      for (const algorithmName of ['C', 'D']) {
        it(`composes cut ${cut} with algorithm ${algorithmName} and replays the stored projection`, async () => {
          const session = new Session()
          session.appendMessages([
            new Message(MessageType.User, {content: 'Old input ' + 'x'.repeat(3000)}),
            new Message(MessageType.Assistant, {content: 'Observed result'}),
            new Message(MessageType.User, {content: 'Follow-up'}),
            new Message(MessageType.Assistant, {content: 'Follow-up result'}),
            new Message(MessageType.User, {content: 'Continue'}),
          ])
          const release = session.acquireManagedLease()
          const supervisor = new RunSupervisor()
          let algorithmCalls = 0
          try {
            const handle = await supervisor.startRun({
              configuration: {},
              async execute(run) {
                await run.ready([])
                return prepareSessionContext(
                  {
                    model: {
                      getModel: () => 'fixture',
                      getName: () => 'fixture',
                      getProvider: () => 'fixture',
                      async invoke() {
                        throw new Error('Unexpected inference')
                      },
                      prepare(messages) {
                        return {
                          async invoke() {
                            throw new Error('Unexpected inference')
                          },
                          request: {messages: messages.map((message) => message.content)},
                        }
                      },
                    },
                    modelOptions: {},
                    policy: {
                      estimator(request) {
                        const tokens = JSON.stringify(request).length
                        return {
                          components: {json: tokens},
                          kind: 'estimated',
                          model: 'fixture',
                          provider: 'fixture',
                          revision: 'v1',
                          tokens,
                        }
                      },
                      mode: 'budgeted',
                      profile: {
                        model: 'fixture',
                        outputReserve: 100,
                        provider: 'fixture',
                        revision: 'v1',
                        safetyMargin: 100,
                        summaryOutput: 100,
                        target: 1000,
                        templateOverhead: 0,
                        trigger: 2000,
                        window: 20_000,
                      },
                    },
                    prefix: [],
                    run,
                    session,
                  },
                  {
                    algorithm: {
                      id: algorithmName,
                      async summarize(_services, eligible, originals, previous) {
                        algorithmCalls++
                        expect(eligible).to.have.length(cut)
                        expect(previous).to.be.null
                        return {
                          summary: {
                            changedPaths: [],
                            facts: [],
                            goals: [{sourceIds: [originals[0].id], text: algorithmName}],
                            tests: [],
                            uncertainties: [],
                            unfinished: [],
                            version: 1,
                          },
                        }
                      },
                      summarySchema: 'context-summary-v1',
                      supportsCumulativeUpdates: true,
                    },
                    strategy: {...budgetedCompactionStrategy, id: `cut-${cut}`, plan: () => ({cut, retained: []})},
                  },
                )
              },
              input: {},
              journal: async () => new MemoryExecutionJournal(session.getId()),
              requestId: `pair-${cut}-${algorithmName}`,
              sessionId: session.getId(),
            })
            expect((await handle.finished).outcome).to.equal('completed')
            const prepared = handle.value()!
            const replay = new SessionContextBuilder().build(session)
            expect(replay.messages.map((message) => message.content)).to.deep.equal(prepared.request.messages)
            expect(session.getCompaction()?.firstRetainedId).to.equal(session.getConversationMessages()[cut].id)
            expect(algorithmCalls).to.equal(1)
          } finally {
            release()
            await supervisor.close()
            await session.close()
          }
        })
      }
    }
  })
})
