// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Model} from '../../../src/core/models/model.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {Agent, MemorySessionLogStore, Message, Session, SessionRepository, State} from '../../../src/core/index.js'
import {collectToolObservations, selectObservationView} from '../../../src/core/session/tool-observations.js'
import {createWriteTool} from '../../../src/core/tools/builtins/write.js'
import {observationAdapter} from '../../../src/core/tools/observation-provenance.js'
import {ToolRegistry} from '../../../src/core/tools/registry.js'

async function fixture(withCommand = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-observations-'))
  const session = new Session()
  const journal = new MemoryExecutionJournal(session.getId())
  let round = 0
  const model: Model = {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'fixture',
    async invoke() {
      round++
      if (withCommand && round === 3)
        return new Message('assistant', {
          payload: {toolCalls: [{id: 'shell', input: {command: 'printf shell > saved.txt; exit 5'}, name: 'bash'}]},
        })
      return round < 3
        ? new Message('assistant', {
            payload: {toolCalls: [{id: 'reused', input: {content: String(round), path: 'saved.txt'}, name: 'write'}]},
          })
        : new Message('assistant', {content: 'done'})
    },
  }
  const store = new MemorySessionLogStore()
  const agent = new Agent({
    cwd: root,
    deps: {createModel: () => model},
    execution: {
      journalFactory: async () => journal,
      policy: {generation: 'test', profile: 'unrestricted', roots: [root]},
    },
    logStore: store,
    settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'coding'}},
    state: new State(session),
  })
  const handle = await agent.startRun([new Message('user', {content: 'save twice'})])
  expect((await handle.finished).outcome).to.equal('completed')
  const run = {check() {}, journal}
  return {
    agent,
    async close() {
      await agent.close()
      await store.close()
      await fs.rm(root, {force: true, recursive: true})
    },
    journal,
    root,
    run,
    session,
    store,
  }
}

