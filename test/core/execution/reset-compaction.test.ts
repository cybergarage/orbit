// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {ContextPolicy, Model, ModelInvokeOptions} from '../../../src/core/index.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'
import {
  Agent,
  compileProcessorGraph,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  SessionContextBuilder,
  SessionRepository,
  State,
} from '../../../src/core/index.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'
import {
  checkpointSuffix,
  type SessionCompactionEntry,
  validateCompactionEntries,
} from '../../../src/core/session/compaction.js'
import {prepareSessionContext} from '../../../src/core/session/context-policy.js'

const profile = {
  model: 'fixture',
  outputReserve: 2000,
  provider: 'ollama',
  revision: 'reset-test',
  safetyMargin: 100,
  summaryOutput: 1500,
  target: 8000,
  templateOverhead: 0,
  trigger: 10_000,
  window: 50_000,
}
function policy(strategy: string, algorithm = 'handoff-summary-v1'): Extract<ContextPolicy, {mode: 'budgeted'}> {
  return {
    algorithm,
    estimator(request) {
      const tokens = JSON.stringify(request).length
      return {
        components: {json: tokens},
        kind: 'estimated',
        model: 'fixture',
        provider: 'ollama',
        revision: 'chars-v1',
        tokens,
      }
    },
    mode: 'budgeted',
    profile,
    strategy,
  }
}

function seed(session: Session): void {
  session.appendMessages([
    new Message(MessageType.User, {content: 'Fix the parser; retain the public API.'}),
    new Message(MessageType.Assistant, {content: 'Observed investigation detail ' + 'x'.repeat(12_000)}),
    new Message(MessageType.User, {content: 'Also verify malformed input.'}),
  ])
}

function fixture(
  session: Session,
  options: {actions?: number; invalid?: boolean; multi?: boolean; onSummary?: () => void} = {},
) {
  const workerInputs: Message[][] = []
  const summaryInputs: string[] = []
  let actions = 0
  const model: Model = {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'ollama',
    async invoke() {
      throw new Error('Expected prepared input')
    },
    prepare(messages, invocation?: Partial<ModelInvokeOptions>) {
      const summary = messages[0]?.content.startsWith('Summarize')
      const request = {
        maxOutputTokens: invocation?.maxOutputTokens,
        messages: messages.map((m) => ({content: m.content, id: m.id, payload: m.payload, type: m.type})),
      }
      return {
        async invoke() {
          if (summary) {
            summaryInputs.push(messages[0].content)
            expect(invocation?.tools).to.deep.equal([])
            expect(invocation?.maxOutputTokens).to.equal(profile.summaryOutput)
            options.onSummary?.()
            const content = options.invalid
              ? 'not json'
              : JSON.stringify({
                  changedPaths: [],
                  facts: [],
                  goals: [
                    {
                      sourceIds: [session.getConversationMessages()[0].id],
                      text: 'Fix the parser and verify malformed input.',
                    },
                  ],
                  tests: [],
                  uncertainties: [],
                  unfinished: [],
                  version: 1,
                })
            return new Message(MessageType.Assistant, {content})
          }

          workerInputs.push(messages)
          if (actions++ < (options.actions ?? 0)) {
            const calls = [{id: `read-${actions}`, input: {path: 'orbit-reset-nonexistent-fixture.txt'}, name: 'read'}]
            if (options.multi) calls.push({...calls[0], id: 'second-read'})
            return new Message(MessageType.Assistant, {payload: {toolCalls: calls}})
          }

          return new Message(MessageType.Assistant, {content: 'Done'})
        },
        request,
      }
    },
  }
  return {model, summaryInputs, workerInputs}
}

async function runAgent(session: Session, selected: ContextPolicy, model: Model, single = true, maxCalls = 20) {
  const logs = new MemorySessionLogStore()
  const agent = new Agent({
    contextPolicy: selected,
    cwd: os.tmpdir(),
    deps: {createModel: () => model},
    execution: {limits: {modelCalls: maxCalls}},
    logStore: logs,
    messages: [
      new Message(MessageType.User, {content: 'Follow the canonical task and authorization policy.', role: 'system'}),
    ],
    settings: {executionActionMode: single ? 'single' : 'multiple'},
    state: new State(session),
    toolProfile: 'coding',
  })
  try {
    const handle = await agent.startRun([new Message(MessageType.User, {content: 'Continue.'})])
    return await handle.finished
  } finally {
    await agent.close()
    await logs.close()
  }
}

