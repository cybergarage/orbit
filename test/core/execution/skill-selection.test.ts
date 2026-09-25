// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop, n/no-unsupported-features/node-builtins */
// Fixture steps deliberately serialize writes; fetch is exercised on supported Node 20+.
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {ContextPolicy, Model, SkillIO, SkillSnapshot} from '../../../src/core/index.js'

import {startGuiServer} from '../../../src/apps/gui/server.js'
import {
  Agent,
  MemoryExecutionJournal,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  Session,
  SkillCatalog,
  State,
} from '../../../src/core/index.js'
import {
  createInitialInteractiveState,
  handleSkillCommand,
  submitInteractiveInput,
} from '../../../src/core/interactive.js'
import {freezeModelRequest} from '../../../src/core/models/prepared.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'
import {SessionRepository} from '../../session-storage-fixture.js'
import {parseSessionFile as parseOldSession} from './fixtures/pre-skill-v2-codec.js'

const marker = 'SKILL_ONLY_SENTINEL'
const profile = {
  model: 'fixture',
  outputReserve: 1000,
  provider: 'ollama',
  revision: 'fixture',
  safetyMargin: 100,
  summaryOutput: 800,
  target: 2200,
  templateOverhead: 0,
  trigger: 3000,
  window: 20_000,
}
const policy: ContextPolicy = {
  estimator: (request) => ({
    components: {json: JSON.stringify(request).length},
    kind: 'estimated',
    model: 'fixture',
    provider: 'ollama',
    revision: 'chars',
    tokens: JSON.stringify(request).length,
  }),
  mode: 'budgeted',
  profile,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return {promise, resolve}
}

function model(invoke: Model['invoke']): Model {
  return {getModel: () => 'fixture', getName: () => 'fixture', getProvider: () => 'ollama', invoke}
}

