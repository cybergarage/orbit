// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop */
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {GraphAdapter, GraphDefinition, GraphJSON, Model} from '../../../src/core/index.js'

import {canonicalJSON, validateNext} from '../../../src/core/execution/journal.js'
import {inspectExecutionJournal} from '../../../src/core/execution/recovery.js'
import {
  Agent,
  compileProcessorGraph,
  createBashTool,
  createWriteTool,
  inspectGraphRun,
  MemoryExecutionJournal,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  Session,
  SkillCatalog,
  State,
  ThreadManager,
} from '../../../src/core/index.js'
import {freezeModelRequest} from '../../../src/core/models/prepared.js'
import {SessionRepository} from '../../session-storage-fixture.js'
import {validateNext as legacyValidateNext} from './fixtures/pre-graph-journal.js'

const any = {}
const definition: GraphDefinition = {
  edges: [{from: 'first', id: 'finish', to: 'done'}],
  entry: 'first',
  id: 'pipeline',
  nodes: [{adapter: 'copy', id: 'first'}],
  terminals: [{id: 'done', outcome: 'completed'}],
}
function adapter(invoke: GraphAdapter['invoke'] = (input) => input): GraphAdapter {
  return {id: 'copy', inputSchema: any, invoke, kind: 'transform', outputSchema: any, version: '1.0'}
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return {promise, resolve}
}

async function rejects(promise: Promise<unknown>, pattern?: RegExp) {
  try {
    await promise
  } catch (error) {
    if (pattern) expect(String(error)).match(pattern)
    return
  }

  throw new Error('Expected rejection')
}

const fakeModel = (invoke: Model['invoke']): Model => ({
  getModel: () => 'fixture',
  getName: () => 'fixture',
  getProvider: () => 'ollama',
  invoke,
})

