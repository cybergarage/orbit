// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  AgentEvent,
  ContextPolicy,
  Model,
  ModelInvokeOptions,
  ModelToolCallPayload,
} from '../../../src/core/index.js'

import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  migrateSessionTranscript,
  OrbitApplicationService,
  Session,
  SessionContextBuilder,
  SessionRepository,
  State,
} from '../../../src/core/index.js'
import {freezeModelRequest} from '../../../src/core/models/prepared.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'

const profile = {
  model: 'fixture',
  outputReserve: 1000,
  provider: 'ollama',
  revision: 'fixture-v1',
  safetyMargin: 100,
  summaryOutput: 800,
  target: 1500,
  templateOverhead: 0,
  trigger: 2000,
  window: 20_000,
}
const policy: ContextPolicy = {
  estimator: (request) => ({
    components: {json: JSON.stringify(request).length},
    kind: 'estimated',
    model: profile.model,
    provider: profile.provider,
    revision: 'chars-fixture',
    tokens: JSON.stringify(request).length,
  }),
  mode: 'budgeted',
  profile,
}
const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true} as const
function oldConversation(session: Session): string {
  const [user] = session.appendMessages([
    new Message(MessageType.User, {content: 'Investigate ' + 'x'.repeat(4000)}),
    new Message(MessageType.Assistant, {content: 'The target test failed.'}),
  ])
  return user.id
}

function fixtureModel(id: string, mode = 'ok'): Model & {requests: Readonly<Record<string, unknown>>[]} {
  const requests: Readonly<Record<string, unknown>>[] = []
  let summaries = 0
  return {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'ollama',
    async invoke() {
      throw new Error('Budgeted path must use the prepared request')
    },
    prepare(messages: Message[], options?: Partial<ModelInvokeOptions>) {
      const request = freezeModelRequest({
        cap: options?.maxOutputTokens,
        messages: messages.map((message) => message.content),
        tools: options?.tools ?? [],
      })
      return {
        async invoke() {
          requests.push(request)
          if (String(request.messages[0]).startsWith('Summarize')) {
            summaries++
            expect(request.tools).to.deep.equal([])
            expect([profile.summaryOutput, profile.outputReserve]).to.include(request.cap)
            if (mode === 'error') throw new Error('Summary fixture failure')
            if (mode === 'chunk-second-error' && summaries === 2) throw new Error('Second summary failed')
            if (mode === 'tool')
              return new Message(MessageType.Assistant, {
                payload: {toolCalls: [{id: 'bad', input: {command: 'false'}, name: 'bash'}]},
              })
            const summary = {
              changedPaths: [],
              facts: [],
              goals: [{sourceIds: [mode === 'bad-id' ? 'invented' : id], text: 'Repair the target'}],
              tests: [
                {
                  outcome: 'failed',
                  revision: null,
                  sourceIds: [id],
                  target: 'target.test.ts',
                  text: 'Target test failed; revision unknown',
                },
              ],
              uncertainties: [],
              unfinished: [],
              version: 1,
            }
            if (mode === 'empty') {
              summary.goals = []
              summary.tests = []
            }

            if (mode === 'oversized') summary.goals[0].text = 'x'.repeat(6000)
            if (mode === 'bad-test') summary.tests[0].outcome = 'invented'
            if (mode === 'fenced-bad-id') summary.goals[0].sourceIds = ['invented']
            const content = ['fenced', 'fenced-bad-id', 'fenced-prose'].includes(mode)
              ? '```json\n' + JSON.stringify(summary) + '\n```' + (mode === 'fenced-prose' ? '\nUnverified text' : '')
              : JSON.stringify(summary)
            const source = JSON.parse(String(request.messages[0]).split('\nSOURCE: ')[1]) as {messages: unknown[]}
            const truncated =
              mode === 'truncated' ||
              (mode === 'length-sensitive' && source.messages.length > 1) ||
              (mode === 'cap-sensitive' && request.cap === profile.summaryOutput)
            return new Message(MessageType.Assistant, {
              content,
              ...(truncated
                ? {payload: {response: {durationMs: 1, model: 'fixture', provider: 'ollama', stopReason: 'length'}}}
                : {}),
            })
          }

          expect(request.cap).to.equal(profile.outputReserve)
          return new Message(MessageType.Assistant, {content: 'Continue repair'})
        },
        request,
      }
    },
    requests,
  }
}

