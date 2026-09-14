// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {
  isSessionLocked,
  Message,
  MessageType,
  migrateSessionTranscriptV3,
  SessionRepository,
} from '../../../src/core/index.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'
import {seedLegacyContext} from './legacy-context-fixture.js'

const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true} as const

describe('v3 migration interrupted filesystem acknowledgement', () => {
  for (const operation of ['fsyncSync', 'renameSync', 'unlinkSync', 'writeFileSync'] as const)
    for (const phase of ['before', 'after'])
      it('retains evidence and resumes after every ' + operation + ' ' + phase, async () => {
        let exercised = 0
        // One isolated migration for every filesystem boundary, until no later boundary exists.
        for (let boundary = 1; boundary < 80; boundary++) {
          const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-v3-fault-'))
          const repo = new SessionRepository({rootDir: path.join(root, 'sessions')})
          repo.initializeStorage(offline)
          const session = repo.create({formatVersion: 2})
          session.appendMessages([new Message(MessageType.User, {content: 'retained'})])
          // eslint-disable-next-line no-await-in-loop
          await seedLegacyContext(session, root)
          const file = session.getFile()!
          const scope = repo.scope(session.getId())
          // No test fault is injected during initial owner release.
          // eslint-disable-next-line no-await-in-loop
          await session.close()
          const source = fs.readFileSync(file)
          let count = 0
          let hit = false
          const original = fs[operation].bind(fs) as (...args: unknown[]) => unknown
          const fault = stub(fs, operation).callsFake(((...args: unknown[]) => {
            count++
            if (count === boundary && phase === 'before') {
              hit = true
              throw new Error('injected acknowledgement failure')
            }

            const result = original(...args)
            if (count === boundary && phase === 'after') {
              hit = true
              throw new Error('injected acknowledgement failure')
            }

            return result
          }) as never)
          try {
            try {
              migrateSessionTranscriptV3(scope, file, offline)
            } catch (error) {
              expect(String(error)).contains('injected acknowledgement failure')
            } finally {
              fault.restore()
            }

            if (!hit) break
            exercised++
            // Resume is exclusive; it never takes an old process execution right.
            if (operation === 'writeFileSync' && phase === 'before' && boundary === 1) {
              expect(() => migrateSessionTranscriptV3(scope, file, offline, true)).to.throw(
                'Unknown or live migration guard',
              )
              expect(isSessionLocked(scope)).equal(true)
              expect(fs.readFileSync(file).equals(source)).equal(true)
              continue
            }

            try {
              migrateSessionTranscriptV3(scope, file, offline, true)
            } catch (error) {
              throw new Error(operation + ' ' + phase + ' ' + boundary + ': ' + String(error))
            }

            expect(parseSessionFile(fs.readFileSync(file, 'utf8'), file).header.version).equal(3)
            expect(fs.readFileSync(file + '.v2-backup').equals(source)).equal(true)
            const target = fs.readFileSync(file)
            expect(target.subarray(target.indexOf(10) + 1).equals(source.subarray(source.indexOf(10) + 1))).equal(true)
          } finally {
            fault.restore()
            fs.rmSync(root, {force: true, recursive: true})
          }
        }

        expect(exercised).greaterThan(0)
      })
})
