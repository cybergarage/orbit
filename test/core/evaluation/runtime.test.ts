// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {EvaluationAttempt, EvaluationPlan, Model} from '../../../src/index.js'

import {recoveredRunSnapshot} from '../../../src/core/execution/run.js'
import {encodeSessionEntry} from '../../../src/core/session/codec.js'
import {
  Agent,
  compareEvaluationReports,
  compileProcessorGraph,
  createWriteTool,
  inspectEvaluationEvidence,
  MemoryExecutionJournal,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  SkillCatalog,
  State,
} from '../../../src/index.js'
import {attempt, attest, metric, plan, report} from './fixture.js'

function rawPlan(): EvaluationPlan {
  const p = plan()
  p.cases[0].evidence.push(
    ...(['journal', 'transcript'] as const).map((category) => ({
      category,
      core: true,
      scope: 'whole-attempt',
      stages: ['admitted'] as ['admitted'],
      verifiers: [],
    })),
  )
  return p
}

const inspect = (a: EvaluationAttempt, p = rawPlan()) =>
  inspectEvaluationEvidence(JSON.stringify(p), JSON.stringify(a), 'variant-0')

describe('evaluation of existing managed runtime evidence', () => {
  let root: string
  let agent: Agent | undefined

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-evaluation-'))
  })

  afterEach(async () => {
    restore()
    await agent?.close()
    agent = undefined
    await fs.rm(root, {force: true, recursive: true})
  })

  async function capture(graph: boolean, skills = false, fail = false) {
    let calls = 0
    const model: Model = {
      getModel: () => 'fixed',
      getName: () => 'fixed',
      getProvider: () => 'ollama',
      async invoke() {
        calls++
        if (fail) throw new Error('fixed failure')
        return new Message(MessageType.Assistant, {content: 'answer'})
      },
    }
    const session = new Session({formatVersion: 2})
    const journal = new MemoryExecutionJournal(session.getId(), session.acquireManagedLease())
    let catalog: SkillCatalog | undefined
    if (skills) {
      const directory = path.join(root, 'skills', 'review')
      await fs.mkdir(directory, {recursive: true})
      await fs.writeFile(
        path.join(directory, 'SKILL.md'),
        '\uFEFF---\r\nname: review\r\ndescription: Independent review instructions\r\n---\r\n' +
          'Inspect output. '.repeat(400),
      )
      catalog = new SkillCatalog([{directory: path.dirname(directory), id: 'local'}])
    }

    agent = new Agent({
      cwd: root,
      deps: {createModel: () => model},
      execution: {journalFactory: async () => journal},
      logStore: new MemorySessionLogStore(),
      state: new State(session),
      toolProfile: 'none',
      ...(catalog ? {skillCatalog: catalog} : {}),
    })
    const options = {requestId: 'request', ...(catalog ? {skills: (await catalog.list()).candidates} : {})}
    const compiled = await compileProcessorGraph(
      {
        edges: [{from: 'agent', id: 'end', to: 'done'}],
        entry: 'agent',
        id: 'pipeline',
        nodes: [{adapter: 'agent', id: 'agent'}],
        terminals: [{id: 'done', outcome: 'completed'}],
      },
      [{id: 'agent', inputSchema: {}, kind: 'agent', outputSchema: {}, version: '1'}],
    )
    const handle = graph
      ? await agent.startGraphRun(compiled, 'inspect', options)
      : await agent.startRun([new Message(MessageType.User, {content: 'inspect'})], options)
    const result = await handle.finished
    const a = attempt()
    a.identity = {
      namespace: 'fresh-pair',
      requestId: 'request',
      runId: result.runId,
      sessionId: result.sessionId,
      storageIdentity: 'fresh-storage',
    }
    a.runtime = {
      outcome: result.outcome,
      quiescence: result.quiescence,
      raw: JSON.stringify(result),
      recording: result.recording,
    }
    a.quiescent = result.quiescence
    attest(a, rawPlan())
    const metadata = session.getMetadata()
    const header = {
      cwd: root,
      id: session.getId(),
      rootMessageId: metadata.rootMessageId!,
      timestamp: metadata.createdAt,
      type: 'session' as const,
      version: 2 as const,
    }
    a.evidence.push(
      {
        capturedAt: '2026-09-13T00:00:00Z',
        category: 'journal',
        complete: true,
        findings: [],
        highWater: journal.records().length,
        kind: 'core',
        raw:
          journal
            .records()
            .map((r) => JSON.stringify(r))
            .join('\n') + '\n',
        scope: 'whole-attempt',
        source: 'supplied-journal',
      },
      {
        capturedAt: '2026-09-13T00:00:00Z',
        category: 'transcript',
        complete: true,
        findings: [],
        highWater: session.getEntries().length,
        kind: 'core',
        raw: [header, ...session.getEntries()].map((entry) => encodeSessionEntry(entry)).join(''),
        scope: 'whole-attempt',
        source: 'supplied-transcript',
      },
    )
    return {a, calls: () => calls, handle, journal}
  }

  for (const graph of [false, true]) {
    it(`inspects an actual ${graph ? 'Graph' : 'Agent'} prefix without rerunning its fixed model or accessing storage`, async () => {
      const {a, calls} = await capture(graph, true)
      const count = calls()
      const read = stub(fs, 'readFile').rejects(new Error('No reads allowed during inspection'))
      const fetch = stub(globalThis, 'fetch').rejects(new Error('No network access during inspection'))
      const write = stub(fs, 'writeFile').rejects(new Error('No writes allowed during inspection'))
      const result = inspect(a)
      expect(result.issues, JSON.stringify(result)).deep.eq([])
      expect(result.disposition).eq('pass')
      expect(result.evidence.filter((e) => e.kind === 'core' && e.valid)).length(2)
      expect(calls()).eq(count)
      expect(read.called || write.called || fetch.called).eq(false)
    })
    it(`retains actual ${graph ? 'Graph' : 'Agent'} model failure separately from independent grading`, async () => {
      const {a} = await capture(graph, false, true)
      expect(inspect(a).disposition).eq('fail')
      expect(inspect(a).runtime).eq('failed')
    })
  }

  it('retains restored placeholder counters outside the original terminal evidence', async () => {
    const {a, handle, journal} = await capture(false)
    const restored = recoveredRunSnapshot(handle.id, a.identity!.sessionId, journal.records(), {
      level: 'memory',
      mode: 'memory',
    })
    expect(restored.budget.modelCalls).eq(0)
    expect(handle.getSnapshot().budget.modelCalls).eq(1)
    expect(inspect(a).disposition).eq('pass')
  })
  for (const problem of [
    'torn',
    'unknown-complete',
    'missing-terminal',
    'high-water',
    'duplicate-key',
    'mismatched-operation',
    'recording-mismatch',
    'missing-configuration',
  ] as const) {
    it(`retains ${problem} journal findings and cannot pass`, async () => {
      const {a} = await capture(true)
      const item = a.evidence.find((e) => e.kind === 'core' && e.category === 'journal')!
      if (item.kind !== 'core') throw new Error('fixture')
      const records = item.raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      if (problem === 'torn') item.raw += '{'
      if (problem === 'unknown-complete') item.raw += '{"kind":"future"}\n'
      if (problem === 'missing-terminal')
        item.raw =
          records
            .slice(0, -1)
            .map((r) => JSON.stringify(r))
            .join('\n') + '\n'
      if (problem === 'high-water') item.highWater++
      if (problem === 'duplicate-key') item.raw = item.raw.replace('"version":2', '"version":2,"version":2')
      if (problem === 'recording-mismatch') {
        records[0].data.level = 'file-sync'
        item.raw = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      }

      if (problem === 'missing-configuration') {
        delete records[0].data.configuration
        item.raw = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      }

      if (problem === 'mismatched-operation') {
        records.at(-1).data.operations = [{id: 'invented', status: 'succeeded'}]
        item.raw = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      }

      expect(inspect(a).disposition).eq('indeterminate')
      expect(inspect(a).evidence.find((e) => e.category === 'journal')!.valid).eq(false)
    })
  }

  it('validates Skill source derivation beyond a valid Graph reference', async () => {
    const {a} = await capture(true, true)
    const item = a.evidence.find((e) => e.kind === 'core' && e.category === 'transcript')!
    if (item.kind !== 'core') throw new Error('fixture')
    const records = item.raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const skill = records.find((r) => r.type === 'skill_context')
    expect(skill.skills[0].source).contains('\uFEFF')
    expect(Buffer.byteLength(skill.skills[0].source)).greaterThan(2048)
    skill.skills[0].body = 'different instructions'
    item.raw = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    expect(inspect(a).issues.join(' ')).contains('derivation')
    expect(inspect(a).disposition).eq('indeterminate')
  })

  it('reads a historical Skill record at 4 MiB and reports a one-byte excess as out of profile', async () => {
    const {a} = await capture(true, true)
    const p = rawPlan()
    p.cases[0].evidence = p.cases[0].evidence.filter((e) => e.category !== 'journal')
    a.evidence = a.evidence.filter((e) => e.category !== 'journal')
    const item = a.evidence.find((e) => e.kind === 'core' && e.category === 'transcript')!
    if (item.kind !== 'core') throw new Error('fixture')
    const entries = item.raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const record = entries.find((e) => e.type === 'skill_context')
    const skill = record.skills[0]
    const prefix = '---\nname: review\ndescription: Independent review instructions\n---\n'
    const resize = (n: number) => {
      skill.body = 'a'.repeat(n)
      skill.source = prefix + skill.body
      skill.bytes = Buffer.byteLength(skill.source)
      skill.digest = createHash('sha256').update(skill.source).digest('hex')
    }

    resize(2_090_000)
    const limit = 4 * 1024 * 1024
    resize(skill.body.length + Math.floor((limit - Buffer.byteLength(JSON.stringify(record))) / 2))
    while (Buffer.byteLength(JSON.stringify(record)) < limit) record.timestamp += 'Z'
    expect(Buffer.byteLength(JSON.stringify(record))).eq(limit)
    item.raw = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    let result = inspect(a, p)
    expect(result.evidence.find((e) => e.kind === 'core')!.issues).deep.eq([])
    record.timestamp += 'Z'
    item.raw = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    result = inspect(a, p)
    expect(result.issues.join(' ')).contains('out of profile')
    expect(result.disposition).eq('indeterminate')
  })

  it('compares two small coding trials with actual edits and final counters under the initial profile', async () => {
    const p = rawPlan()
    p.variants = plan(1, 2).variants
    p.variants[1].configuration.graph = 'single-agent-stage-v1'
    const reports = await Promise.all(
      p.variants.map(async (variant, index) => {
        const target = path.join(root, variant.id)
        await fs.mkdir(target)
        await fs.writeFile(path.join(target, 'sum.mjs'), 'export const sum = (a, b) => a - b\n')
        const expected = 'export const sum = (a, b) => a + b\n'
        const session = new Session({formatVersion: 2})
        const journal = new MemoryExecutionJournal(session.getId(), session.acquireManagedLease())
        let calls = 0
        const model: Model = {
          getModel: () => 'fixed-coding',
          getName: () => 'fixed',
          getProvider: () => 'ollama',
          async invoke() {
            return ++calls === 1
              ? new Message(MessageType.Assistant, {
                  payload: {
                    toolCalls: [{id: 'write-code', input: {content: expected, path: 'sum.mjs'}, name: 'write'}],
                  },
                })
              : new Message(MessageType.Assistant, {content: 'Edited the target'})
          },
        }
        const codingAgent = new Agent({
          cwd: target,
          deps: {createModel: () => model},
          execution: {
            journalFactory: async () => journal,
            policy: {generation: 'fixed-test', profile: 'unrestricted', roots: [target]},
          },
          logStore: new MemorySessionLogStore(),
          state: new State(session),
          toolDefinitions: [createWriteTool()],
          toolProfile: 'none',
        })
        try {
          const graph = await compileProcessorGraph(
            {
              edges: [{from: 'agent', id: 'end', to: 'done'}],
              entry: 'agent',
              id: 'pipeline',
              nodes: [{adapter: 'agent', id: 'agent'}],
              terminals: [{id: 'done', outcome: 'completed'}],
            },
            [{id: 'agent', inputSchema: {}, kind: 'agent', outputSchema: {}, version: '1'}],
          )
          const handle =
            index === 0
              ? await codingAgent.startRun([new Message(MessageType.User, {content: 'Fix sum'})], {
                  requestId: 'request',
                })
              : await codingAgent.startGraphRun(graph, 'Fix sum', {requestId: 'request'})
          const result = await handle.finished
          expect(result.quiescence).eq(true)
          const before = await fs.readFile(path.join(target, 'sum.mjs'), 'utf8')
          // The oracle is fixed by the host and cannot be edited by this candidate.
          const passed = before === expected && (await fs.readdir(target)).join(',') === 'sum.mjs'
          const after = await fs.readFile(path.join(target, 'sum.mjs'), 'utf8')
          const hash = (text: string) => createHash('sha256').update(text).digest('hex')
          const a = attempt(0, index)
          a.identity = {...a.identity!, runId: result.runId, sessionId: result.sessionId}
          a.configuration = variant.configuration
          a.runtime = {
            outcome: result.outcome,
            quiescence: result.quiescence,
            raw: JSON.stringify(result),
            recording: result.recording,
          }
          a.artifact = {
            ...a.artifact!,
            after: hash(after),
            before: hash(before),
            frozen: 'verified-unchanged',
            id: hash(before),
          }
          a.checks[0].artifactId = a.artifact.id
          a.checks[0].result = passed ? 'pass' : 'fail'
          a.metrics = [{...metric(), source: variant.id, value: handle.getSnapshot().budget.modelCalls}]
          attest(a, p)
          const meta = session.getMetadata()
          a.evidence.push(
            {
              capturedAt: '2026-09-13T00:00:00Z',
              category: 'journal',
              complete: true,
              findings: [],
              highWater: journal.records().length,
              kind: 'core',
              raw:
                journal
                  .records()
                  .map((r) => JSON.stringify(r))
                  .join('\n') + '\n',
              scope: 'whole-attempt',
              source: variant.id,
            },
            {
              capturedAt: '2026-09-13T00:00:00Z',
              category: 'transcript',
              complete: true,
              findings: [],
              highWater: session.getEntries().length,
              kind: 'core',
              raw: [
                {
                  cwd: target,
                  id: session.getId(),
                  rootMessageId: meta.rootMessageId!,
                  timestamp: meta.createdAt,
                  type: 'session' as const,
                  version: 2 as const,
                },
                ...session.getEntries(),
              ]
                .map((e) => encodeSessionEntry(e))
                .join(''),
              scope: 'whole-attempt',
              source: variant.id,
            },
          )
          return report(p, [a], variant.id)
        } finally {
          await codingAgent.close()
        }
      }),
    )
    const text = JSON.stringify({reports, revision: 1, selected: reports.map((r) => r.id)})
    const result = compareEvaluationReports(JSON.stringify(p), text)
    expect(result.rows.map((r) => r.inspection!.issues)).deep.eq([[], []])
    expect(result.variants.map((v) => v.passes)).deep.eq([1, 1])
    expect(result.metrics.map((m) => m.sum)).deep.eq([2, 2])
    expect(Buffer.byteLength(text)).lessThan(100_000)
  })
})
