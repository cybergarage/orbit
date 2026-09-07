// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {executePrepared} from '../../../src/core/execution/authorization.js'
import {canonicalJSON, FileExecutionJournal, MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
describe('managed execution contracts', () => {
  const policy = {generation: 'test', profile: 'unrestricted' as const, roots: []}

  describe('managed run lifecycle and recording', () => {
    it('records admission and ready before execution and one terminal result', async () => {
      const journal = new MemoryExecutionJournal('session')
      const supervisor = new RunSupervisor()
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          return 42
        },
        input: {content: 'inspect'},
        journal: async () => journal,
        requestId: 'request',
        sessionId: 'session',
      })
      expect((await handle.finished).outcome).equal('completed')
      expect(handle.value()).equal(42)
      expect(journal.records().map((entry) => entry.kind)).deep.equal(['run-admitted', 'run-ready', 'run-terminal'])
      const snapshot = handle.getSnapshot()
      snapshot.budget.modelCalls = 99
      expect(handle.getSnapshot().budget.modelCalls).equal(0)
      await supervisor.close()
    })

    it('deduplicates a request before opening new resources and rejects changed input', async () => {
      const supervisor = new RunSupervisor()
      let opens = 0
      const options = {
        configuration: {},
        execute: async () => 1,
        input: {content: 'same'},
        async journal() {
          opens++
          return new MemoryExecutionJournal('session')
        },
        requestId: 'request',
        sessionId: 'session',
      }
      const [first, second] = await Promise.all([supervisor.startRun(options), supervisor.startRun(options)])
      expect(first.id).equal(second.id)
      expect(opens).equal(1)
      await first.finished
      let error: unknown
      try {
        await supervisor.startRun({...options, input: {content: 'changed'}})
      } catch (error_) {
        error = error_
      }

      expect(String(error)).contains('Conflicting request')
    })

    it('returns incomplete for noncooperative work without forgetting ownership', async () => {
      const supervisor = new RunSupervisor()
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          await run.wait('external-work', pending)
        },
        input: {},
        journal: async () => new MemoryExecutionJournal('session'),
        limits: {cleanupMs: 15},
        requestId: 'request',
        sessionId: 'session',
      })
      await delay(5)
      handle.requestStop()
      const result = await handle.finished
      expect(result.outcome).equal('incomplete')
      expect(result.unresolved.length).greaterThan(0)
      finish()
      await delay(10)
      expect(handle.getSnapshot().result).deep.equal(result)
      expect(handle.getSnapshot().unresolved).deep.equal([])
    })

    it('does not dispatch after an approval expires during intent storage', async () => {
      let dispatches = 0
      class SlowJournal extends MemoryExecutionJournal {
        protected override async persist(record: import('../../../src/core/execution/journal.js').JournalRecord) {
          if (record.kind === 'operation-intent') await delay(30)
        }
      }
      const journal = new SlowJournal('session')
      const supervisor = new RunSupervisor()
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          const preparation = {
            binding: {},
            effect: 'command' as const,
            async execute() {
              dispatches++
              return {content: []}
            },
            preview: {command: 'test'},
            revalidate: async () => true,
            targets: [],
          }
          return executePrepared(
            run,
            {
              binding: {},
              cwd: '/tmp',
              effect: 'command',
              id: 'operation',
              input: {},
              name: 'test',
              preview: preparation.preview,
              runId: run.id,
              sessionId: 'session',
              targets: [],
              variant: 'tool-call',
              version: 1,
            },
            preparation,
            {...policy, decide: () => 'ask'},
          )
        },
        input: {},
        journal: async () => journal,
        limits: {approvalMs: 15},
        async onApproval(request) {
          await supervisor.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'test',
          })
        },
        requestId: 'request',
        responderScope: 'test',
        sessionId: 'session',
      })
      await handle.finished
      expect(dispatches).equal(0)
      expect(journal.records().find((entry) => entry.kind === 'operation-result')?.data.status).equal(
        'cancelled-before-start',
      )
    })

    it('fails admission with zero execution when storage fails', async () => {
      let calls = 0
      class FailingJournal extends MemoryExecutionJournal {
        protected override async persist() {
          throw new Error('disk full')
        }
      }
      const supervisor = new RunSupervisor()
      let error: unknown
      try {
        await supervisor.startRun({
          configuration: {},
          async execute() {
            calls++
          },
          input: {},
          journal: async () => new FailingJournal('session'),
          requestId: 'request',
          sessionId: 'session',
        })
      } catch (error_) {
        error = error_
      }

      expect(calls).equal(0)
      expect(String(error)).contains('disk full')
    })

    it('keeps a failed target test separate from an unknown operation', async () => {
      const supervisor = new RunSupervisor()
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          const prep = {
            binding: {},
            effect: 'command' as const,
            execute: async () => ({content: [], isError: true}),
            preview: {},
            revalidate: async () => true,
            targets: [],
          }
          return executePrepared(
            run,
            {
              binding: {},
              cwd: '/tmp/test-known-failure',
              effect: 'command',
              id: 'operation',
              input: {},
              name: 'test',
              preview: {},
              runId: run.id,
              sessionId: 'session',
              targets: [],
              variant: 'tool-call',
              version: 1,
            },
            prep,
            policy,
          )
        },
        input: {},
        journal: async () => new MemoryExecutionJournal('session'),
        requestId: 'request',
        sessionId: 'session',
      })
      const result = await handle.finished
      expect(result.outcome).equal('completed')
      expect(result.operations[0].status).equal('failed')
    })
  })

  describe('execution journal persistence', () => {
    it('syncs file records and reopens with the same keyed bindings', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-journal-'))
      let releases = 0
      try {
        const journal = await FileExecutionJournal.open('session', {
          releaseLease() {
            releases++
          },
          root,
        })
        const digest = journal.digest({token: 'private-input'})
        await journal.append('run', 'run-admitted', {requestDigest: digest, requestId: 'request'})
        await journal.close()
        const reopened = await FileExecutionJournal.open('session', {
          releaseLease() {
            releases++
          },
          root,
        })
        expect(reopened.digest({token: 'private-input'})).equal(digest)
        expect(reopened.records()).length(1)
        expect(await fs.readFile(path.join(root, 'session/run/events.jsonl'), 'utf8')).not.contains('private-input')
        await reopened.close()
        expect(releases).equal(2)
      } finally {
        await fs.rm(root, {force: true, recursive: true})
      }
    })

    it('preserves a torn journal instead of truncating it', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-journal-'))
      try {
        const journal = await FileExecutionJournal.open('session', {releaseLease() {}, root})
        await journal.append('run', 'run-admitted', {})
        await journal.close()
        const file = path.join(root, 'session/run/events.jsonl')
        await fs.appendFile(file, '{torn')
        let error: unknown
        try {
          await FileExecutionJournal.open('session', {releaseLease() {}, root})
        } catch (error_) {
          error = error_
        }

        expect(String(error)).contains('Torn')
        expect((await fs.readFile(file, 'utf8')).endsWith('{torn')).equal(true)
      } finally {
        await fs.rm(root, {force: true, recursive: true})
      }
    })

    it('rejects lossy and cyclic bindings', () => {
      expect(() => canonicalJSON({x: undefined})).throws()
      expect(() => canonicalJSON({x: Number.NaN})).throws()
      const cycle: unknown[] = []
      cycle.push(cycle)
      expect(() => canonicalJSON(cycle)).throws()
      expect(canonicalJSON({a: 1, b: 2})).equal(canonicalJSON({a: 1, b: 2}))
    })
  })
})