async function budgetedFixture(persistent: boolean, overflow = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-observation-context-'))
  const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
  repository.initializeStorage({
    allWritersStopped: true,
    automaticRestartersDisabled: true,
    exclusiveStorageControl: true,
  })
  const session = persistent ? repository.create({formatVersion: 2}) : new Session({formatVersion: 2})
  const views: unknown[] = []
  const failures: unknown[] = []
  const store = new MemorySessionLogStore()
  let rounds = 0
  const requests: Message[][] = []
  const model: Model = {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'ollama',
    async invoke() {
      throw new Error('Expected prepared request')
    },
    prepare(messages) {
      return {
        async invoke() {
          requests.push(messages)
          if (messages[0].content.startsWith('Summarize')) {
            const ids = JSON.parse(messages[0].content.split('ORIGINAL_SOURCE_IDS: ')[1].split('\nSOURCE:')[0])
            return new Message('assistant', {
              content: JSON.stringify({
                changedPaths: [],
                facts: [],
                goals: [{sourceIds: [ids[0]], text: 'Continue'}],
                tests: [],
                uncertainties: [],
                unfinished: [],
                version: 1,
              }),
            })
          }

          rounds++
          return rounds <= 4
            ? new Message('assistant', {
                content: 'x'.repeat(4000),
                payload: {
                  toolCalls: [{id: 'same-id', input: {content: String(rounds), path: 'file.txt'}, name: 'write'}],
                },
              })
            : new Message('assistant', {content: 'done'})
        },
        request: {messages: messages.map((m) => m.content)},
      }
    },
  }
  const {DiagnosticEventBus} = await import('../../../src/core/index.js')
  const bus = new DiagnosticEventBus()
  bus.subscribe((event) => {
    if (event.type === 'context.observations.prepared') views.push(event.data.view)
    if (event.type === 'context.compaction.failed') failures.push(event.data.reason)
  })
  const policy = {
    estimator: (request: Readonly<Record<string, unknown>>) => ({
      components: {json: JSON.stringify(request).length},
      kind: 'estimated' as const,
      model: 'fixture',
      provider: 'ollama',
      revision: 'characters',
      tokens: JSON.stringify(request).length,
    }),
    mode: 'budgeted' as const,
    profile: {
      model: 'fixture',
      outputReserve: 1000,
      provider: 'ollama',
      revision: 'observations-test',
      safetyMargin: 100,
      summaryOutput: 800,
      target: overflow ? 1000 : 7000,
      templateOverhead: 0,
      trigger: 10_000,
      window: 32_000,
    },
  }
  const agent = new Agent({
    contextPolicy: policy,
    cwd: root,
    deps: {createModel: () => model},
    diagnostics: bus,
    execution: {policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
    logStore: store,
    settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'coding'}},
    state: new State(session),
  })
  try {
    const result = await (await agent.startRun([new Message('user', {content: 'Preserve this constraint'})])).finished
    if (overflow) {
      expect(result.outcome).to.equal('failed')
      expect(failures).to.include('observation-context-exceeds-budget')
      expect(session.getCompaction()).to.equal(undefined)
      return
    }

    expect(result.outcome).to.equal('completed')
    expect(session.getCompaction()).not.to.equal(undefined)
    expect(views.length).to.be.greaterThan(0)
    const projected = requests.filter((messages) =>
      messages.some((m) => m.content.startsWith('Untrusted source-derived')),
    )
    expect(projected.length).to.be.greaterThan(0)
    for (const messages of projected) {
      expect(messages.filter((m) => m.content.includes('Preserve this constraint'))).to.have.length(1)
      const data = JSON.parse(
        messages.find((m) => m.content.startsWith('Untrusted source-derived'))!.content.split('\n')[1],
      )
      expect(data.records.some((r: Record<string, unknown>) => r.savedAtOperation === true)).to.equal(true)
    }

    if (persistent) {
      const file = session.getFile()!
      await agent.close()
      const before = session.getConversationMessages().map((m) => m.payload)
      await session.close()
      const reopened = await repository.open(file)
      expect(reopened.getConversationMessages().map((m) => m.payload)).to.deep.equal(before)
      const afterReopen = views.length
      const second = new Agent({
        contextPolicy: policy,
        cwd: root,
        deps: {createModel: () => model},
        diagnostics: bus,
        execution: {policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
        logStore: store,
        settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'coding'}},
        state: new State(reopened),
      })
      try {
        expect(
          (await (await second.startRun([new Message('user', {content: 'Inspect prior saved operations'})])).finished)
            .outcome,
        ).to.equal('completed')
        expect(views.length).to.be.greaterThan(afterReopen)
      } finally {
        await second.close()
        await reopened.close()
      }
    }
  } finally {
    await agent.close()
    await session.close()
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  }
}