function restored(session: Session): Session {
  return new Session({
    entries: session.getEntries(),
    formatVersion: session.formatVersion,
    messages: session.getConversationMessages(),
    metadata: session.getMetadata(),
  })
}

describe('Reset compaction', () => {
  for (const strategy of ['eocc-v1', 'sac-v1']) {
    for (const algorithm of ['structured-summary-v1', 'handoff-summary-v1']) {
      it(`composes ${strategy} with ${algorithm} and replays an empty raw suffix`, async () => {
        const session = new Session()
        seed(session)
        const f = fixture(session)
        expect((await runAgent(session, policy(strategy, algorithm), f.model)).outcome).to.equal('completed')
        expect(f.summaryInputs).to.have.length(1)
        const checkpoint = session.getCompaction()!
        expect(checkpoint.projectionVersion).to.equal(4)
        expect(checkpoint.firstRetainedId).to.be.null
        expect(checkpoint.prefixEndId).to.equal(checkpoint.sourceHeadId)
        expect(checkpoint.components?.strategy.id).to.equal(strategy)
        expect(checkpoint.components?.algorithm.id).to.equal(algorithm)
        expect(f.workerInputs[0].some((m) => m.content.includes('Observed investigation detail'))).to.equal(false)
        for (const instruction of [
          'Fix the parser; retain the public API.',
          'Also verify malformed input.',
          'Continue.',
        ])
          expect(f.workerInputs[0].filter((m) => m.content === instruction)).to.have.length(1)
        const replay = restored(session)
        expect(new SessionContextBuilder().build(replay).messages.map((m) => m.content)).to.deep.equal([
          ...f.workerInputs[0].slice(2).map((m) => m.content),
          'Done',
        ])
        expect(f.summaryInputs).to.have.length(1)
        await replay.close()
      })
    }
  }

  it('resets after each single action even below the threshold', async () => {
    const session = new Session()
    const f = fixture(session, {actions: 2})
    expect((await runAgent(session, policy('sac-v1'), f.model)).outcome).to.equal('completed')
    expect(f.workerInputs).to.have.length(3)
    expect(f.summaryInputs).to.have.length(2)
    for (const input of f.workerInputs.slice(1)) {
      expect(input.some((m) => m.type === MessageType.Tool)).to.equal(false)
      expect(input.some((m) => m.payload && typeof m.payload === 'object' && 'toolCalls' in m.payload)).to.equal(false)
    }

    const checkpoints = session.getEntries().filter((e) => e.type === 'compaction')
    expect(checkpoints).to.have.length(2)
    expect(checkpoints[1].previousId).to.equal(checkpoints[0].id)
    expect(f.summaryInputs[1]).to.contain('HANDOFF:')
    const source = JSON.parse(f.summaryInputs[1].split('\nSOURCE: ')[1])
    expect(source.previous.version).to.equal(1)
    expect(source.messages).to.have.length(2)
    const allowed = JSON.parse(f.summaryInputs[1].split('\nORIGINAL_SOURCE_IDS: ')[1].split('\nSOURCE: ')[0])
    expect(allowed).to.have.length(3)
    expect(
      source.messages.some((message: {content?: string; contents: string[]}) =>
        message.contents.join('').startsWith('Untrusted conversation checkpoint'),
      ),
    ).to.equal(false)
  })

  it('allows a bounded SAC state update to grow for a tiny action', async () => {
    const session = new Session()
    const f = fixture(session, {actions: 1})
    const selected = policy('sac-v1')
    selected.estimator = (request) => {
      const tokens = JSON.stringify(request).includes('Untrusted conversation checkpoint') ? 1000 : 500
      return {
        components: {fixed: tokens},
        kind: 'estimated',
        model: 'fixture',
        provider: 'ollama',
        revision: 'fixed',
        tokens,
      }
    }

    expect((await runAgent(session, selected, f.model)).outcome).to.equal('completed')
    expect(session.getCompaction()!.afterTokens).to.be.greaterThan(session.getCompaction()!.beforeTokens)
    expect(() => restored(session)).not.to.throw()
  })

  it('does not reset below the EoCC threshold', async () => {
    const session = new Session()
    const f = fixture(session, {actions: 1})
    expect((await runAgent(session, policy('eocc-v1'), f.model)).outcome).to.equal('completed')
    expect(f.summaryInputs).to.have.length(0)
    expect(f.workerInputs[1].some((m) => m.type === MessageType.Tool)).to.equal(true)
  })

  it('rejects single-action Graph runs before invoking any node', async () => {
    const logs = new MemorySessionLogStore()
    const session = new Session()
    let calls = 0
    const graph = await compileProcessorGraph(
      {
        edges: [{from: 'first', id: 'finish', to: 'done'}],
        entry: 'first',
        id: 'single-mode-graph',
        nodes: [{adapter: 'copy', id: 'first'}],
        terminals: [{id: 'done', outcome: 'completed'}],
      },
      [
        {
          id: 'copy',
          inputSchema: {},
          invoke(input) {
            calls++
            return input
          },
          kind: 'transform',
          outputSchema: {},
          version: '1.0',
        },
      ],
    )
    const agent = new Agent({
      cwd: os.tmpdir(),
      deps: {createModel: () => fixture(session).model},
      logStore: logs,
      settings: {executionActionMode: 'single'},
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      let error: unknown
      try {
        await agent.startGraphRun(graph, 'input')
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('Single-action mode does not support processor graphs')
      expect(calls).to.equal(0)
    } finally {
      await agent.close()
      await logs.close()
    }
  })

  it('rejects SAC without single-action mode before any model call', async () => {
    const session = new Session()
    const f = fixture(session)
    let error: unknown
    try {
      await runAgent(session, policy('sac-v1'), f.model, false)
    } catch (error_) {
      error = error_
    }

    expect(String(error)).to.include('SAC requires executionActionMode single')
    expect(f.workerInputs).to.have.length(0)
  })

  for (const selected of [policy('sac-v1'), policy('eocc-v1'), {mode: 'disabled'} as ContextPolicy]) {
    it(`rejects multi-action responses before dispatch with ${selected.mode === 'budgeted' ? selected.strategy : 'disabled'}`, async () => {
      const session = new Session()
      const f = fixture(session, {actions: 1, multi: true})
      expect((await runAgent(session, selected, f.model)).outcome).to.equal('failed')
      expect(session.getConversationMessages().some((m) => m.type === MessageType.Tool)).to.equal(false)
      expect(
        session
          .getConversationMessages()
          .some((m) => m.payload && typeof m.payload === 'object' && 'toolCalls' in m.payload),
      ).to.equal(false)
      expect(f.summaryInputs).to.have.length(0)
    })
  }

  for (const strategy of ['eocc-v1', 'sac-v1']) {
    it(`fails ${strategy} without full-history fallback on an invalid handoff`, async () => {
      const session = new Session()
      seed(session)
      const f = fixture(session, {invalid: true})
      expect((await runAgent(session, policy(strategy), f.model)).outcome).to.equal('failed')
      expect(f.workerInputs).to.have.length(0)
      expect(session.getCompaction()).to.be.undefined
    })
  }

  it('charges summary calls to the shared Run allowance', async () => {
    const session = new Session()
    const f = fixture(session, {actions: 2})
    expect((await runAgent(session, policy('sac-v1'), f.model, true, 1)).outcome).to.equal('budget-exceeded')
    expect(f.workerInputs).to.have.length(1)
    expect(f.summaryInputs).to.have.length(0)
    expect(session.getCompaction()).to.be.undefined
  })

  it('rejects changed source before activating a reset checkpoint', async () => {
    const session = new Session()
    seed(session)
    const f = fixture(session, {
      onSummary() {
        session.appendMessages([new Message(MessageType.User, {content: 'New constraint'})])
      },
    })
    expect((await runAgent(session, policy('eocc-v1'), f.model)).outcome).to.equal('failed')
    expect(f.workerInputs).to.have.length(0)
    expect(session.getCompaction()).to.be.undefined
  })

  it('fails an oversized handoff input before invoking its summary model', async () => {
    const session = new Session()
    seed(session)
    const f = fixture(session)
    const selected = policy('eocc-v1')
    selected.profile = {...profile, window: 16_000}
    session.appendMessages([new Message(MessageType.Assistant, {content: 'x'.repeat(20_000)})])
    expect((await runAgent(session, selected, f.model)).outcome).to.equal('failed')
    expect(f.summaryInputs).to.have.length(0)
    expect(f.workerInputs).to.have.length(0)
  })

  it('resumes a pending SAC recap without redispatching the completed action', async () => {
    const session = new Session()
    const first = fixture(session, {actions: 1})
    expect((await runAgent(session, policy('sac-v1'), first.model, true, 1)).outcome).to.equal('budget-exceeded')
    const resumed = restored(session)
    const second = fixture(resumed)
    expect((await runAgent(resumed, policy('sac-v1'), second.model)).outcome).to.equal('completed')
    expect(second.summaryInputs).to.have.length(1)
    expect(second.workerInputs[0].some((m) => m.type === MessageType.Tool)).to.equal(false)
    expect(resumed.getConversationMessages().filter((m) => m.type === MessageType.Tool)).to.have.length(1)
  })

  it('replays saved state after changing to the legacy strategy and another algorithm', async () => {
    const session = new Session()
    seed(session)
    const first = fixture(session)
    await runAgent(session, policy('eocc-v1'), first.model)
    const resumed = restored(session)
    const second = fixture(resumed)
    expect(
      (await runAgent(resumed, policy('budgeted-suffix-v1', 'structured-summary-v1'), second.model)).outcome,
    ).to.equal('completed')
    expect(second.summaryInputs).to.have.length(0)
    expect(second.workerInputs[0].some((m) => m.content === 'Fix the parser; retain the public API.')).to.equal(true)
  })

  it('validates reset provenance, consumed boundary, schema, task references and digest on replay', async () => {
    const session = new Session()
    seed(session)
    await runAgent(session, policy('eocc-v1'), fixture(session).model)
    const original = session.getEntries()
    const index = original.findIndex((e) => e.type === 'compaction')
    const edits: ((e: SessionCompactionEntry) => void)[] = [
      (e) => {
        e.firstRetainedId = e.sourceHeadId
      },
      (e) => {
        e.prefixEndId = 'absent'
      },
      (e) => {
        e.sourceDigest = '0'.repeat(64)
      },
      (e) => {
        e.retainedUserIds!.pop()
      },
      (e) => {
        Object.assign(e.components!, {summarySchema: 'unknown'})
      },
      (e) => {
        Object.assign(e.components!.strategy, {revision: 2})
      },
      (e) => {
        e.components!.algorithm.parameters.summaryOutput = -1
      },
      (e) => {
        Object.assign(e, {projectionVersion: 99})
      },
    ]
    for (const edit of edits) {
      const entries = structuredClone(original)
      edit(entries[index] as SessionCompactionEntry)
      expect(() => validateCompactionEntries(entries, session.getId(), 2)).to.throw(/checkpoint|compaction/i)
    }

    const unknownProducer = structuredClone(original)
    const checkpoint = unknownProducer[index]
    if (checkpoint.type !== 'compaction') throw new Error('Missing fixture checkpoint')
    checkpoint.components!.algorithm.id = 'historical-implementation'
    expect(() => validateCompactionEntries(unknownProducer, session.getId(), 2)).not.to.throw()
    const raw =
      [
        {
          cwd: '/fixture',
          id: session.getId(),
          rootMessageId: session.getMetadata().rootMessageId,
          timestamp: new Date().toISOString(),
          type: 'session',
          version: 2,
        },
        ...original,
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    expect(() => parseSessionFile(raw, 'fixture.jsonl')).not.to.throw()
    expect(() => parseSessionFile(raw.replace('"version":2', '"version":1'), 'fixture.jsonl')).to.throw(
      'Invalid checkpoint boundary or predecessor',
    )
  })

  it('does not leak derived results after a consumed canonical head', async () => {
    const session = new Session()
    seed(session)
    await runAgent(session, policy('eocc-v1'), fixture(session).model)
    const checkpoint = session.getCompaction()!
    const source = session.getConversationMessages()
    const consumed = source.slice(0, source.findIndex((m) => m.id === checkpoint.prefixEndId) + 1)
    const synthetic = new Message(MessageType.Tool, {content: 'Verified nondispatch', parentid: checkpoint.prefixEndId})
    expect(checkpointSuffix(checkpoint, consumed, [...consumed, synthetic])).to.deep.equal([])
    const next = new Message(MessageType.User, {content: 'Next task'})
    expect(checkpointSuffix(checkpoint, [...consumed, next], [...consumed, synthetic, next])).to.deep.equal([next])
  })

  it('does not activate a reset after a failed durable commit', async () => {
    const session = new Session()
    seed(session)
    session.commitCompaction = async () => {
      throw new Error('Injected save failure')
    }

    const snapshot = await runAgent(session, policy('eocc-v1'), fixture(session).model)
    expect(snapshot.outcome).to.equal('failed')
    expect(snapshot.recording.status).not.to.equal('acknowledged')
    expect(session.getCompaction()).to.be.undefined
  })

  it('persists reset checkpoints and reopens them without a summary model', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-reset-file-')))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    repository.initializeStorage({
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    })
    try {
      const session = repository.create({cwd: root, formatVersion: 2, id: 'reset-persisted'})
      seed(session)
      const f = fixture(session)
      expect((await runAgent(session, policy('eocc-v1'), f.model)).outcome).to.equal('completed')
      await session.close()
      const reopened = repository.open(session.getFile()!)
      try {
        expect(reopened.getCompaction()?.projectionVersion).to.equal(4)
        expect(new SessionContextBuilder().build(reopened).messages.map((m) => m.content)).to.deep.equal([
          ...f.workerInputs[0].slice(2).map((m) => m.content),
          'Done',
        ])
        expect(f.summaryInputs).to.have.length(1)
      } finally {
        await reopened.close()
      }
    } finally {
      fs.rmSync(root, {force: true, recursive: true})
    }
  })

  it('does not activate a reset when cancelled during its handoff', async () => {
    const session = new Session()
    seed(session)
    const release = session.acquireManagedLease()
    const supervisor = new RunSupervisor()
    try {
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          return prepareSessionContext({
            model: fixture(session, {onSummary: () => run.requestStop('user')}).model,
            modelOptions: {},
            policy: policy('eocc-v1'),
            prefix: [],
            run,
            session,
          })
        },
        input: {},
        journal: async () => new MemoryExecutionJournal(session.getId()),
        requestId: 'reset-cancel',
        sessionId: session.getId(),
      })
      expect((await handle.finished).outcome).to.equal('cancelled')
      expect(session.getCompaction()).to.be.undefined
    } finally {
      release()
      await supervisor.close()
      await session.close()
    }
  })

  it('requires strict size reduction for reset recovery', async () => {
    const session = new Session()
    seed(session)
    const release = session.acquireManagedLease()
    const supervisor = new RunSupervisor()
    const selected = policy('eocc-v1')
    selected.estimator = () => ({
      components: {fixed: 100},
      kind: 'estimated',
      model: 'fixture',
      provider: 'ollama',
      revision: 'fixed',
      tokens: 100,
    })
    try {
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          return prepareSessionContext({
            model: fixture(session).model,
            modelOptions: {},
            policy: selected,
            prefix: [],
            recoveryRequest: {},
            run,
            session,
          })
        },
        input: {},
        journal: async () => new MemoryExecutionJournal(session.getId()),
        requestId: 'reset-recovery',
        sessionId: session.getId(),
      })
      expect((await handle.finished).outcome).to.equal('failed')
      expect(session.getCompaction()).to.be.undefined
    } finally {
      release()
      await supervisor.close()
      await session.close()
    }
  })
})
