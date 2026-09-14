// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Each fault changes and rechecks the same isolated journal. */
import {expect} from 'chai'
import {createHmac} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {GraphJSON, SkillSelection, WorkflowAuthority, WorkflowPurpose, WorkflowStore} from '../../src/index.js'

import {metricKey} from '../../src/core/evaluation/metrics.js'
import {canonicalJSON} from '../../src/core/execution/journal.js'
import {selectionJSON, selectionText} from '../../src/core/selection/validation.js'
import {
  Agent,
  compileProcessorGraph,
  inspectWorkflowCandidate,
  inspectWorkflowRunBinding,
  MemoryExecutionJournal,
  MemorySessionLogStore,
  MemoryWorkflowStore,
  OrbitApplicationService,
  parseWorkflowCandidate,
  sealWorkflowCandidate,
  selectionDigest,
  Session,
  State,
  ThreadManager,
  validateEvaluationPlan,
  WorkflowSelectionService,
} from '../../src/index.js'
import {SessionRepository} from '../session-storage-fixture.js'
import {attempt, attest, metric, plan, report} from './evaluation/fixture.js'

async function rejects(p: Promise<unknown>, pattern?: RegExp) {
  try {
    await p
  } catch (error) {
    if (pattern) expect(String(error)).match(pattern)
    return
  }

  throw new Error('Expected rejection')
}

const definition = {
  edges: [{from: 'first', id: 'end', to: 'done'}],
  entry: 'first',
  id: 'candidate',
  nodes: [{adapter: 'copy', id: 'first'}],
  terminals: [{id: 'done', outcome: 'completed' as const}],
}
async function graph(fn = (input: GraphJSON) => input) {
  return compileProcessorGraph(definition, [
    {id: 'copy', inputSchema: {}, invoke: fn, kind: 'transform', outputSchema: {}, version: '1'},
  ])
}

function evidence(text: string, slots = 1) {
  const c = parseWorkflowCandidate(text)
  const p = plan(slots)
  const config = p.variants[0].configuration
  Object.assign(config, {
    adapter: selectionDigest(c.adapters),
    application: c.projector,
    catalog: c.prepared,
    environment: c.context,
    graph: c.graph,
    limits: c.profile,
    mappingMethod: c.mapping,
    privateConfiguration: c.configuration,
  })
  const attempts = Array.from({length: slots}, (_, i) => {
    const a = attempt(i)
    a.configuration = {...config}
    return attest(a, p)
  })
  const reports = JSON.stringify({reports: [report(p, attempts)], revision: 1, selected: ['report-0']})
  const parsed = JSON.parse(reports)
  parsed.selected = [parsed.reports[0].id]
  const policy = {
    configuration: config,
    id: 'policy',
    mapping: c.mapping,
    metrics: [] as {key: string; maximum: number}[],
    plan: validateEvaluationPlan(JSON.stringify(p)).digest,
    revision: 1,
    variant: 'variant-0',
    version: '1',
  }
  return {
    attempts,
    p,
    plan: JSON.stringify(p),
    policy,
    policyText: JSON.stringify(policy),
    reports: JSON.stringify(parsed),
  }
}

const request = (id = 'request', input: unknown = 'hello', skills: unknown[] = []) =>
  JSON.stringify({id, input, revision: 1, skills})