describe('managed Skill execution and surfaces', () => {
  let logs: MemorySessionLogStore
  let root: string

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-skill-run-')))
    logs = new MemorySessionLogStore()
  })

  afterEach(async () => {
    restore()
    await logs.close()
    await fs.rm(root, {force: true, recursive: true})
  })
  async function catalog(io?: SkillIO, body = marker) {
    for (const name of ['review', 'investigate']) {
      await fs.mkdir(path.join(root, 'skills', name), {recursive: true})
      await fs.writeFile(
        path.join(root, 'skills', name, 'SKILL.md'),
        `\uFEFF---\r\nname: ${name}\r\ndescription: Isolated investigation fixture\r\n---\r\n${body}\r\n`,
      )
    }

    const c = new SkillCatalog([{directory: path.join(root, 'skills'), id: 'local'}], {}, io)
    const list = await c.list()
    expect(list.candidates).to.have.length(2)
    return {c, selected: list.candidates}
  }

  function agent(
    session: Session,
    c: SkillCatalog,
    model: Model,
    extra: Partial<ConstructorParameters<typeof Agent>[0]> = {},
  ) {
    return new Agent({
      cwd: root,
      deps: {createModel: () => model},
      logStore: logs,
      settings: {model: 'fixture', provider: 'ollama'},
      skillCatalog: c,
      state: new State(session),
      toolProfile: 'none',
      ...extra,
    })
  }

  for (const budgeted of [false, true])
    it('keeps the prefix in each ordinary iteration, budgeted=' + budgeted, async () => {
      const {c, selected} = await catalog()
      const session = new Session({formatVersion: 2})
      let calls = 0
      const check = async (messages: Message[]) => {
        calls++
        expect(messages.filter((m) => m.content.includes(marker))).to.have.length(1)
        expect(session.getSkillContexts()).to.have.length(1)
        if (calls === 1) {
          await fs.writeFile(selected[0].file, 'changed after snapshot')
          return new Message(MessageType.Assistant, {
            payload: {toolCalls: [{id: 'forbidden', input: {command: 'false'}, name: 'bash'}]},
          })
        }

        return new Message(MessageType.Assistant, {content: 'Done'})
      }

      const m: Model = {
        ...model(check),
        prepare(messages) {
          const request = freezeModelRequest({messages: messages.map((m) => m.content)})
          return {invoke: () => check(messages), request}
        },
      }
      const a = agent(session, c, m, {contextPolicy: budgeted ? policy : {mode: 'disabled'}})
      try {
        const handle = await a.startRun([new Message(MessageType.User, {content: 'Investigate'})], {
          skills: [selected[0]],
        })
        const result = await handle.finished
        expect(result.outcome, JSON.stringify(result)).to.equal('completed')
        expect(calls).to.equal(2)
        expect(session.getConversationMessages().some((m) => m.content.includes(marker))).to.equal(false)
        expect(result.operations.every((o) => o.status !== 'succeeded')).to.equal(true)
      } finally {
        await a.close()
      }
    })

  it('excludes active bodies and tools from the dedicated summary and restores them for answering', async () => {
    const {c, selected} = await catalog()
    const session = new Session({formatVersion: 2})
    const [old] = session.appendMessages([
      new Message(MessageType.User, {content: 'old ' + 'x'.repeat(7000)}),
      new Message(MessageType.Assistant, {content: 'Old failure'}),
    ])
    const requests: string[][] = []
    const m: Model = {
      ...model(async () => {
        throw new Error('Unexpected unprepared call')
      }),
      prepare(messages, options) {
        const strings = messages.map((m) => m.content)
        const request = freezeModelRequest({messages: strings, tools: options?.tools ?? []})
        return {
          async invoke() {
            requests.push(strings)
            if (strings[0].startsWith('Summarize')) {
              expect(strings.some((s) => s.includes(marker))).to.equal(false)
              expect(request.tools).to.deep.equal([])
              return new Message(MessageType.Assistant, {
                content: JSON.stringify({
                  changedPaths: [],
                  facts: [],
                  goals: [{sourceIds: [old.id], text: 'Investigate'}],
                  tests: [],
                  uncertainties: [],
                  unfinished: [],
                  version: 1,
                }),
              })
            }

            expect(strings.filter((s) => s.includes(marker))).to.have.length(1)
            return new Message(MessageType.Assistant, {content: 'Done'})
          },
          request,
        }
      },
    }
    const a = agent(session, c, m, {contextPolicy: policy})
    try {
      const result = await (
        await a.startRun([new Message(MessageType.User, {content: 'Continue'})], {skills: [selected[0]]})
      ).finished
      expect(result.outcome, JSON.stringify(result)).to.equal('completed')
      expect(requests).to.have.length(2)
      expect(session.getCompaction()).not.to.equal(undefined)
    } finally {
      await a.close()
    }
  })

  it('refuses protected Skill overflow without trimming or making a model call', async () => {
    const {c, selected} = await catalog(undefined, marker + 'x'.repeat(25_000))
    let calls = 0
    const m: Model = {
      ...model(async () => {
        calls++
        return new Message(MessageType.Assistant)
      }),
      prepare(messages) {
        return {
          async invoke() {
            calls++
            return new Message(MessageType.Assistant)
          },
          request: freezeModelRequest({messages: messages.map((m) => m.content)}),
        }
      },
    }
    const a = agent(new Session({formatVersion: 2}), c, m, {contextPolicy: policy})
    try {
      expect(
        (
          await (
            await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: [selected[0]]})
          ).finished
        ).outcome,
      ).not.to.equal('completed')
      expect(calls).to.equal(0)
    } finally {
      await a.close()
    }
  })

  it('owns late selected-file opens after deadline and closes them before reconciliation', async () => {
    let closes = 0
    let delay = false
    const entered = deferred<void>()
    const release = deferred<void>()
    const io: SkillIO = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        const h = await fs.open(...args)
        if (delay) {
          entered.resolve()
          await release.promise
          const close = h.close.bind(h)
          h.close = async () => {
            closes++
            await close()
          }
        }

        return h
      },
    }
    const {c, selected} = await catalog(io)
    delay = true
    let calls = 0
    const session = new Session({formatVersion: 2})
    const a = agent(
      session,
      c,
      model(async () => {
        calls++
        return new Message(MessageType.Assistant)
      }),
      {execution: {limits: {cleanupMs: 15, elapsedMs: 100}}},
    )
    const settled = deferred<void>()
    try {
      const handle = await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {
        onRunSnapshot(snapshot) {
          if (snapshot.result && snapshot.unresolved.length === 0) settled.resolve()
        },
        skills: [selected[0]],
      })
      await entered.promise
      const result = await handle.finished
      expect(result.outcome).to.equal('incomplete')
      expect(result.quiescence).to.equal(false)
      expect(result.unresolved.some((s) => s.includes('skill-resolution'))).to.equal(true)
      release.resolve()
      await settled.promise
      expect(closes).to.equal(1)
      expect(calls).to.equal(0)
      expect(session.getSkillContexts()).to.deep.equal([])
      expect(handle.getSnapshot().unresolved).to.deep.equal([])
      await a.supervisor.reconcileRun(result.runId, {confirmedStopped: true, operations: []})
    } finally {
      release.resolve()
      await a.close()
    }
  })

  it('blocks model use when transcript synchronization fails', async () => {
    const session = new Session({formatVersion: 2})
    const {c, selected} = await catalog()
    let calls = 0
    stub(session, 'synchronize').rejects(new Error('Injected transcript sync failure'))
    const a = agent(
      session,
      c,
      model(async () => {
        calls++
        return new Message(MessageType.Assistant)
      }),
    )
    try {
      const result = await (
        await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: [selected[0]]})
      ).finished
      expect(result.outcome).to.equal('failed')
      expect(result.recording.status).to.equal('failed')
      expect(calls).to.equal(0)
      expect(session.getSkillContexts()).to.have.length(1)
    } finally {
      restore()
      await a.close().catch(() => {})
    }
  })

  it('retains ownership when cancellation interrupts transcript synchronization', async () => {
    const session = new Session({formatVersion: 2})
    const {c, selected} = await catalog()
    const entered = deferred<void>()
    const release = deferred<void>()
    let synchronizations = 0
    stub(session, 'synchronize').callsFake(async () => {
      synchronizations++
      if (synchronizations === 1) {
        entered.resolve()
        await release.promise
      }

      return synchronizations
    })
    let calls = 0
    const a = agent(
      session,
      c,
      model(async () => {
        calls++
        return new Message(MessageType.Assistant)
      }),
      {execution: {limits: {cleanupMs: 15, elapsedMs: 1000}}},
    )
    const settled = deferred<void>()
    try {
      const handle = await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {
        onRunSnapshot(snapshot) {
          if (snapshot.result && snapshot.unresolved.length === 0) settled.resolve()
        },
        skills: [selected[0]],
      })
      await entered.promise
      expect(handle.requestStop('user')).to.equal('requested')
      const result = await handle.finished
      expect(result.outcome).to.equal('incomplete')
      expect(result.quiescence).to.equal(false)
      expect(result.unresolved.some((name) => name.startsWith('skill-save:'))).to.equal(true)
      expect(calls).to.equal(0)
      release.resolve()
      await settled.promise
      await a.supervisor.whenQuiescent()
      expect(handle.getSnapshot().unresolved).to.deep.equal([])
      expect(synchronizations).to.be.greaterThan(1)
    } finally {
      release.resolve()
      restore()
      await a.close()
    }
  })

  it('blocks model use when journal readiness fails after a synchronized snapshot', async () => {
    const session = new Session({formatVersion: 2})
    const {c, selected} = await catalog()
    let calls = 0
    class FailedReady extends MemoryExecutionJournal {
      protected async persist(record: import('../../../src/core/execution/journal.js').JournalRecord) {
        if (record.kind === 'run-ready') throw new Error('Injected ready sync failure')
      }
    }
    const journal = new FailedReady(session.getId(), session.acquireManagedLease())
    const a = agent(
      session,
      c,
      model(async () => {
        calls++
        return new Message(MessageType.Assistant)
      }),
      {execution: {journalFactory: async () => journal}},
    )
    try {
      const result = await (
        await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: [selected[0]]})
      ).finished
      expect(result.outcome).to.equal('failed')
      expect(result.recording.status).to.equal('failed')
      expect(calls).to.equal(0)
      expect(session.getSkillContexts()).to.have.length(1)
      expect(journal.records().some((r) => r.kind === 'run-ready')).to.equal(false)
    } finally {
      await a.close().catch(() => {})
    }
  })

  it('supports durable Service/GUI replay and explicit history without reactivation after reopen', async () => {
    const {c, selected} = await catalog()
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const requests: string[][] = []
    let currentThreadId = ''
    const makeService = () =>
      new OrbitApplicationService({
        contexts: [],
        createAgent: (o) =>
          new Agent({
            ...o,
            deps: {
              createModel: () =>
                model(async (messages) => {
                  const {file} = (await repository.findById(currentThreadId))!
                  expect(
                    parseSessionFile(await fs.readFile(file, 'utf8'), file).entries.some(
                      (e) => e.type === 'skill_context',
                    ),
                  ).to.equal(true)
                  requests.push(messages.map((m) => m.content))
                  return new Message(MessageType.Assistant, {content: 'Done'})
                }),
            },
            execution: {...o.execution, limits: {...o.execution?.limits, toolRounds: 100}},
            toolProfile: 'none',
          }),
        cwd: root,
        logStore: logs,
        model: 'fixture',
        provider: 'ollama',
        repository,
        settings: {model: 'fixture', provider: 'ollama'},
        settingsSources: [],
        skillCatalog: c,
      })
    let service = makeService()
    let serverClosed = false
    const server = await startGuiServer({service, token: 'skill-fixture-token'})
    const base = `http://${server.host}:${server.port}`
    const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': server.token}
    try {
      expect((await fetch(base + '/api/skills')).status).to.equal(403)
      const list = (await (await fetch(base + '/api/skills', {headers})).json()) as {candidates: SkillSnapshot[]}
      expect(list.candidates[0]).not.to.have.property('source')
      const thread = service.createThread()
      currentThreadId = thread.id
      const completed = () =>
        new Promise<void>((resolve) => {
          const off = service.subscribe((e) => {
            if (e.type === 'run.completed') {
              off()
              resolve()
            }
          })
        })
      const done = completed()
      const post = (skills = selected) =>
        fetch(base + `/api/threads/${thread.id}/messages`, {
          body: JSON.stringify({
            content: 'Inspect',
            requestId: 'gui-skill-replay',
            skills: skills.map(({digest, id}) => ({digest, id})),
          }),
          headers,
          method: 'POST',
        })
      const response = await post()
      expect(response.status).to.equal(202)
      await done
      const first = await response.json()
      await fs.writeFile(selected[0].file, 'changed')
      expect(await (await post()).json()).to.deep.equal(first)
      expect((await post([...selected].reverse())).status).not.to.equal(202)
      expect(requests).to.have.length(1)
      const snapshot = await (await fetch(base + `/api/threads/${thread.id}`, {headers})).json()
      expect(JSON.stringify(snapshot)).not.to.include(marker)
      const history = await (await fetch(base + `/api/sessions/${thread.id}/skills`, {headers})).json()
      expect(JSON.stringify(history)).to.include(marker)
      const {file} = (await repository.findById(thread.id))!
      const raw = await fs.readFile(file, 'utf8')
      expect(() => parseOldSession(raw, file)).to.throw('Unsupported session entry type: skill_context')
      const without = raw
        .split('\n')
        .filter((line) => !line.includes('"type":"skill_context"'))
        .join('\n')
      expect(parseOldSession(without + '{"type":"skill_context",', file).recovered).to.equal(true)
      expect(parseSessionFile(raw + '{"type":"skill_context",', file).recovered).to.equal(true)
      expect(() => parseOldSession(without + JSON.stringify((history as unknown[])[0]), file)).to.throw(
        'Unsupported session entry type',
      )
      expect((await fetch(base + `/api/sessions/${thread.id}/skills`)).status).to.equal(403)
      await server.close()
      serverClosed = true
      await service.close()
      service = makeService()
      await service.resumeSession(thread.id)
      const replay = await service.startRun(thread.id, 'Inspect', {requestId: 'gui-skill-replay', skills: selected})
      expect(replay).to.deep.equal(first)
      expect(requests).to.have.length(1)
      const next = completed()
      await service.startRun(thread.id, 'Next', 'plain-string-compatible')
      await next
      expect(requests[1].some((s) => s.includes(marker))).to.equal(false)
    } finally {
      if (!serverClosed) await server.close()
      await service.close()
    }
  })

  it('retains Ink pending selections for local commands and rejected admission, consumes admitted loading failures', async () => {
    const {c, selected} = await catalog()
    const initial = createInitialInteractiveState({cwd: root, model: 'fixture', provider: 'ollama', skillCatalog: c})
    const chosen = (await handleSkillCommand(initial, `/skill ${selected[0].id}@${selected[0].digest}`))!.nextState
    expect((await handleSkillCommand(chosen, '/skills'))!.nextState.pendingSkills).to.have.length(1)
    expect((await handleSkillCommand(chosen, '/skill clear'))!.nextState.pendingSkills).to.deep.equal([])
    class FakeAgent {
      logger = {setDebugEnabled() {}}

      async close() {}

      async invoke(_m: unknown, o: {onRunAdmitted?: () => void}) {
        if (admit) o.onRunAdmitted?.()
        throw new Error(admit ? 'Loading failed' : 'Admission rejected')
      }
    }
    let admit = false
    const rejected = await submitInteractiveInput(FakeAgent as unknown as typeof Agent, chosen, 'Inspect')
    expect(rejected.pendingSkills).to.have.length(1)
    admit = true
    const failed = await submitInteractiveInput(FakeAgent as unknown as typeof Agent, chosen, 'Inspect')
    expect(failed.pendingSkills).to.deep.equal([])
  })

  it('does not wait for an unrelated read-only listing during Run cleanup', async () => {
    let hold = false
    const entered = deferred<void>()
    const release = deferred<void>()
    const io: SkillIO = {
      ...fs,
      async opendir(...args: Parameters<typeof fs.opendir>) {
        if (hold) {
          entered.resolve()
          await release.promise
        }

        return fs.opendir(...args)
      },
    }
    const {c, selected} = await catalog(io)
    hold = true
    const listing = c.list()
    await entered.promise
    const a = agent(
      new Session({formatVersion: 2}),
      c,
      model(async () => new Message(MessageType.Assistant, {content: 'Done'})),
      {execution: {limits: {cleanupMs: 20, elapsedMs: 500}}},
    )
    try {
      const result = await (
        await a.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: [selected[0]]})
      ).finished
      expect(result.outcome).to.equal('completed')
      expect(result.quiescence).to.equal(true)
    } finally {
      release.resolve()
      await listing
      await a.close()
    }
  })

  it('preserves default in-memory v2 Sessions when no Skill catalog is configured', async () => {
    const a = new Agent({
      contextPolicy: policy,
      cwd: root,
      deps: {createModel: () => model(async () => new Message(MessageType.Assistant, {content: 'Done'}))},
      logStore: logs,
      settings: {model: 'fixture', provider: 'ollama'},
      toolProfile: 'none',
    })
    try {
      expect(a.getSession().formatVersion).to.equal(2)
    } finally {
      await a.close()
    }
  })
})
