// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'

const child = promisify(execFile)

describe('managed execution subprocess recovery', () => {
  for (const checkpoint of ['run-admitted', 'operation-intent', 'effect', 'operation-result', 'run-terminal']) {
    it(`does not redispatch after process exit at ${checkpoint}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-restart-'))
      try {
        const script = `
          import fs from 'node:fs/promises';
          import path from 'node:path';
          import {FileExecutionJournal} from './src/core/execution/journal.ts';
          import {RunSupervisor} from './src/core/execution/run.ts';
          import {executePrepared} from './src/core/execution/authorization.ts';
          const root = process.env.ORBIT_TEST_ROOT;
          const checkpoint = process.env.ORBIT_TEST_CHECKPOINT;
          const journal = await FileExecutionJournal.open('session', {root, level: 'file-sync', releaseLease() {}});
          const append = journal.append.bind(journal);
          journal.append = async (...args) => { const record = await append(...args); if (record.kind === checkpoint) process.exit(73); return record; };
          const handle = await new RunSupervisor().startRun({sessionId: 'session', requestId: 'request', input: {}, configuration: {}, journal: async () => journal, async execute(run) {
            await run.ready([]);
            const preparation = {binding: {}, effect: 'command', preview: {}, targets: [], revalidate: async () => true, execute: async () => { await fs.appendFile(path.join(root, 'effects'), 'once\\n'); if (checkpoint === 'effect') process.exit(73); return {content: []}; }};
            return executePrepared(run, {version: 1, variant: 'tool-call', id: 'operation', name: 'test', runId: run.id, sessionId: 'session', cwd: root, input: {}, binding: {}, effect: 'command', preview: {}, targets: []}, preparation, {generation: 'test', profile: 'unrestricted', roots: []});
          }});
          await handle.finished;
          process.exit(74);
        `
        await child(process.execPath, ['--loader', './test/alias-loader.mjs', '--input-type=module', '-e', script], {
          env: {
            ...process.env,
            ORBIT_TEST_CHECKPOINT: checkpoint,
            ORBIT_TEST_ROOT: root,
            TS_NODE_PROJECT: 'tsconfig.test.json',
          },
        }).then(
          () => {
            throw new Error('Child did not exit at checkpoint')
          },
          (error) => {
            expect(error.code, error.stderr).equal(73)
          },
        )
        const journal = await FileExecutionJournal.open('session', {level: 'file-sync', releaseLease() {}, root})
        let dispatches = 0
        const handle = await new RunSupervisor().startRun({
          configuration: {changed: true},
          async execute() {
            dispatches++
          },
          input: {},
          journal: async () => journal,
          requestId: 'request',
          sessionId: 'session',
        })
        const result = await handle.finished
        expect(dispatches).equal(0)
        expect(result.outcome).equal(checkpoint === 'run-terminal' ? 'completed' : 'incomplete')
        if (checkpoint !== 'run-admitted')
          expect(result.operations[0].status).equal(
            ['effect', 'operation-intent'].includes(checkpoint) ? 'unknown' : 'succeeded',
          )
        const effects = await fs.readFile(path.join(root, 'effects'), 'utf8').catch(() => '')
        expect(effects).equal(['effect', 'operation-result', 'run-terminal'].includes(checkpoint) ? 'once\n' : '')
        await journal.close()
      } finally {
        await fs.rm(root, {force: true, recursive: true})
      }
    })
  }

  it('cannot preempt synchronous user code but stops before the next operation', async () => {
    const {MemoryExecutionJournal} = await import('../../../src/core/execution/journal.js')
    let dispatches = 0
    const handle = await new RunSupervisor().startRun({
      configuration: {},
      async execute(run) {
        const end = performance.now() + 30
        while (performance.now() < end) {
          /* Deliberately non-yielding user code. */
        }

        run.check()
        dispatches++
      },
      input: {},
      journal: async () => new MemoryExecutionJournal('session'),
      limits: {elapsedMs: 10},
      requestId: 'request',
      sessionId: 'session',
    })
    expect((await handle.finished).outcome).equal('budget-exceeded')
    expect(dispatches).equal(0)
  })
})