describe('source-derived tool observations', () => {
  it('refuses a mandatory save projection that cannot fit rather than losing observations', async () => {
    await budgetedFixture(false, true)
  })

  it('keeps at most the latest three prefix commands with explicit omission counts', () => {
    const records = Array.from({length: 5}, (_, sequence) => ({
      kind: 'command' as const,
      sequence,
      sourceIds: ['call' + sequence, 'result' + sequence],
    }))
    const view = selectObservationView({
      omittedRecords: 0,
      records,
      sourceSha256: 'source',
      unknownResults: 0,
      version: 1,
    })
    expect(view.records.map((record) => record.sequence)).to.deep.equal([2, 3, 4])
    expect(view.omittedRecords).to.equal(2)
  })

  it('keeps a failed shell process distinct from behavioral verification and current file contents', async () => {
    const f = await fixture(true)
    try {
      const view = await collectToolObservations(f.session, f.run, f.session.getConversationMessages())
      const command = view.records.find((record) => record.kind === 'command')!
      expect(command.exitCode).to.equal(5)
      expect(command.verificationCoverage).to.equal('unknown')
      expect(command.workspaceRevision).to.equal(null)
      expect(await fs.readFile(path.join(f.root, 'saved.txt'), 'utf8')).to.equal('shell')
      expect(
        view.records
          .filter((record) => record.kind === 'file-write')
          .every((record) => record.savedAtOperation === true),
      ).to.equal(true)
    } finally {
      await f.close()
    }
  })

  it('projects measured observations beside a checkpoint with protected inputs', async () => {
    await budgetedFixture(false)
  })

  it('records additive provenance in a durable v2 transcript and reopens unchanged', async () => {
    await budgetedFixture(true)
  })

  it('binds actual saves to the journal and keeps reused call IDs separate', async () => {
    const f = await fixture()
    try {
      const view = await collectToolObservations(f.session, f.run, f.session.getConversationMessages())
      expect(view.records).to.have.length(2)
      expect(view.records.every((r) => r.savedAtOperation === true)).to.equal(true)
      expect(view.records[0].sourceIds[0]).not.to.equal(view.records[1].sourceIds[0])
      expect(await fs.readFile(path.join(f.root, 'saved.txt'), 'utf8')).to.equal('2')
      const latest = selectObservationView(view)
      expect(latest.records).to.have.length(1)
      expect(latest.omittedRecords).to.equal(1)
      expect(latest.records[0].sourceIds).to.deep.equal(view.records[1].sourceIds)
    } finally {
      await f.close()
    }
  })

  it('rejects tampered output while leaving canonical results available', async () => {
    const f = await fixture()
    try {
      const messages = f.session.getConversationMessages()
      const result = messages.find((m) => m.type === 'tool')!
      const payload = result.payload as {output: {details: {bytes: number}}}
      payload.output.details.bytes = 99
      const view = await collectToolObservations(f.session, f.run, messages)
      expect(view.records).to.have.length(1)
      expect(view.unknownResults).to.equal(1)
    } finally {
      await f.close()
    }
  })

  it('rejects a request changed after the acknowledged operation', async () => {
    const f = await fixture()
    try {
      const messages = f.session.getConversationMessages()
      const request = messages.find((message) => message.type === 'assistant')!
      const payload = request.payload as {toolCalls: {input: {content: string}}[]}
      payload.toolCalls[0].input.content = 'tampered'
      const view = await collectToolObservations(f.session, f.run, messages)
      expect(view.unknownResults).to.equal(1)
      expect(view.records).to.have.length(1)
    } finally {
      await f.close()
    }
  })

  it('cannot recognize copied provenance in a different Session', async () => {
    const f = await fixture()
    try {
      const other = new Session()
      other.appendMessages(f.session.getConversationMessages())
      const view = await collectToolObservations(other, f.run, other.getConversationMessages())
      expect(view.records).to.have.length(0)
      expect(view.unknownResults).to.equal(2)
    } finally {
      await f.close()
    }
  })

  it('leaves legacy results without provenance unrecognized', async () => {
    const f = await fixture()
    try {
      for (const message of f.session.getConversationMessages()) {
        if (message.type === 'tool') delete (message.payload as Record<string, unknown>).observation
      }

      const view = await collectToolObservations(f.session, f.run, f.session.getConversationMessages())
      expect(view.records).to.have.length(0)
    } finally {
      await f.close()
    }
  })

  it('does not authenticate a custom definition by its name or claimed source', () => {
    const builtin = createWriteTool()
    const registry = new ToolRegistry()
    registry.register({...builtin, source: {id: 'fake', kind: 'custom'}})
    expect(observationAdapter(registry.snapshot().get('write')!)).to.equal(undefined)
    const real = new ToolRegistry()
    real.register(builtin)
    expect(observationAdapter(real.snapshot().get('write')!)).to.equal('builtin-write-v1')
  })

  it('retains a successful save alongside a later failed save and does not bind old commands to a new revision', () => {
    const records = [
      {kind: 'file-write' as const, path: 'f', savedAtOperation: true, sequence: 0, sourceIds: ['a', 'b']},
      {
        exitCode: 0,
        kind: 'command' as const,
        sequence: 1,
        sourceIds: ['c', 'd'],
        verificationCoverage: 'unknown',
        workspaceRevision: null,
      },
      {kind: 'file-write' as const, path: 'f', savedAtOperation: false, sequence: 2, sourceIds: ['e', 'f']},
    ]
    const view = selectObservationView({
      omittedRecords: 0,
      records,
      sourceSha256: 'source',
      unknownResults: 0,
      version: 1,
    })
    expect(view.records).to.deep.equal(records)
    expect(view.records[1].workspaceRevision).to.equal(null)
  })
})
