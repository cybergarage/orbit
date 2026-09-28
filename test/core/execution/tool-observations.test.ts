// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Model} from '../../../src/core/models/model.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {Agent, MemorySessionLogStore, Message, Session, State} from '../../../src/core/index.js'
import {collectToolObservations, selectObservationView} from '../../../src/core/session/tool-observations.js'
import {createWriteTool} from '../../../src/core/tools/builtins/write.js'
import {observationAdapter} from '../../../src/core/tools/observation-provenance.js'
import {ToolRegistry} from '../../../src/core/tools/registry.js'

async function fixture() {
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

describe('source-derived tool observations', () => {
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