describe('managed Processor Graph', () => {
  let root: string
  let agents: Agent[]

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-graph-')))
    agents = []
  })

  afterEach(async () => {
    restore()
    for (const agent of agents) await agent.close()
    await fs.rm(root, {force: true, recursive: true})
  })
  function create(
    invoke: Model['invoke'] = async () => new Message(MessageType.Assistant, {content: 'answer'}),
    extra: Partial<ConstructorParameters<typeof Agent>[0]> = {},
  ) {
    const session = extra.state?.getSession() ?? new Session({formatVersion: 2})
    const journal = new MemoryExecutionJournal(
      session.getId(),
      extra.execution ? undefined : session.acquireManagedLease(),
    )
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => fakeModel(invoke)},
      execution: {journalFactory: async () => journal},
      logStore: new MemorySessionLogStore(),
      state: new State(session),
      toolProfile: 'none',
      ...extra,
    })
    agents.push(agent)
    return {agent, journal, session}
  }

  it('exports a compiler, freezes callbacks/configuration and rejects forged definitions', async () => {
    const source = adapter()
    const d = structuredClone(definition)
    d.nodes[0].configuration = {secret: 'private'}
    const graph = await compileProcessorGraph(d, [source])
    source.invoke = () => 'changed'
    d.nodes[0].configuration = 'changed'
    const {agent, journal} = create()
    const h = await agent.startGraphRun(graph, {nested: [1, true]})
    expect((await h.finished).outcome).eq('completed')
    expect(h.value()?.value).deep.eq({nested: [1, true]})
    expect(Object.isFrozen(graph.descriptor.nodes[0])).eq(true)
    expect(JSON.stringify(journal.records())).not.include('private')
    expect(journal.records().every((r) => r.version === 2)).eq(true)
    expect(journal.records().find((r) => r.kind === 'graph-node-completed')!.data.transcriptHighWater).greaterThan(0)
    await rejects(agent.startGraphRun({...graph} as typeof graph, {}), /Unrecognized/)
  })

  it('rejects cycles in JSON, accessors, oversized values and invalid closed configurations', async () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const input of [
      cycle,
      {
        get bad() {
          throw new Error('must not execute getter')
        },
      },
      new Date(),
      {number: Number.NaN},
    ])
      await rejects(
        compileProcessorGraph(
          {...definition, nodes: [{adapter: 'copy', configuration: input as GraphJSON, id: 'first'}]},
          [adapter()],
        ),
      )
    await rejects(
      compileProcessorGraph(
        {...definition, nodes: [{adapter: 'copy', configuration: 'x'.repeat(300_000), id: 'first'}]},
        [adapter()],
      ),
      /byte/,
    )
    await rejects(compileProcessorGraph(definition, [{...adapter(), version: ''}]), /version/)
    await rejects(compileProcessorGraph({...definition, edges: []}, [adapter()]), /successor/)
    await rejects(
      compileProcessorGraph(
        {
          ...definition,
          edges: [...definition.edges, {from: 'orphan', id: 'unused', to: 'done'}],
          nodes: [...definition.nodes, {adapter: 'copy', id: 'orphan'}],
        },
        [adapter()],
      ),
      /Unreachable/,
    )
  })

  it('shares one turn, model, catalog and Skill snapshot across two Agent stages', async () => {
    const directory = path.join(root, 'skills', 'review')
    await fs.mkdir(directory, {recursive: true})
    await fs.writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review test\n---\nGRAPH_SKILL_SENTINEL\n',
    )
    const catalog = new SkillCatalog([{directory: path.dirname(directory), id: 'local'}])
    const listed = await catalog.list()
    let calls = 0
    const {agent, journal, session} = create(
      async (messages) => {
        calls++
        expect(messages.filter((m) => m.content.includes('GRAPH_SKILL_SENTINEL'))).length(1)
        return new Message(MessageType.Assistant, {content: 'answer ' + calls})
      },
      {skillCatalog: catalog},
    )
    const graph = await compileProcessorGraph(
      {
        ...definition,
        edges: [
          {from: 'first', id: 'next', to: 'second'},
          {from: 'second', id: 'finish', to: 'done'},
        ],
        nodes: [
          {adapter: 'agent', id: 'first'},
          {adapter: 'agent', id: 'second'},
        ],
      },
      [{id: 'agent', inputSchema: any, kind: 'agent', outputSchema: any, version: '1'}],
    )
    const h = await agent.startGraphRun(graph, 'inspect', {skills: [listed.candidates[0]]})
    const result = await h.finished
    expect(result.outcome, JSON.stringify(result)).eq('completed')
    expect(calls).eq(2)
    expect(session.getSkillContexts()).length(1)
    expect(journal.records().filter((r) => r.kind === 'run-ready')).length(1)
    const starts = journal.records().filter((r) => r.kind === 'graph-node-started')
    expect(starts).length(2)
    expect(session.getEntries().filter((e) => e.type === 'turn_event')).length(2)
    expect(h.value()?.value).include({type: 'assistant'})
  })

  it('compares complete live submissions before invoking callbacks again', async () => {
    let calls = 0
    const blocked = deferred<GraphJSON>()
    const entered = deferred()
    const graph = await compileProcessorGraph(definition, [
      adapter(() => {
        calls++
        entered.resolve()
        return blocked.promise
      }),
    ])
    const {agent} = create()
    const first = await agent.startGraphRun(graph, 'input', {requestId: 'repeat'})
    await entered.promise
    const second = await agent.startGraphRun(graph, 'input', {requestId: 'repeat'})
    expect(second).eq(first)
    expect(calls).eq(1)
    await rejects(agent.startGraphRun(graph, 'different', {requestId: 'repeat'}), /Conflicting/)
    const changed = await compileProcessorGraph(
      {...definition, nodes: [{adapter: 'copy', configuration: 42, id: 'first'}]},
      [adapter()],
    )
    await rejects(agent.startGraphRun(changed, 'input', {requestId: 'repeat'}), /Conflicting/)
    blocked.resolve('done')
    await first.finished
    expect(await agent.startGraphRun(graph, 'input', {requestId: 'repeat'})).eq(first)
    expect(calls).eq(1)
  })

  it('routes values separately from labels and reports a declared failure without publishing success', async () => {
    const d: GraphDefinition = {
      edges: [
        {from: 'choose', id: 'yes', label: 'yes', to: 'done'},
        {from: 'choose', id: 'no', label: 'no', to: 'failed'},
      ],
      entry: 'choose',
      id: 'route',
      nodes: [{adapter: 'router', id: 'choose'}],
      terminals: [
        {id: 'done', outcome: 'completed'},
        {id: 'failed', outcome: 'failed'},
      ],
    }
    const graph = await compileProcessorGraph(d, [{...adapter(() => 'no'), id: 'router', kind: 'router'}])
    const {agent, journal} = create()
    const h = await agent.startGraphRun(graph, {value: 42})
    const r = await h.finished
    expect(r.outcome, JSON.stringify(r)).eq('failed')
    expect(r.reason).eq('graph-declared-failure')
    expect(h.value()).equal(undefined)
    expect(agent.getGraphSnapshot(h.id)?.lastValue).deep.eq({value: 42})
    for (const [i, r] of journal.records().entries()) validateNext(journal.records().slice(0, i), r)
  })

  it('bounds repeated visits and refuses an undeclared route', async () => {
    const d: GraphDefinition = {
      edges: [
        {from: 'choose', id: 'again', label: 'again', to: 'choose'},
        {from: 'choose', id: 'end', label: 'done', to: 'done'},
      ],
      entry: 'choose',
      id: 'cycle',
      nodes: [{adapter: 'router', id: 'choose'}],
      terminals: [{id: 'done', outcome: 'completed'}],
    }
    const graph = await compileProcessorGraph(d, [{...adapter(() => 'again'), id: 'router', kind: 'router'}], {
      maxNodeVisits: 3,
    })
    const {agent, journal} = create()
    const h = await agent.startGraphRun(graph, 0)
    const r = await h.finished
    expect(r.outcome).eq('budget-exceeded')
    expect(journal.records().filter((r) => r.kind === 'graph-node-started')).length(3)
    expect(h.value()).equal(undefined)
    const bad = await compileProcessorGraph(d, [{...adapter(() => 'unknown'), id: 'router', kind: 'router'}])
    const other = create()
    const failure = await (await other.agent.startGraphRun(bad, 0)).finished
    expect(failure.outcome).eq('failed')
    expect(other.journal.records().filter((r) => r.kind === 'graph-transition')).length(0)
  })

  it('holds a cancelled callback owner and never starts its successor', async () => {
    const pending = deferred<GraphJSON>()
    const entered = deferred()
    let successor = 0
    const graph = await compileProcessorGraph(
      {
        ...definition,
        edges: [
          {from: 'first', id: 'next', to: 'second'},
          {from: 'second', id: 'finish', to: 'done'},
        ],
        nodes: [
          {adapter: 'copy', id: 'first'},
          {adapter: 'next', id: 'second'},
        ],
      },
      [
        adapter(() => {
          entered.resolve()
          return pending.promise
        }),
        {
          ...adapter(() => {
            successor++
            return 1
          }),
          id: 'next',
        },
      ],
    )
    const {agent} = create()
    const h = await agent.startGraphRun(graph, 0, {limits: {cleanupMs: 10}})
    await entered.promise
    h.requestStop('cancelled')
    const r = await h.finished
    expect(r.quiescence).eq(false)
    expect(r.outcome).eq('incomplete')
    expect(successor).eq(0)
    expect(h.value()).equal(undefined)
    pending.resolve(1)
  })

  it('stops before the next dispatch on required node or transcript acknowledgement failure', async () => {
    for (const boundary of ['graph-node-started', 'graph-node-completed', 'graph-transition', 'transcript']) {
      let calls = 0
      const {agent, journal, session} = create()
      const original = journal.append.bind(journal)
      if (boundary === 'transcript') stub(session, 'synchronize').rejects(new Error('injected sync failure'))
      else
        stub(journal, 'append').callsFake((...args) =>
          args[1] === boundary ? Promise.reject(new Error('injected journal failure')) : original(...args),
        )
      const graph = await compileProcessorGraph(definition, [
        adapter(() => {
          calls++
          return 1
        }),
      ])
      const h = await agent.startGraphRun(graph, 0)
      const r = await h.finished
      expect(r.outcome, JSON.stringify(r)).not.eq('completed')
      expect(h.value()).equal(undefined)
      expect(calls).eq(['graph-node-started', 'transcript'].includes(boundary) ? 0 : 1)
      restore()
    }
  })

  it('requires explicit transcript v2 even for a transform without Skills', async () => {
    const {agent} = create(undefined, {state: new State(new Session({formatVersion: 1}))})
    const graph = await compileProcessorGraph(definition, [adapter()])
    await rejects(agent.startGraphRun(graph, 0), /v2 migration/)
  })

  it('retains ordinary v1 Runs before and after a v2 Graph in one journal', async () => {
    const {agent, journal} = create()
    const graph = await compileProcessorGraph(definition, [adapter()])
    const a = await agent.startRun([new Message(MessageType.User, {content: 'before'})])
    await a.finished
    const b = await agent.startGraphRun(graph, 0)
    await b.finished
    const c = await agent.startRun([new Message(MessageType.User, {content: 'after'})])
    await c.finished
    expect(
      journal
        .records()
        .filter((r) => r.kind === 'run-admitted')
        .map((r) => r.version),
    ).deep.eq([1, 2, 1])
    for (const [i, r] of journal.records().entries()) validateNext(journal.records().slice(0, i), r)
    expect(a.value()).instanceOf(Message)
    expect(c.value()).instanceOf(Message)
  })

  it('keeps Graph service values distinct and rejects changed input through the Thread entry', async () => {
    const session = new Session({formatVersion: 2})
    const manager = new ThreadManager({createAgent: (options) => create(undefined, options).agent})
    const thread = manager.createThread({agent: {state: new State(session)}})
    const graph = await compileProcessorGraph(definition, [adapter()])
    const h = manager.startGraphRun(thread.id, graph, 3, {requestId: 'service'})
    await h.admitted
    expect((await h.completion).value).eq(3)
    expect(manager.getGraphSnapshot(h.id)?.lastValue).eq(3)
    expect(() => manager.startGraphRun(thread.id, graph, 4, {requestId: 'service'})).throw('Conflicting')
    await manager.close()
  })

  it('verifies synchronized transcript references without executing adapters', async () => {
    const {agent, journal, session} = create()
    const graph = await compileProcessorGraph(definition, [adapter()])
    const h = await agent.startGraphRun(graph, 'private input')
    await h.finished
    const records = journal.records()
    expect(inspectGraphRun(records).transcript).eq('unavailable')
    expect(
      inspectGraphRun(records, {entries: session.getEntries(), formatVersion: 2, sessionId: session.getId()})
        .transcript,
      JSON.stringify(
        inspectGraphRun(records, {entries: session.getEntries(), formatVersion: 2, sessionId: session.getId()}),
      ),
    ).eq('verified')
    expect(
      inspectGraphRun(records, {
        entries: session.getEntries().slice(0, 1),
        formatVersion: 2,
        sessionId: session.getId(),
      }).transcript,
    ).eq('mismatch')
    const changed = structuredClone(records)
    const completed = changed.find((r) => r.kind === 'graph-node-completed')!
    completed.data.messages = ['unknown-message']
    expect(
      inspectGraphRun(changed, {entries: session.getEntries(), formatVersion: 2, sessionId: session.getId()}).issue,
    ).match(/message reference/)
    const stopped = structuredClone(records)
    const index = stopped.findIndex((r) => r.kind === 'graph-transition')
    stopped[index].data.destination = 'unknown'
    expect(inspectGraphRun(stopped).issue).match(/transition/)
    expect(JSON.stringify(records)).not.include('private input')
  })

  it('checks local and discovered catalog mismatches before any node starts', async () => {
    for (const source of [{kind: 'builtin'} as const, {kind: 'mcp', server: 'absent'} as const]) {
      let init = 0
      const {agent, journal} = create(undefined, {
        deps: {
          createMcpToolManager() {
            init++
            return {async close() {}, getTools: async () => []}
          },
          createModel: () =>
            fakeModel(async () => {
              throw new Error('must not call')
            }),
        },
      })
      const graph = await compileProcessorGraph(definition, [
        {
          id: 'copy',
          inputSchema: {type: 'object'},
          kind: 'tool',
          outputSchema: any,
          tool: {name: 'absent', source},
          version: '1',
        },
      ])
      expect((await (await agent.startGraphRun(graph, {})).finished).outcome).eq('failed')
      expect(journal.records().filter((r) => r.kind === 'run-ready' || r.kind === 'graph-node-started')).length(0)
      expect(init).eq(source.kind === 'builtin' ? 0 : 1)
    }
  })

  it('counts direct requests and preserves denied outcomes without an intent', async () => {
    const write = createWriteTool()
    const graph = await compileProcessorGraph(definition, [
      {
        id: 'copy',
        inputSchema: structuredClone(write.spec.inputSchema),
        kind: 'tool',
        outputSchema: any,
        tool: {name: 'write', source: write.source},
        version: '1',
      },
    ])
    const {agent, journal} = create(undefined, {toolDefinitions: [write]})
    const h = await agent.startGraphRun(graph, {content: 'no approval', path: 'output.txt'})
    const r = await h.finished
    expect(r.operations.map((o) => o.status)).deep.eq(['denied'])
    expect(journal.records().filter((r) => r.kind === 'operation-intent')).length(0)
    expect(journal.records().find((r) => r.kind === 'operation-result')?.data.visitId).a('string')
    expect(h.value()).equal(undefined)
    expect(r.recording.status).eq('acknowledged')
    const second = create(undefined, {toolDefinitions: [write]})
    const exhausted = await (
      await second.agent.startGraphRun(graph, {content: 'no budget', path: 'output.txt'}, {limits: {toolRequests: 0}})
    ).finished
    expect(exhausted.outcome).eq('budget-exceeded')
    expect(exhausted.operations).length(0)
  })

  it('runs a real isolated target test, routes its failure, corrects once and retests', async () => {
    await fs.writeFile(
      path.join(root, 'target.mjs'),
      "import assert from 'node:assert/strict'; import fs from 'node:fs'; assert.equal(fs.readFileSync('answer.txt','utf8'),'fixed');",
    )
    await fs.writeFile(path.join(root, 'answer.txt'), 'wrong')
    const bash = createBashTool()
    const write = createWriteTool()
    const command = {command: 'node target.mjs'}
    let routes = 0
    const d: GraphDefinition = {
      edges: [
        {from: 'test', id: 'tested', to: 'route'},
        {from: 'route', id: 'ok', label: 'ok', to: 'done'},
        {from: 'route', id: 'repair', label: 'repair', to: 'prepare'},
        {from: 'prepare', id: 'prepared', to: 'fix'},
        {from: 'fix', id: 'fixed', to: 'retry'},
        {from: 'retry', id: 'again', to: 'test'},
      ],
      entry: 'test',
      id: 'target-correction',
      nodes: [
        {adapter: 'bash', id: 'test'},
        {adapter: 'route', id: 'route'},
        {adapter: 'prepare', id: 'prepare'},
        {adapter: 'write', id: 'fix'},
        {adapter: 'retry', id: 'retry'},
      ],
      terminals: [{id: 'done', outcome: 'completed'}],
    }
    const graph = await compileProcessorGraph(d, [
      {
        id: 'bash',
        inputSchema: structuredClone(bash.spec.inputSchema),
        kind: 'tool',
        outputSchema: any,
        tool: {name: 'bash', source: bash.source},
        version: '1',
      },
      {
        id: 'write',
        inputSchema: structuredClone(write.spec.inputSchema),
        kind: 'tool',
        outputSchema: any,
        tool: {name: 'write', source: write.source},
        version: '1',
      },
      {
        ...adapter((input) => {
          routes++
          return (input as {isError: boolean}).isError ? 'repair' : 'ok'
        }),
        id: 'route',
        kind: 'router',
      },
      {
        ...adapter(() => ({content: 'fixed', path: 'answer.txt'})),
        id: 'prepare',
        outputSchema: structuredClone(write.spec.inputSchema),
      },
      {...adapter(() => command), id: 'retry', outputSchema: structuredClone(bash.spec.inputSchema)},
    ])
    const {agent} = create(undefined, {
      execution: {policy: {generation: 'isolated-test', profile: 'unrestricted', roots: [root]}},
      toolDefinitions: [bash, write],
    })
    const h = await agent.startGraphRun(graph, command, {limits: {toolRequests: 3, toolRounds: 0}})
    const r = await h.finished
    expect(r.outcome, JSON.stringify(r)).eq('completed')
    expect(routes).eq(2)
    expect(r.operations.map((o) => o.status)).deep.eq(['failed', 'succeeded', 'succeeded'])
    expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).eq('fixed')
    expect(agent.getGraphSnapshot(h.id)?.visits).eq(7)
  })

  it('shares model-call allowance across Agent stages', async () => {
    let calls = 0
    const {agent} = create(async () => {
      calls++
      return new Message(MessageType.Assistant, {content: 'done'})
    })
    const graph = await compileProcessorGraph(
      {
        ...definition,
        edges: [
          {from: 'first', id: 'next', to: 'second'},
          {from: 'second', id: 'end', to: 'done'},
        ],
        nodes: [
          {adapter: 'agent', id: 'first'},
          {adapter: 'agent', id: 'second'},
        ],
      },
      [{id: 'agent', inputSchema: any, kind: 'agent', outputSchema: any, version: '1'}],
    )
    const h = await agent.startGraphRun(graph, 0, {limits: {modelCalls: 1}})
    expect((await h.finished).outcome).eq('budget-exceeded')
    expect(calls).eq(1)
    expect(h.value()).equal(undefined)
  })

  it('does not forward a selected edge when cancellation wins after its acknowledgement', async () => {
    let calls = 0
    const {agent, journal} = create()
    const graph = await compileProcessorGraph(
      {
        ...definition,
        edges: [
          {from: 'first', id: 'next', to: 'second'},
          {from: 'second', id: 'end', to: 'done'},
        ],
        nodes: [
          {adapter: 'copy', id: 'first'},
          {adapter: 'copy', id: 'second'},
        ],
      },
      [adapter(() => ++calls)],
    )
    const original = journal.append.bind(journal) // Assigned after admission, before the asynchronous first transition.
    // eslint-disable-next-line prefer-const
    let h: Awaited<ReturnType<Agent['startGraphRun']>>
    stub(journal, 'append').callsFake(async (...args) => {
      const record = await original(...args)
      if (args[1] === 'graph-transition') h.requestStop('cancelled')
      return record
    })
    h = await agent.startGraphRun(graph, 0)
    const r = await h.finished
    expect(r.outcome).not.eq('completed')
    expect(calls).eq(1)
    expect(journal.records().filter((r) => r.kind === 'graph-transition')).length(1)
  })

  it('does not publish a body value if final synchronization fails', async () => {
    const {agent, session} = create()
    let count = 0
    const sync = session.synchronize.bind(session)
    stub(session, 'synchronize').callsFake(async (level) => {
      if (++count === 3) throw new Error('final sync failed')
      return sync(level)
    })
    const graph = await compileProcessorGraph(definition, [adapter(() => 42)])
    const h = await agent.startGraphRun(graph, 0)
    const r = await h.finished
    expect(r.outcome).eq('failed')
    expect(r.recording.status).eq('failed')
    expect(h.value()).equal(undefined)
  })

  it('reopens v2 journal observations, refuses conflicting replay and preserves unknown/torn tails', async () => {
    const repository = new SessionRepository({
      journalRoot: path.join(root, 'journal'),
      rootDir: path.join(root, 'sessions'),
    })
    let calls = 0
    const session = repository.create({formatVersion: 2, id: 'saved'})
    const graph = await compileProcessorGraph(definition, [adapter(() => ++calls)])
    const a = create(undefined, {execution: {}, state: new State(session)}).agent
    const h = await a.startGraphRun(graph, 0, {requestId: 'persisted'})
    expect((await h.finished).outcome).eq('completed')
    await a.close()
    await session.close()
    const saved = repository.open((await repository.findById('saved'))!.file)
    const b = create(undefined, {execution: {}, state: new State(saved)}).agent
    await rejects(b.startGraphRun(graph, 1, {requestId: 'persisted'}), /Conflicting/)
    const recovered = await b.startGraphRun(graph, 0, {requestId: 'persisted'})
    expect((await recovered.finished).recording.status).eq('recovered')
    expect(recovered.value()).equal(undefined)
    expect(calls).eq(1)
    expect(b.getGraphSnapshot(recovered.id)?.recovered).eq(true)
    await b.close()
    await saved.close()
    const file = path.join(repository.journalRoot, 'saved', h.id, 'events.jsonl')
    const original = await fs.readFile(file, 'utf8')
    const {records} = (await inspectExecutionJournal(repository.journalRoot, 'saved')).runs[0]
    expect(
      inspectGraphRun(records, {entries: session.getEntries(), formatVersion: 2, sessionId: session.getId()})
        .transcript,
      JSON.stringify(
        inspectGraphRun(records, {entries: session.getEntries(), formatVersion: 2, sessionId: session.getId()}),
      ),
    ).eq('verified')
    for (const suffix of ['{"version":99,"kind":"unknown"}\n', '{"version":99', 'not-json\n']) {
      await fs.writeFile(file, original + suffix)
      const inspection = await inspectExecutionJournal(repository.journalRoot, 'saved')
      expect(inspection.runs[0].issue).a('string')
      expect(inspection.runs[0].records).length(records.length)
      expect(await fs.readFile(file, 'utf8')).eq(original + suffix)
    }
  })

  it('measures the initial node, edge, visit and encoded-value boundaries',async()=>{
    const nodes=Array.from({length:64},(_,i)=>({adapter:'copy',id:'n'+i}))
    const edges=nodes.map((node,i)=>({from:node.id,id:'e'+i,to:i===63?'done':nodes[i+1].id}))
    const graph=await compileProcessorGraph({edges,entry:'n0',id:'limit',nodes,terminals:definition.terminals},[adapter()]);const {agent}=create();const h=await agent.startGraphRun(graph,'x'.repeat(65_534));expect((await h.finished).outcome).eq('completed');expect(agent.getGraphSnapshot(h.id)?.visits).eq(64)
    await rejects(agent.startGraphRun(graph,'x'.repeat(65_535)),/byte/)
    await rejects(compileProcessorGraph({...definition,nodes:Array.from({length:65},(_,i)=>({adapter:'copy',id:'n'+i}))},[adapter()]),/limits/)
    const route:GraphDefinition={edges:Array.from({length:128},(_,i)=>({from:'first',id:'e'+i,label:'l'+i,to:'done'})),entry:'first',id:'edges',nodes:definition.nodes,terminals:definition.terminals}
    await compileProcessorGraph(route,[{...adapter(()=> 'l0'),kind:'router'}]);await rejects(compileProcessorGraph({...route,edges:[...route.edges,{from:'first',id:'extra',label:'extra',to:'done'}]},[{...adapter(()=> 'l0'),kind:'router'}]),/limits/)
    const cycle=await compileProcessorGraph({...route,edges:[{from:'first',id:'loop',label:'loop',to:'first'},{from:'first',id:'done',label:'done',to:'done'}]},[{...adapter(()=> 'loop'),kind:'router'}]);const second=create();const loop=await second.agent.startGraphRun(cycle,0);expect((await loop.finished).outcome).eq('budget-exceeded');expect(second.agent.getGraphSnapshot(loop.id)?.visits).eq(128)
  })

  it('protects the entire active Graph turn from compaction and excludes Skills from summaries',async()=>{
    const directory=path.join(root,'skills','review');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'SKILL.md'),'---\nname: review\ndescription: Review test\n---\nGRAPH_BUDGET_SKILL\n')
    const catalog=new SkillCatalog([{directory:path.dirname(directory),id:'local'}]);const selected=(await catalog.list()).candidates[0]
    const session=new Session({formatVersion:2});const [old]=session.appendMessages([new Message(MessageType.User,{content:'old '+ 'x'.repeat(7000)}),new Message(MessageType.Assistant,{content:'old answer'})]);let summaries=0;let ordinary=0
    const model:Model={...fakeModel(async()=>{throw new Error('Unprepared call')}),prepare(messages,options){const strings=messages.map(m=>m.content);const request=freezeModelRequest({messages:strings,tools:options?.tools ?? []});return {async invoke(){if(strings[0].startsWith('Summarize')){summaries++;expect(strings.some(s=>s.includes('GRAPH_BUDGET_SKILL'))).eq(false);expect(request.tools).deep.eq([]);return new Message(MessageType.Assistant,{content:JSON.stringify({changedPaths:[],facts:[],goals:[{sourceIds:[old.id],text:'Inspect'}],tests:[],uncertainties:[],unfinished:[],version:1})})}ordinary++;expect(strings.filter(s=>s.includes('GRAPH_BUDGET_SKILL'))).length(1);return new Message(MessageType.Assistant,{content:'current '+ 'y'.repeat(11_000)})},request}}}
    const profile={model:'fixture',outputReserve:1000,provider:'ollama' as const,revision:'fixture',safetyMargin:100,summaryOutput:800,target:2200,templateOverhead:0,trigger:3000,window:20_000}
    const {agent}=create(undefined,{contextPolicy:{estimator:request=>({components:{json:JSON.stringify(request).length},kind:'estimated',model:'fixture',provider:'ollama',revision:'chars',tokens:JSON.stringify(request).length}),mode:'budgeted',profile},deps:{createModel:()=>model},skillCatalog:catalog,state:new State(session)})
    const graph=await compileProcessorGraph({...definition,edges:[{from:'first',id:'next',to:'second'},{from:'second',id:'done',to:'done'}],nodes:[{adapter:'agent',id:'first'},{adapter:'agent',id:'second'}]},[{id:'agent',inputSchema:any,kind:'agent',outputSchema:any,version:'1'}]);const h=await agent.startGraphRun(graph,'inspect',{skills:[selected]});const result=await h.finished
    expect(result.outcome).not.eq('completed');expect(ordinary,JSON.stringify({entries:session.getEntries().filter(e=>e.type==='turn_event'),result,summaries})).eq(1);expect(summaries).eq(1);expect(session.getSkillContexts()).length(1);expect(h.value()).equal(undefined)
  })

  it('submits through the application service, observes saved evidence and deletes through the shared service',async()=>{
    const repository=new SessionRepository({journalRoot:path.join(root,'application-journal'),rootDir:path.join(root,'application-sessions')})
    const service=await OrbitApplicationService.create({contexts:[],createAgent:options=>create(undefined,{...options,execution:{}}).agent,cwd:root,logStore:new MemorySessionLogStore(),repository,settings:{model:'fixture',provider:'ollama'},settingsSources:[]})
    try {
      const thread=service.createThread({formatVersion:2});const graph=await compileProcessorGraph(definition,[adapter()]);const h=await service.startGraphRun(thread.id,graph,{answer:42},{requestId:'application'});expect((await h.completion).value).deep.eq({answer:42});expect(service.getGraphSnapshot(h.id)?.lastValue).deep.eq({answer:42});expect((await service.queryGraphRun(h.id))?.transcript).eq('verified')
      const same=await service.startGraphRun(thread.id,graph,{answer:42},{requestId:'application'});expect(same.id).eq(h.id);await rejects(service.startGraphRun(thread.id,graph,{answer:43},{requestId:'application'}),/Conflicting/)
      expect(await service.deleteSession(thread.id)).eq(true);expect(await repository.findById(thread.id)).equal(undefined);expect(await fs.readdir(path.join(repository.journalRoot,'deletions'))).not.length(0)
    } finally {await service.close()}
  })

  it('never takes a retry edge after an unknown managed operation',async()=>{
    const write=createWriteTool();let successors=0
    const remote={...write,prepare:async()=>({binding:{},effect:'opaque' as const,async execute(){throw new Error('Disconnected after a possible effect')},preview:{},revalidate:async()=>true,targets:[]})}
    const graph=await compileProcessorGraph({...definition,edges:[{from:'first',id:'retry',to:'next'},{from:'next',id:'done',to:'done'}],nodes:[{adapter:'remote',id:'first'},{adapter:'next',id:'next'}]},[{id:'remote',inputSchema:structuredClone(write.spec.inputSchema),kind:'tool',outputSchema:any,tool:{name:'write',source:write.source},version:'1'},{...adapter(()=>{successors++;return 1}),id:'next'}])
    const {agent}=create(undefined,{execution:{policy:{generation:'unknown-test',profile:'unrestricted',roots:[root]}},toolDefinitions:[remote]});const h=await agent.startGraphRun(graph,{content:'none',path:'unused'});const result=await h.finished
    expect(result.outcome).eq('incomplete');expect(result.operations[0].status).eq('unknown');expect(successors).eq(0);expect(h.value()).equal(undefined)
    // The fixed double performs no external effect; explicit reconciliation is test evidence.
    await agent.supervisor.reconcileRun(h.id,{confirmedStopped:true,operations:[{id:result.operations[0].id,status:'failed'}]})
  })

  it('rejects v2 in the unchanged pre-Graph reader and checks the whole binding record ceiling',async()=>{
    const {agent,journal}=create();const graph=await compileProcessorGraph(definition,[adapter()]);const h=await agent.startGraphRun(graph,0);await h.finished
    expect(()=>legacyValidateNext([],journal.records()[0] as unknown as Parameters<typeof legacyValidateNext>[1])).throw('version')
    const malformed=structuredClone(journal.records().find(r=>r.kind==='graph-bound')!)
    const descriptor=malformed.data.descriptor as {nodes:{inputSchema:unknown}[]}
    descriptor.nodes[0].inputSchema={type:42}
    expect(()=>validateNext(journal.records().slice(0,1),malformed)).throw('schema type')
    const record=structuredClone(journal.records().find(r=>r.kind==='graph-bound')!);record.data.descriptor='x'.repeat(1_048_576);expect(()=>validateNext(journal.records().slice(0,1),record)).throw('record limit')
    const bound=structuredClone(journal.records().find(r=>r.kind==='graph-bound')!);bound.data.configuration='unkeyed-private-value';expect(()=>validateNext(journal.records().slice(0,1),bound)).throw('identity')
  })

  it('accepts the exact descriptor byte ceiling and rejects the next byte',async()=>{
    const base=await compileProcessorGraph(definition,[{...adapter(),outputSchema:{description:''}}])
    const count=262_144-Buffer.byteLength(canonicalJSON(base.descriptor))
    const exact=await compileProcessorGraph(definition,[{...adapter(),outputSchema:{description:'x'.repeat(count)}}]);expect(Buffer.byteLength(canonicalJSON(exact.descriptor))).eq(262_144)
    await rejects(compileProcessorGraph(definition,[{...adapter(),outputSchema:{description:'x'.repeat(count+1)}}]),/byte limit/)
  })

  it('finishes a slow cooperative stage within shared finite limits',async()=>{
    const graph=await compileProcessorGraph(definition,[adapter(async input=>{await new Promise(resolve=>{setTimeout(resolve,50)});return input})]);const {agent}=create();const h=await agent.startGraphRun(graph,1,{limits:{cleanupMs:1000,elapsedMs:2000}});const result=await h.finished
    expect(result.outcome).eq('completed');expect(result.quiescence).eq(true);expect(h.value()?.value).eq(1)
  })

})