for (const formatVersion of [2, 3] as const)
  describe('human-selected workflow candidates v' + formatVersion, () => {
    let agent: Agent
    let allowed: Set<WorkflowPurpose>
    let cap: object
    let epoch: number
    let journal: MemoryExecutionJournal
    let prepares: number
    let root: string
    let service: WorkflowSelectionService<unknown>
    let starts: number
    let store: MemoryWorkflowStore
    let authority: WorkflowAuthority
    let compiled: Awaited<ReturnType<typeof graph>>
    let ev: ReturnType<typeof evidence>
    let target: ConstructorParameters<typeof WorkflowSelectionService<unknown>>[3]
    let text: string

    beforeEach(async () => {
      root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-selection-')))
      starts = 0
      prepares = 0
      epoch = 0
      cap = {}
      allowed = new Set(['confirm', 'dispatch', 'maintain', 'read', 'register'])
      const session = new Session({formatVersion})
      journal = new MemoryExecutionJournal(session.getId(), session.acquireManagedLease())
      agent = new Agent({
        cwd: root,
        deps: {
          createMcpToolManager() {
            prepares++
            return {async close() {}, getTools: async () => []}
          },
          createModel: () => ({
            getModel: () => 'fixed',
            getName: () => 'fixed',
            getProvider: () => 'ollama',
            async invoke() {
              throw new Error('Model must not be called')
            },
            prepare() {
              throw new Error('No model preparation')
            },
          }),
        },
        execution: {journalFactory: async () => journal},
        interruptionPolicy: formatVersion === 3 ? {mode: 'verified-not-dispatched', revision: 1} : {mode: 'disabled'},
        logStore: new MemorySessionLogStore(),
        selectionProjector: {id: 'projector:1', project: (s) => ({catalog: s.catalog, skills: s.skills})},
        state: new State(session),
        toolProfile: 'none',
      })
      compiled = await graph()
      const context = agent.workflowContext()
      store = new MemoryWorkflowStore({
        context,
        mapping: 'mapping:1',
        prepared: selectionDigest({catalog: [], skills: []}),
        projector: 'projector:1',
      })
      authority = {
        verify(c, p) {
          if (c !== cap || !allowed.has(p)) throw new Error('No authority')
          return {epoch, expires: Date.now() + 600_000, principal: 'human', scope: store.scope}
        },
      }
      target = {
        context,
        encode: (g, i, skills, e) => agent.previewGraphSubmission(g, i, {skills: skills as SkillSelection[]}, e),
        identify: (value) => (value as {id: string}).id,
        mapping: 'mapping:1',
        projector: 'projector:1',
        session: session.getId(),
        async start(g, i, o) {
          starts++
          return agent.startGraphRun(g, i, {...o, skills: o.skills as SkillSelection[]})
        },
        storage: 'isolated-storage',
      }
      service = new WorkflowSelectionService(store.scope, store, authority, target)
      text = sealWorkflowCandidate({
        adapters: [{id: 'copy', version: '1'}],
        bundle: 'registered:1',
        configuration: selectionDigest(compiled.configuration),
        context,
        graph: compiled.identity,
        id: 'candidate',
        label: 'Candidate',
        mapping: 'mapping:1',
        prepared: selectionDigest({catalog: [], skills: []}),
        profile: selectionDigest(compiled.profile),
        projector: 'projector:1',
        revision: 1,
      })
      ev = evidence(text)
    })

    afterEach(async () => {
      await agent.close()
      await fs.rm(root, {force: true, recursive: true})
    })
    async function register() {
      await service.registerCandidate(text, compiled, ev.plan, ev.reports, ev.policyText, cap)
    }

    async function activate() {
      await register()
      const preview = await service.prepareSelection('candidate', 'Human reviewed evidence', cap)
      return service.confirmSelection('choice', preview, cap)
    }

    it('exports strict finite text APIs and preserves immutable manifests', () => {
      expect(Object.isFrozen(parseWorkflowCandidate(text))).eq(true)
      expect(() => parseWorkflowCandidate(text.replace('Candidate', 'Edited'))).throw('digest')
      let getters = 0
      expect(() =>
        selectionJSON({
          get x() {
            getters++
            return 1
          },
        }),
      ).throw('accessors')
      expect(getters).eq(0)
      for (const value of ['{"a":1,"a":2}', '{"x":1e999}', '['.repeat(34) + ']'.repeat(34)])
        expect(() => selectionText(value)).throw()
      expect(() => selectionText(' '.repeat(65_537))).throw('limit')
    })

    it('requires comparable passing evidence for every scheduled slot', () => {
      expect(inspectWorkflowCandidate(text, ev.plan, ev.reports, ev.policyText).eligible).eq(true)
      const payload = JSON.parse(ev.reports)
      payload.reports = [report(ev.p, [])]
      payload.selected = [payload.reports[0].id]
      expect(inspectWorkflowCandidate(text, ev.plan, JSON.stringify(payload), ev.policyText).eligible).eq(false)
      ev.attempts[0].configuration!.privateConfiguration = 'drift'
      const changed = report(ev.p, [attest(ev.attempts[0], ev.p)])
      expect(
        inspectWorkflowCandidate(
          text,
          ev.plan,
          JSON.stringify({reports: [changed], revision: 1, selected: [changed.id]}),
          ev.policyText,
        ).eligible,
      ).eq(false)
    })

    it('refuses a required metric measured over only a subset', () => {
      ev = evidence(text, 2)
      ev.attempts[0].metrics = [metric()]
      const r = report(
        ev.p,
        ev.attempts.map((a) => attest(a, ev.p)),
      )
      ev.policy.metrics = [{key: metricKey(metric()), maximum: 10}]
      const result = inspectWorkflowCandidate(
        text,
        ev.plan,
        JSON.stringify({reports: [r], revision: 1, selected: [r.id]}),
        JSON.stringify(ev.policy),
      )
      expect(result.eligible).eq(false)
    })

    it('starts unselected and does not trust a forged confirmation capability', async () => {
      await register()
      expect((await service.inspectCandidates(cap)).active).eq(null)
      await rejects(service.startSelectedGraphRun(request(), cap), /No selected/)
      await rejects(service.prepareSelection('candidate', 'choose', {human: true}), /capability/)
      expect(starts).eq(0)
    })

    it('commits one generation, rejects stale choices and returns exact retries', async () => {
      await register()
      const p = await service.prepareSelection('candidate', 'choose', cap)
      const result = await Promise.allSettled([
        service.confirmSelection('a', p, cap),
        service.confirmSelection('b', p, cap),
      ])
      expect(result.filter((r) => r.status === 'fulfilled')).length(1)
      const d = await service.confirmSelection('a', p, cap)
      expect(d.generation).eq(1)
      allowed.delete('confirm')
      expect((await service.confirmSelection('a', p, cap)).generation).eq(1)
      expect((await service.inspectCandidates(cap)).decisions).length(1)
    })

    it('serializes scoped authority revocation with confirmation', async () => {
      await register()
      const p = await service.prepareSelection('candidate', 'choose', cap)
      await service.revokeScopeAuthority(cap)
      await rejects(service.confirmSelection('a', p, cap), /authority/)
      epoch++
      await rejects(service.confirmSelection('a', p, cap), /Stale/)
    })

    it('coalesces simultaneous capture without preparing or dispatching twice', async () => {
      await activate()
      const other = new WorkflowSelectionService(store.scope, store, authority, target)
      const results = await Promise.all([
        service.startSelectedGraphRun(request(), cap),
        other.startSelectedGraphRun(request(), cap),
      ])
      const live = results.find((r) => r.kind === 'live')! as {value: {finished: Promise<{outcome: string}>}}
      expect((await live.value.finished).outcome).eq('completed')
      expect(starts).eq(1)
      expect(prepares).eq(1)
      await rejects(other.startSelectedGraphRun(request('request', 'changed'), cap), /Conflicting/)
      await service.startSelectedGraphRun(request(), cap)
      expect(starts).eq(1)
    })

    it('retains captures and exact retries after evidence withdrawal', async () => {
      await activate()
      const run = (await service.startSelectedGraphRun(request(), cap)) as {value: {finished: Promise<unknown>}}
      await run.value.finished
      await service.setAvailability('candidate', false, cap)
      await service.startSelectedGraphRun(request(), cap)
      expect(starts).eq(1)
      await rejects(service.startSelectedGraphRun(request('fresh'), cap), /ineligible/)
    })

    it('refuses changed exact submitted input before managed preparation', async () => {
      const e = {
        candidate: parseWorkflowCandidate(text).digest,
        context: agent.workflowContext(),
        generation: 1,
        prepared: selectionDigest({catalog: [], skills: []}),
        projector: 'projector:1',
        receipt: 'receipt',
        revision: 1 as const,
        scope: store.scope,
      }
      const input = agent.previewGraphSubmission(compiled, 'one', {}, e)
      await rejects(agent.startGraphRun(compiled, 'two', {selection: {expectation: e, input}}), /submission mismatch/)
      expect(prepares).eq(0)
    })

    it('checks prepared context after discovery and before the first visit', async () => {
      const m = parseWorkflowCandidate(text)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- The digest is excluded when sealing changed payload.
      const {digest: _digest, ...payload} = m
      text = sealWorkflowCandidate({...payload, prepared: '0'.repeat(64)})
      store = new MemoryWorkflowStore({
        context: agent.workflowContext(),
        mapping: 'mapping:1',
        prepared: '0'.repeat(64),
        projector: 'projector:1',
      })
      service = new WorkflowSelectionService(store.scope, store, authority, target)
      ev = evidence(text)
      await activate()
      const run = (await service.startSelectedGraphRun(request(), cap)) as {
        value: {finished: Promise<{outcome: string}>}
      }
      expect((await run.value.finished).outcome).eq('failed')
      expect(prepares).eq(1)
      expect(journal.records().filter((r) => r.kind === 'graph-node-started' || r.kind === 'run-ready')).length(0)
    })

    it('freezes uncertain acknowledgement and never grants a recovered dispatch right', async () => {
      await activate()
      let fail = false
      const host: WorkflowStore = {
        level: 'memory',
        mode: 'memory',
        read: (s) => store.read(s),
        async transact(s, update) {
          const result = await store.transact(s, update)
          if (fail) {
            fail = false
            throw new Error('ack lost')
          }

          return result
        },
      }
      const client = new WorkflowSelectionService(store.scope, host, authority, target)
      await client.registerCandidate(text, compiled, ev.plan, ev.reports, ev.policyText, cap)
      fail = true
      await rejects(client.startSelectedGraphRun(request(), cap), /ack lost/)
      expect(starts).eq(0)
      const recovered = new WorkflowSelectionService(store.scope, host, authority, target)
      expect((await recovered.startSelectedGraphRun(request(), cap)).kind).eq('observation')
      expect(starts).eq(0)
      await rejects(client.startSelectedGraphRun(request('another'), cap), /exclusive/)
    })

    it('uses a fresh volatile scope on restart and refuses wrong mode', () => {
      const other = new MemoryWorkflowStore({
        context: agent.workflowContext(),
        mapping: 'mapping:1',
        prepared: selectionDigest({catalog: [], skills: []}),
        projector: 'projector:1',
      })
      expect(other.scope).not.eq(store.scope)
      expect(
        () =>
          new WorkflowSelectionService(
            store.scope,
            {
              level: 'memory',
              mode: 'transactional-host',
              read: store.read.bind(store),
              transact: store.transact.bind(store),
            } as WorkflowStore,
            authority,
            target,
          ),
      ).throw('mode')
    })

    it('bounds retained memory without evicting existing receipts', async () => {
      const tiny = new MemoryWorkflowStore(
        {
          context: agent.workflowContext(),
          mapping: 'mapping:1',
          prepared: selectionDigest({catalog: [], skills: []}),
          projector: 'projector:1',
        },
        {bytes: 16_777_216, candidates: 1, receipts: 1},
      )
      const auth: WorkflowAuthority = {
        verify() {
          return {epoch: 0, expires: Date.now() + 60_000, principal: 'human', scope: tiny.scope}
        },
      }
      const client = new WorkflowSelectionService(tiny.scope, tiny, auth, target)
      await client.registerCandidate(text, compiled, ev.plan, ev.reports, ev.policyText, cap)
      await client.confirmSelection('one', await client.prepareSelection('candidate', 'choose', cap), cap)
      await rejects(client.startSelectedGraphRun(request(), cap), /capacity/)
      expect((await tiny.read(tiny.scope)).decisions).length(1)
      expect(starts).eq(0)
    })

    it('verifies exact journal binding read-only and preserves damaged evidence', async () => {
      await activate()
      const run = (await service.startSelectedGraphRun(request(), cap)) as {value: {finished: Promise<unknown>}}
      await run.value.finished
      const receipt = (await store.read(store.scope)).receipts[0]
      const records = structuredClone(journal.records())
      const key = Buffer.alloc(32, 7)
      const admitted = records.find((r) => r.kind === 'run-admitted')!
      admitted.data.requestDigest = createHmac('sha256', key)
        .update(canonicalJSON(JSON.parse(receipt.input)))
        .digest('hex')
      const directory = path.join(root, receipt.session)
      const file = path.join(directory, admitted.runId, 'events.jsonl')
      await fs.mkdir(path.dirname(file), {recursive: true})
      await fs.writeFile(path.join(directory, 'key'), key)
      const bytes = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      await fs.writeFile(file, bytes)
      expect((await inspectWorkflowRunBinding(root, receipt.session, receipt.request, receipt.input)).status).eq(
        'matched',
      )
      expect((await inspectWorkflowRunBinding(root, receipt.session, receipt.request, '{}')).status).eq('conflicting')
      for (const suffix of ['{"version":99}\n', '{"version":99']) {
        await fs.writeFile(file, bytes + suffix)
        expect((await inspectWorkflowRunBinding(root, receipt.session, receipt.request, receipt.input)).status).eq(
          'unverified',
        )
        expect(await fs.readFile(file, 'utf8')).eq(bytes + suffix)
      }
    })

    it('preserves evidence revisions referenced by prior choices and requests', async () => {
      await activate()
      const old = (await store.read(store.scope)).decisions[0].evidence
      const revised = JSON.parse(ev.policyText)
      revised.version = '2'
      await service.replaceEvidence('candidate', ev.plan, ev.reports, JSON.stringify(revised), cap)
      const state = await service.inspectCandidates(cap)
      expect(state.candidates.candidate.evidence.digest).not.eq(old)
      expect(state.evidence[old].policy).eq(ev.policyText)
      const preview = await service.prepareSelection('candidate', 'corrected evidence', cap)
      await service.confirmSelection('corrected', preview, cap)
      expect((await store.read(store.scope)).decisions.map((d) => d.evidence)).length(2)
    })

    it('records A to B to A as new generations while old work retains its bundle', async () => {
      let release!: (v: GraphJSON) => void
      let entered!: () => void
      const waiting = new Promise<void>((r) => {
        entered = r
      })
      compiled = await graph((() => {
        entered()
        return new Promise<GraphJSON>((r) => {
          release = r
        })
      }) as never)
      await activate()
      const old = (await service.startSelectedGraphRun(request('old'), cap)) as {
        value: {finished: Promise<{outcome: string}>; value: Promise<unknown>}
      }
      await waiting
      const otherGraph = await graph((i) => ({new: i}))
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- The digest is excluded when sealing changed payload.
      const {digest: _digest, ...payload} = parseWorkflowCandidate(text)
      const b = sealWorkflowCandidate({...payload, bundle: 'registered:2', graph: otherGraph.identity, id: 'b'})
      // Same descriptor/version but different closure is host dishonesty: use a distinct versioned adapter instead.
      const versioned = await compileProcessorGraph(
        {...definition, id: 'b', nodes: [{adapter: 'copy2', id: 'first'}]},
        [{id: 'copy2', inputSchema: {}, invoke: (i) => ({new: i}), kind: 'transform', outputSchema: {}, version: '2'}],
      )
      const valid = sealWorkflowCandidate({
        ...parsePayload(b),
        adapters: [{id: 'copy2', version: '2'}],
        configuration: selectionDigest(versioned.configuration),
        graph: versioned.identity,
      })
      const e = evidence(valid)
      await service.registerCandidate(valid, versioned, e.plan, e.reports, e.policyText, cap)
      const stale = await service.prepareSelection('candidate', 'stale', cap)
      await service.confirmSelection('b', await service.prepareSelection('b', 'B', cap), cap)
      await service.confirmSelection('back', await service.prepareSelection('candidate', 'Return to A', cap), cap)
      await rejects(service.confirmSelection('stale', stale, cap), /Stale/)
      release('old result')
      expect((await old.value.finished).outcome).eq('completed')
      const state = await service.inspectCandidates(cap)
      expect(state.generation).eq(3)
      expect(state.receipts[0].candidate).eq('candidate')
      expect(starts).eq(1)
    })

    it('consumes definite pre-dispatch refusal and requires a fresh request ID', async () => {
      await activate()
      let available = false
      const client = new WorkflowSelectionService(store.scope, store, authority, {
        ...target,
        availability: () => ({available, reason: 'busy'}),
      })
      await client.registerCandidate(text, compiled, ev.plan, ev.reports, ev.policyText, cap)
      const refused = await client.startSelectedGraphRun(request(), cap)
      expect(refused.kind).eq('observation')
      expect(refused.receipt.observations![0].status).eq('not-admitted')
      expect(starts).eq(0)
      available = true
      await client.startSelectedGraphRun(request(), cap)
      expect(starts).eq(0)
      const run = (await client.startSelectedGraphRun(request('fresh'), cap)) as {value: {finished: Promise<unknown>}}
      await run.value.finished
      expect(starts).eq(1)
    })

    it('blocks new capture when declarations drift before MCP preparation', async () => {
      await activate()
      agent.settings.model = 'changed'
      const run = (await service.startSelectedGraphRun(request(), cap)) as {
        value: {finished: Promise<{outcome: string}>}
      }
      expect((await run.value.finished).outcome).eq('failed')
      expect(prepares).eq(0)
    })

    it('rejects store continuity corruption before dispatch', async () => {
      await activate()
      const broken: WorkflowStore = {
        level: 'memory',
        mode: 'memory',
        async read(scope) {
          const s = structuredClone(await store.read(scope))
          s.active = null
          return s
        },
        transact: store.transact.bind(store),
      }
      await rejects(
        new WorkflowSelectionService(store.scope, broken, authority, target).startSelectedGraphRun(request(), cap),
        /active/,
      )
      expect(starts).eq(0)
    })

    it('keeps later observations separate and never converts them to dispatch rights', async () => {
      await activate()
      const run = (await service.startSelectedGraphRun(request(), cap)) as {value: {finished: Promise<unknown>}}
      await run.value.finished
      const receipt = (await store.read(store.scope)).receipts[0]
      await service.recordObservation(receipt.id, {issues: ['key missing'], status: 'unverified'}, cap)
      await service.recordObservation(
        receipt.id,
        {
          issues: [],
          runId: 'existing',
          settlement: {quiescent: true},
          status: 'matched',
          terminal: {outcome: 'unknown'},
        },
        cap,
      )
      const history = (await service.inspectCandidates(cap)).receipts[0].observations!
      expect(history).length(3)
      expect(history[1].status).eq('unverified')
      await new WorkflowSelectionService(store.scope, store, authority, target).startSelectedGraphRun(request(), cap)
      expect(starts).eq(1)
    })

    it('forwards the same selection envelope through ThreadManager and rejects reordered replay', async () => {
      const manager = new ThreadManager({createAgent: () => agent})
      const thread = manager.createThread({
        agent: {state: agent.state},
        formatVersion,
        id: agent.state.getSession().getId(),
      })
      const e = {
        candidate: parseWorkflowCandidate(text).digest,
        context: agent.workflowContext(),
        generation: 1,
        prepared: selectionDigest({catalog: [], skills: []}),
        projector: 'projector:1',
        receipt: 'receipt',
        revision: 1 as const,
        scope: store.scope,
      }
      const input = manager.previewSelectedGraph(thread.id, compiled, 'hello', {}, e)
      const run = manager.startGraphRun(thread.id, compiled, 'hello', {
        requestId: 'thread-selected',
        selection: {expectation: e, input},
      })
      await run.admitted
      await run.completion
      expect(
        manager.startGraphRun(thread.id, compiled, 'hello', {
          requestId: 'thread-selected',
          selection: {expectation: e, input},
        }),
      ).eq(run)
      expect(() =>
        manager.startGraphRun(thread.id, compiled, 'hello', {
          requestId: 'thread-selected',
          selection: {expectation: {...e, receipt: 'changed'}, input},
        }),
      ).throw('Conflicting')
      expect(prepares).eq(1)
      await manager.close()
    })

    it('coordinates selected Application Service calls and blocks ordinary surface bypass', async () => {
      let active!: Agent
      const app = new OrbitApplicationService({
        contexts: [],
        createAgent(options) {
          active = new Agent({
            ...options,
            deps: {
              createMcpToolManager: () => ({async close() {}, getTools: async () => []}),
              createModel: () => ({
                getModel: () => 'fixed',
                getName: () => 'fixed',
                getProvider: () => 'ollama',
                async invoke() {
                  throw new Error('No model')
                },
                prepare() {
                  throw new Error('No model preparation')
                },
              }),
            },
            execution: {
              journalFactory: async (session) =>
                new MemoryExecutionJournal(session.getId(), session.acquireManagedLease()),
            },
            selectionProjector: {id: 'projector:1', project: (s) => ({catalog: s.catalog, skills: s.skills})},
            toolProfile: 'none',
          })
          return active
        },
        cwd: root,
        logStore: new MemorySessionLogStore(),
        model: 'fixed',
        provider: 'ollama',
        repository: new SessionRepository({rootDir: path.join(root, 'app-sessions')}),
        settings: formatVersion === 3 ? {interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1}} : {},
        settingsSources: [],
        version: 'test',
      })
      try {
        const thread = app.createThread({formatVersion})
        const context = app.workflowContext(thread.id)
        const memory = new MemoryWorkflowStore({
          context,
          mapping: 'mapping:1',
          prepared: selectionDigest({catalog: [], skills: []}),
          projector: 'projector:1',
        })
        const auth: WorkflowAuthority = {
          verify(c) {
            if (c !== cap) throw new Error('No authority')
            return {epoch: 0, expires: Date.now() + 60_000, principal: 'human', scope: memory.scope}
          },
        }
        const selected = app.createWorkflowSelection(thread.id, {
          authority: auth,
          context,
          mapping: 'mapping:1',
          projector: 'projector:1',
          scope: memory.scope,
          storage: 'isolated-app-storage',
          store: memory,
        })
        const manifest = sealWorkflowCandidate({...parsePayload(text), context})
        const e = evidence(manifest)
        await selected.registerCandidate(manifest, compiled, e.plan, e.reports, e.policyText, cap)
        await selected.confirmSelection('app-choice', await selected.prepareSelection('candidate', 'choose', cap), cap)
        await rejects(app.startRun(thread.id, 'bypass'), /coordinator/)
        await rejects(app.startGraphRun(thread.id, compiled, 'bypass'), /coordinator/)
        const result = await selected.startSelectedGraphRun(request('app-request'), cap)
        expect(result.kind).eq('live')
        if (result.kind === 'live') await result.value.completion
        expect((await selected.startSelectedGraphRun(request('app-request'), cap)).kind).eq('live')
        expect(active.state.getSession().getId()).eq(thread.id)
      } finally {
        await app.close()
      }
    })

    it('rejects stale prepared expectation without calling its projector twice', async () => {
      await activate()
      const run = (await service.startSelectedGraphRun(request(), cap)) as {value: {finished: Promise<unknown>}}
      await run.value.finished
      await service.startSelectedGraphRun(request(), cap)
      expect(prepares).eq(1)
      const changed = request('request', 'hello', [{digest: 'b'.repeat(64), id: 'a'.repeat(64)}])
      await rejects(service.startSelectedGraphRun(changed, cap), /Conflicting/)
      expect(prepares).eq(1)
    })

    it('rejects unavailable journal keys and aliases without writing', async () => {
      expect((await inspectWorkflowRunBinding(root, 'session', 'request', '{}')).status).eq('unverified')
      const directory = path.join(root, 'session')
      await fs.mkdir(directory)
      await fs.writeFile(path.join(directory, 'key'), Buffer.alloc(32))
      const link = path.join(root, 'alias')
      await fs.symlink(directory, link)
      expect((await inspectWorkflowRunBinding(root, 'alias', 'request', '{}')).status).eq('unverified')
      expect(await fs.readdir(directory)).deep.eq(['key'])
    })

    it('requires a new human confirmation after replacing active evidence', async () => {
      await activate()
      const policy = {...JSON.parse(ev.policyText), version: '2'}
      await service.replaceEvidence('candidate', ev.plan, ev.reports, JSON.stringify(policy), cap)
      await rejects(service.startSelectedGraphRun(request(), cap), /human confirmation/)
      expect(starts).eq(0)
      await service.confirmSelection('correction', await service.prepareSelection('candidate', 'corrected', cap), cap)
      const result = (await service.startSelectedGraphRun(request(), cap)) as {value: {finished: Promise<unknown>}}
      await result.value.finished
      expect(starts).eq(1)
    })

    it('retains original cancellation while withdrawal and replay cannot start replacement work', async () => {
      let release!: (v: GraphJSON) => void
      let entered!: () => void
      const waiting = new Promise<void>((r) => {
        entered = r
      })
      compiled = await graph((() => {
        entered()
        return new Promise<GraphJSON>((r) => {
          release = r
        })
      }) as never)
      await activate()
      const result = (await service.startSelectedGraphRun(request(), cap)) as {
        value: {finished: Promise<{outcome: string}>; id: string}
      }
      await waiting
      await service.setAvailability('candidate', false, cap)
      agent.supervisor.requestStop(result.value.id, 'cancelled')
      release('late')
      expect((await result.value.finished).outcome).eq('cancelled')
      await service.startSelectedGraphRun(request(), cap)
      expect(starts).eq(1)
    })

    it('rejects another prepared catalog within the same fixed scope', async () => {
      const changed = sealWorkflowCandidate({...parsePayload(text), id: 'other', prepared: '0'.repeat(64)})
      const e = evidence(changed)
      await rejects(
        service.registerCandidate(changed, compiled, e.plan, e.reports, e.policyText, cap),
        /scope mismatch/,
      )
      expect((await service.inspectCandidates(cap)).candidates).deep.eq({})
    })

    it('retains fixed revision ceilings when a producer lowers memory limits', () => {
      const large = {value: 'x'.repeat(65_000)}
      expect(selectionJSON(large).length).greaterThan(65_000)
      expect(() => selectionJSON({value: 'x'.repeat(65_536)})).throw('limit')
      expect(() => selectionJSON(Array.from({length: 2}))).throw()
      expect(() => parseWorkflowCandidate(text.replace('"revision":1', '"revision":2'))).throw()
    })
  })
function parsePayload(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- The digest is excluded when sealing changed payload.
  const {digest: _digest, ...payload} = parseWorkflowCandidate(text)
  return payload
}