async function execute(session: Session, model: Model, selected = policy, input = 'Continue with the latest request') {
  const store = new MemorySessionLogStore()
  const events: AgentEvent[] = []
  const agent = new Agent({
    contextPolicy: selected,
    cwd: os.tmpdir(),
    deps: {createModel: () => model},
    logStore: store,
    settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'none'}},
    state: new State(session),
    toolProfile: 'none',
  })
  try {
    const result = await (
      await agent.startRun([new Message(MessageType.User, {content: input})], {
        onEvent: (event) => events.push(event),
      })
    ).finished
    return {
      events,
      result: {
        ...result,
        diagnostic: session.getEntries().filter((entry) => entry.type === 'turn_event' && entry.error),
      },
    }
  } finally {
    await agent.close()
    await store.close()
  }
}

describe('budgeted context preparation', () => {
  it('uses the smaller discovered runtime for protected-input admission', async () => {
    const session = new Session()
    const model = fixtureModel('unused')
    model.getContextInfo = async () => ({
      contextWindow: 262_144,
      maxInputTokens: null,
      maxOutputTokens: null,
      requiresRuntimeContext: true,
      runtimeContextWindow: 2500,
      source: 'api',
    })
    const {result} = await execute(session, model, policy, 'x'.repeat(1600))
    expect(result.outcome).to.equal('failed')
    expect(JSON.stringify(result)).to.contain('protected-context-exceeds-budget')
    expect(model.requests).to.have.length(0)
    expect(policy.profile.window).to.equal(20_000)
  })

  it('pins the resolved window into prepared ordinary and summary requests', async () => {
    const session = new Session()
    const model = fixtureModel(oldConversation(session))
    model.getContextInfo = async () => ({
      contextWindow: 262_144,
      maxInputTokens: null,
      maxOutputTokens: 4096,
      runtimeContextWindow: 12_000,
      source: 'api',
    })
    const original = model.prepare!.bind(model)
    const windows: Array<number | undefined> = []
    model.prepare = (messages, options) => {
      windows.push(options?.contextWindow)
      return original(messages, options)
    }

    const {result} = await execute(session, model)
    expect(result.outcome).to.equal('completed')
    expect(windows.length).to.be.greaterThan(1)
    expect(windows.every((window) => window === 12_000)).to.equal(true)
  })

  it('refuses an output reserve beyond discovered provider limits before dispatch', async () => {
    const model = fixtureModel('unused')
    model.getContextInfo = async () => ({
      contextWindow: 20_000,
      maxInputTokens: null,
      maxOutputTokens: 999,
      runtimeContextWindow: null,
      source: 'api',
    })
    const {result} = await execute(new Session(), model)
    expect(result.outcome).to.equal('failed')
    expect(JSON.stringify(result)).to.contain('output limit')
    expect(model.requests).to.have.length(0)
  })

  it('saves one checkpoint, retains originals and keeps the latest request', async () => {
    const session = new Session()
    const id = oldConversation(session)
    const model = fixtureModel(id)
    const {events, result} = await execute(session, model)
    expect(result.outcome, JSON.stringify(result)).to.equal('completed')
    expect(model.requests).to.have.length(2)
    expect(session.getConversationMessages()).to.have.length(4)
    expect(session.getCompaction()?.summary.goals[0].sourceIds).to.deep.equal([id])
    const {messages} = new SessionContextBuilder().build(session)
    expect(messages).to.have.length(3)
    expect(messages[1].content).to.equal('Continue with the latest request')
    expect(events.some((event) => event.type === 'context-prepared' && event.outcome === 'compacted')).to.equal(true)
  })

  it('accepts a complete JSON-fenced summary after validating its evidence', async () => {
    const session = new Session()
    const id = oldConversation(session)
    const model = fixtureModel(id, 'fenced')
    const {result} = await execute(session, model)
    expect(result.outcome, JSON.stringify(result)).to.equal('completed')
    expect(session.getCompaction()?.summary.goals[0].sourceIds).to.deep.equal([id])
  })

  it('summarizes an oversized source in complete tool groups before saving one checkpoint', async () => {
    const session = new Session()
    const id = oldConversation(session)
    const call = new Message(MessageType.Assistant, {
      content: 'Tool call evidence ' + 'c'.repeat(4000),
      payload: {toolCalls: [{id: 'chunk-call', input: {path: 'target'}, name: 'read'}]},
    })
    const result = new Message(MessageType.Tool, {
      content: 'Tool result evidence ' + 'r'.repeat(4000),
      payload: {name: 'read', output: 'r'.repeat(4000), toolCallId: 'chunk-call'},
    })
    session.appendMessages([
      call,
      result,
      new Message(MessageType.Assistant, {content: 'Later evidence ' + 'l'.repeat(7000)}),
    ])
    const model = fixtureModel(id)
    const {result: run} = await execute(session, model)
    expect(run.outcome, JSON.stringify(run)).to.equal('completed')
    const summaries = model.requests.filter((request) =>
      String((request.messages as unknown[])[0]).startsWith('Summarize'),
    )
    expect(summaries.length).to.be.greaterThan(1)
    expect(
      summaries.every(
        (request) => JSON.stringify(request).length <= profile.window - profile.summaryOutput - profile.safetyMargin,
      ),
    ).to.equal(true)
    for (const request of summaries) {
      const source = JSON.parse(String((request.messages as unknown[])[0]).split('\nSOURCE: ')[1]) as {
        messages: Array<{id: string}>
      }
      expect(source.messages.some((message) => message.id === call.id)).to.equal(
        source.messages.some((message) => message.id === result.id),
      )
    }

    expect(session.getCompaction()?.summary.goals[0].sourceIds).to.deep.equal([id])
    expect(session.getConversationMessages()).to.have.length(7)
  })

  for (const mode of ['length-sensitive', 'cap-sensitive'])
    it('recovers a length-limited summary with ' + mode, async () => {
      const session = new Session()
      const id = oldConversation(session)
      const model = fixtureModel(id, mode)
      const {result} = await execute(session, model)
      expect(result.outcome, JSON.stringify(result)).to.equal('completed')
      expect(session.getCompaction()?.summary.goals[0].sourceIds).to.deep.equal([id])
      expect(
        model.requests.filter((request) => String((request.messages as unknown[])[0]).startsWith('Summarize')).length,
      ).to.be.greaterThan(1)
    })

  it('refuses a single oversized tool group without activating an intermediate summary', async () => {
    const session = new Session()
    const id = oldConversation(session)
    session.appendMessages([
      new Message(MessageType.Assistant, {
        content: 'x'.repeat(21_000),
        payload: {toolCalls: [{id: 'huge-call', input: {}, name: 'read'}]},
      }),
      new Message(MessageType.Tool, {payload: {name: 'read', output: 'done', toolCallId: 'huge-call'}}),
    ])
    const model = fixtureModel(id)
    const {result} = await execute(session, model)
    expect(result.outcome).to.equal('failed')
    expect(JSON.stringify(result)).to.contain('compaction-input-exceeds-budget')
    expect(session.getCompaction()).to.equal(undefined)
  })

  it('does not activate a partial checkpoint after a later summary batch fails', async () => {
    const session = new Session()
    const id = oldConversation(session)
    session.appendMessages([
      new Message(MessageType.Assistant, {content: 'a'.repeat(8000)}),
      new Message(MessageType.Assistant, {content: 'b'.repeat(8000)}),
      new Message(MessageType.Assistant, {content: 'c'.repeat(8000)}),
    ])
    const model = fixtureModel(id, 'chunk-second-error')
    const {result} = await execute(session, model)
    expect(result.outcome).to.equal('failed')
    expect(JSON.stringify(result)).to.contain('Second summary failed')
    expect(session.getCompaction()).to.equal(undefined)
  })

  for (const mode of [
    'error',
    'tool',
    'bad-id',
    'empty',
    'oversized',
    'bad-test',
    'truncated',
    'fenced-prose',
    'fenced-bad-id',
  ])
    it('uses the fitting unchanged context after ' + mode, async () => {
      const session = new Session()
      const model = fixtureModel(oldConversation(session), mode)
      const {events, result} = await execute(session, model)
      expect(result.outcome, JSON.stringify(result)).to.equal('completed')
      expect(session.getCompaction()).to.equal(undefined)
      if (mode === 'truncated') expect(model.requests.length).to.be.greaterThan(2)
      else expect(model.requests).to.have.length(2)
      expect(events.some((event) => event.type === 'context-prepared' && event.outcome === 'failed')).to.equal(true)
    })

  it('refuses unknown estimation before sending requests', async () => {
    const session = new Session()
    const model = fixtureModel(oldConversation(session))
    const {result} = await execute(session, model, {
      estimator: () => ({
        components: {},
        kind: 'unknown',
        model: profile.model,
        provider: profile.provider,
        revision: 'unknown',
        tokens: 0,
      }),
      mode: 'budgeted',
      profile,
    })
    expect(result.outcome).not.to.equal('completed')
    expect(model.requests).to.have.length(0)
  })

  for (const change of [{target: profile.trigger}, {outputReserve: 0}, {model: 'different'}, {window: 1}])
    it('rejects an invalid or mismatched profile ' + JSON.stringify(change), async () => {
      const session = new Session()
      const model = fixtureModel(oldConversation(session))
      const {result} = await execute(session, model, {...policy, profile: {...profile, ...change}} as ContextPolicy)
      expect(result.outcome).not.to.equal('completed')
      expect(model.requests).to.have.length(0)
    })

  it('refuses a summary request that cannot fit its own reserve', async () => {
    const session = new Session()
    const model = fixtureModel(oldConversation(session))
    const {result} = await execute(session, model, {...policy, profile: {...profile, window: 5000}} as ContextPolicy)
    expect(result.outcome).not.to.equal('completed')
    expect(model.requests).to.have.length(0)
  })

  it('does not fall back when unchanged input exceeds the ordinary budget', async () => {
    const session = new Session()
    const model = fixtureModel(oldConversation(session), 'error')
    const {result} = await execute(session, model, {
      ...policy,
      profile: {...profile, outputReserve: 2000, summaryOutput: 100, window: 6000},
    } as ContextPolicy)
    expect(result.outcome).not.to.equal('completed')
    expect(model.requests).to.have.length(1)
    expect(session.getCompaction()).to.equal(undefined)
  })

  it('refuses unresolved tool groups without generating a summary', async () => {
    const session = new Session()
    const id = oldConversation(session)
    session.appendMessages([
      new Message(MessageType.Assistant, {payload: {toolCalls: [{id: 'pending', input: {path: 'x'}, name: 'read'}]}}),
    ])
    const model = fixtureModel(id)
    const {result} = await execute(session, model)
    expect(result.outcome).not.to.equal('completed')
    expect(model.requests).to.have.length(0)
  })

  it('isolates nested projected payloads', () => {
    const session = new Session()
    session.appendMessages([
      new Message(MessageType.Assistant, {payload: {toolCalls: [{id: 'a', input: {path: 'x'}, name: 'read'}]}}),
    ])
    const projection = new SessionContextBuilder().build(session)
    ;((projection.messages[0].payload as ModelToolCallPayload).toolCalls[0].input as {path: string}).path = 'changed'
    expect(
      ((session.getConversationMessages()[0].payload as ModelToolCallPayload).toolCalls[0].input as {path: string})
        .path,
    ).to.equal('x')
  })

  it('stops when the latest protected turn cannot fit', async () => {
    const session = new Session()
    const id = oldConversation(session)
    const model = fixtureModel(id)
    const {result} = await execute(
      session,
      model,
      {...policy, profile: {...profile, target: 1000, trigger: 1500, window: 3000}} as ContextPolicy,
      'y'.repeat(20_000),
    )
    expect(result.outcome).not.to.equal('completed')
    expect(model.requests).to.have.length(0)
  })

  it('repeats compaction with a predecessor and rejects altered canonical evidence', async () => {
    const session = new Session()
    const id = oldConversation(session)
    await execute(session, fixtureModel(id))
    const first = session.getCompaction()!
    // Extend the now completed turn so that a second checkpoint becomes necessary.
    session.appendMessages([new Message(MessageType.Assistant, {content: 'More evidence ' + 'z'.repeat(4000)})])
    const model = fixtureModel(id)
    const {result} = await execute(session, model)
    expect(result.outcome, JSON.stringify(result)).to.equal('completed')
    expect(session.getCompaction()?.previousId).to.equal(first.id)
    const entries = session.getEntries()
    const original = entries.find((entry) => entry.type === 'message')!
    if (original.type !== 'message') throw new Error('Missing original fixture')
    original.message.contents[0] = 'tampered'
    expect(
      () =>
        new Session({
          entries,
          formatVersion: 2,
          messages: session.getConversationMessages(),
          metadata: session.getMetadata(),
        }),
    ).to.throw('digest mismatch')
  })

  it('does not bypass a model-call limit for summarization', async () => {
    const session = new Session()
    const model = fixtureModel(oldConversation(session))
    const store = new MemorySessionLogStore()
    const agent = new Agent({
      contextPolicy: policy,
      cwd: os.tmpdir(),
      deps: {createModel: () => model},
      execution: {limits: {modelCalls: 1}},
      logStore: store,
      settings: {model: 'fixture', provider: 'ollama'},
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const result = await (await agent.startRun([new Message(MessageType.User, {content: 'Continue'})])).finished
      expect(result.outcome).not.to.equal('completed')
      expect(model.requests).to.have.length(1)
    } finally {
      await agent.close()
      await store.close()
    }
  })

  it('cancels a cooperative summary without activating a checkpoint', async () => {
    const session = new Session()
    oldConversation(session)
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let calls = 0
    const model: Model = {
      getModel: () => 'fixture',
      getName: () => 'fixture',
      getProvider: () => 'ollama',
      async invoke() {
        throw new Error('Unexpected direct call')
      },
      prepare(messages, options) {
        const request = freezeModelRequest({messages: messages.map((message) => message.content)})
        return {
          invoke: () =>
            new Promise<Message>((_resolve, reject) => {
              calls++
              options?.signal?.addEventListener('abort', () => reject(new Error('Aborted summary')), {once: true})
              entered()
            }),
          request,
        }
      },
    }
    const store = new MemorySessionLogStore()
    const agent = new Agent({
      contextPolicy: policy,
      cwd: os.tmpdir(),
      deps: {createModel: () => model},
      logStore: store,
      settings: {model: 'fixture', provider: 'ollama'},
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const handle = await agent.startRun([new Message(MessageType.User, {content: 'Continue'})])
      await started
      handle.requestStop('user')
      const result = await handle.finished
      expect(result.outcome).to.equal('cancelled')
      expect(result.quiescence).to.equal(true)
      expect(calls).to.equal(1)
      expect(session.getCompaction()).to.equal(undefined)
    } finally {
      await agent.close()
      await store.close()
    }
  })

  it('applies the configured budget to durable application threads and projects the result', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-context-app-')))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    repository.initializeStorage(offline)
    const original = repository.create({cwd: root, formatVersion: 2, id: 'application-fixture'})
    const model = fixtureModel(oldConversation(original))
    await original.close()
    const logs = new MemorySessionLogStore()
    const service = new OrbitApplicationService({
      contextPolicy: policy,
      contexts: [],
      createAgent: (options) => new Agent({...options, deps: {createModel: () => model}, toolProfile: 'none'}),
      cwd: root,
      logStore: logs,
      model: 'fixture',
      provider: 'ollama',
      repository,
      settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'none'}},
      settingsSources: [],
    })
    try {
      const fresh = service.createThread()
      const freshFile = (await repository.findById(fresh.id))!.file
      expect(parseSessionFile(fs.readFileSync(freshFile, 'utf8'), freshFile).header.version).to.equal(2)
      await service.resumeSession('application-fixture')
      const completed = new Promise<void>((resolve) => {
        const unsubscribe = service.diagnostics.subscribe((event) => {
          if (event.type === 'run.completed') {
            unsubscribe()
            resolve()
          }
        })
      })
      await service.startRun('application-fixture', 'Continue')
      await completed
      expect(service.runtime.contextMode).to.equal('budgeted')
      expect(
        service.getEvents().some((event) => event.type === 'context.prepared' && event.data.outcome === 'compacted'),
      ).to.equal(true)
      expect(model.requests).to.have.length(2)
    } finally {
      await service.close()
      await logs.close()
      fs.rmSync(root, {force: true, recursive: true})
    }
  })

  for (const tokens of [1999, 2000, 2001])
    it('uses the declared trigger boundary at ' + tokens, async () => {
      const session = new Session()
      const model = fixtureModel(oldConversation(session))
      const selected: ContextPolicy = {
        estimator(request) {
          const messages = request.messages as string[]
          const count = messages[0].startsWith('Summarize')
            ? 2000
            : messages[0].startsWith('Untrusted')
              ? 900
              : messages.length === 1
                ? 100
                : tokens
          return {
            components: {fixture: count},
            kind: 'estimated',
            model: profile.model,
            provider: profile.provider,
            revision: 'boundary',
            tokens: count,
          }
        },
        mode: 'budgeted',
        profile,
      }
      const {result} = await execute(session, model, selected)
      expect(result.outcome).to.equal('completed')
      expect(model.requests).to.have.length(tokens < 2000 ? 1 : 2)
    })

  it('rejects a missing predecessor, stale source head and invalid retained boundary on replay', async () => {
    const session = new Session()
    await execute(session, fixtureModel(oldConversation(session)))
    for (const change of [
      {previousId: 'missing'},
      {sourceHeadId: 'missing'},
      {firstRetainedId: 'missing'},
      {prefixEndId: 'missing'},
    ]) {
      const entries = structuredClone(session.getEntries())
      Object.assign(entries.find((entry) => entry.type === 'compaction')!, change)
      expect(
        () =>
          new Session({
            entries,
            formatVersion: 2,
            messages: session.getConversationMessages(),
            metadata: session.getMetadata(),
          }),
      ).to.throw()
    }
  })

  it('retains ownership after a noncooperative summary exceeds the Run deadline', async () => {
    const session = new Session()
    oldConversation(session)
    let finish!: (message: Message) => void
    let entered!: () => void
    const pending = new Promise<Message>((resolve) => {
      finish = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const model: Model = {
      getModel: () => 'fixture',
      getName: () => 'fixture',
      getProvider: () => 'ollama',
      async invoke() {
        throw new Error('Unexpected raw call')
      },
      prepare(messages) {
        return {
          invoke() {
            entered()
            return pending
          },
          request: freezeModelRequest({messages: messages.map((message) => message.content)}),
        }
      },
    }
    const logs = new MemorySessionLogStore()
    const agent = new Agent({
      contextPolicy: policy,
      cwd: os.tmpdir(),
      deps: {createModel: () => model},
      execution: {limits: {cleanupMs: 15, elapsedMs: 150}},
      logStore: logs,
      settings: {model: 'fixture', provider: 'ollama'},
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      const handle = await agent.startRun([new Message(MessageType.User, {content: 'Continue'})])
      await started
      const result = await handle.finished
      expect(result.outcome).to.equal('incomplete')
      expect(result.quiescence).to.equal(false)
      expect(result.unresolved.some((item) => item.includes('context-summary'))).to.equal(true)
      expect(session.getCompaction()).to.equal(undefined)
      finish(new Message(MessageType.Assistant, {content: '{}'}))
      await pending
      expect(handle.getSnapshot().quarantined).to.equal(true)
      expect(handle.getSnapshot().unresolved).to.deep.equal([])
      await agent.supervisor.reconcileRun(result.runId, {confirmedStopped: true, operations: []})
      await agent.close()
      expect(handle.getSnapshot().result).to.deep.equal(result)
      expect(handle.getSnapshot().unresolved).to.deep.equal([])
    } finally {
      finish(new Message(MessageType.Assistant, {content: '{}'}))
      await agent.close()
      await logs.close()
    }
  })

  it('migrates an explicit v1 transcript and reopens the same v2 checkpoint', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-context-v2-')))
    const repository = new SessionRepository({rootDir: root})
    repository.initializeStorage(offline)
    let session = repository.create({cwd: root, id: 'fixture'})
    const file = session.getFile()!
    const id = oldConversation(session)
    await session.close()
    migrateSessionTranscript(repository.scope('fixture'), file, offline)
    expect(parseSessionFile(fs.readFileSync(file, 'utf8'), file).header.version).to.equal(2)
    expect(fs.existsSync(file + '.v1-backup')).to.equal(true)
    session = repository.open(file)
    const {result} = await execute(session, fixtureModel(id))
    expect(result.outcome, JSON.stringify(result)).to.equal('completed')
    const checkpoint = session.getCompaction()
    const before = new SessionContextBuilder().build(session).messages.map((message) => message.content)
    await session.close()
    session = repository.open(file)
    expect(session.getCompaction()).to.deep.equal(checkpoint)
    expect(new SessionContextBuilder().build(session).messages.map((message) => message.content)).to.deep.equal(before)
    await session.close()
    fs.rmSync(root, {force: true, recursive: true})
  })
})
