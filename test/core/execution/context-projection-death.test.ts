// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {inspectExecutionJournal} from '../../../src/core/execution/recovery.js'
import {SessionRepository} from '../../../src/core/index.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'

const child = promisify(execFile)
describe('projection process death before model consumption', function () {
  this.timeout(240_000)

  it('checks every append, open, sync and close boundary and a torn append', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-projection-death-'))
    let steps = 0
    try {
      // First measure the actual path; each later child must die at its requested boundary.
      for (let boundary = 0; boundary <= steps + 1; boundary++) {
        const stop = boundary === steps + 1 ? -1 : boundary
        const report = path.join(root, String(stop))
        let error: undefined | {killed?: boolean; signal?: string}
        try {
          // eslint-disable-next-line no-await-in-loop
          await child(process.execPath, ['test/core/execution/fixtures/verified-interrupted-context.mjs'], {
            env: {
              ...process.env,
              ORBIT_ROOT: process.cwd(),
              ORBIT_SOURCE: '',
              PROJECTION_FAULT: String(stop),
              PROJECTION_REPORT: report,
              TS_NODE_PROJECT: 'tsconfig.test.json',
            },
            timeout: 20_000,
          })
        } catch (error_) {
          error = error_ as typeof error
        }

        // eslint-disable-next-line no-await-in-loop
        const data = JSON.parse(await fs.readFile(report, 'utf8'))
        try {
          if (stop === 0) {
            expect(error).equal(undefined)
            // eslint-disable-next-line no-await-in-loop
            steps = JSON.parse(await fs.readFile(report + '.steps', 'utf8')).steps
            expect(steps).greaterThan(7)
            continue
          }

          expect(error?.signal).equal('SIGKILL')
          expect(error?.killed, 'timeout is not the intended stop').not.equal(true)
          // eslint-disable-next-line no-await-in-loop
          const hit = JSON.parse(await fs.readFile(report + '.boundary', 'utf8'))
          expect(hit).deep.equal({calls: data.calls, step: stop})
          // eslint-disable-next-line no-await-in-loop
          expect((await fs.readFile(data.oldJournal)).toString('base64')).equal(data.oldBytes)
          // eslint-disable-next-line no-await-in-loop
          const bytes = await fs.readFile(data.file)
          const prefix = Buffer.from(data.prefix, 'base64')
          expect(bytes.subarray(0, prefix.length).equals(prefix)).equal(true)
          const parsed = parseSessionFile(bytes.toString('utf8'), data.file)
          expect(parsed.recovered).equal(stop === -1)
          // eslint-disable-next-line no-await-in-loop
          const observation = await inspectExecutionJournal(data.journalRoot, data.sessionId)
          expect(observation.runs.find((r) => r.runId === data.terminal.runId)!.records.at(-1)!.data.outcome).equal(
            'cancelled',
          )
          const interrupted = observation.runs.find((r) => r.runId !== data.terminal.runId)!
          expect(interrupted.records.some((r) => r.kind === 'run-terminal')).equal(false)
          expect(interrupted.records.some((r) => r.kind === 'operation-intent')).equal(false)
          const repo = new SessionRepository({rootDir: path.join(data.cwd, 'sessions')})
          if (stop === -1) expect(() => repo.open(data.file)).to.throw('Incomplete v3')
          else {
            const reopened = repo.open(data.file)
            expect(reopened.getEntries().filter((e) => e.type === 'context_projection').length).equal(
              stop === 1 ? 0 : 1,
            )
            // eslint-disable-next-line no-await-in-loop
            await reopened.close()
          }

          // eslint-disable-next-line no-await-in-loop
          expect((await fs.readFile(data.file)).equals(bytes)).equal(true)
        } finally {
          // Only this fixture's isolated directory is removed.
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(data.directory, {force: true, recursive: true})
        }
      }
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
