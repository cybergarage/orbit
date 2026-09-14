// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {Agent, MemorySessionLogStore, Message, MessageType, SessionRepository, State} from '../../../src/core/index.js'

async function copy(from: string, to: string): Promise<void> {
  if (!(await fs.lstat(from)).isDirectory()) {
    await fs.copyFile(from, to)
    return
  }

  await fs.mkdir(to)
  await Promise.all((await fs.readdir(from)).map((name) => copy(path.join(from, name), path.join(to, name))))
}

const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true} as const
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-context-io-'))
  const repo = new SessionRepository({rootDir: path.join(root, 'sessions')})
  repo.initializeStorage(offline)
  const session = repo.create({formatVersion: 3})
  session.appendMessages([new Message(MessageType.User, {content: 'unchanged'})])
  const journal = await FileExecutionJournal.open(session.getId(), {
    lease: session.acquireWriterLease(),
    root: repo.journalRoot,
  })
  await journal.append('old', 'run-admitted', {
    level: journal.level,
    mode: 'file',
    requestDigest: journal.digest('old'),
    requestId: 'old',
  })
  await session.synchronize(journal.level)
  const file = session.getFile()!
  const key = path.join(repo.journalRoot, session.getId(), 'key')
  const events = path.join(repo.journalRoot, session.getId(), 'old', 'events.jsonl')
  return {events, file, journal, key, repo, root, session}
}

describe('context evidence filesystem boundaries', () => {
  for (const target of ['file', 'key', 'events'] as const)
    for (const phase of ['sync', 'close'] as const)
      for (const replacement of ['file', 'parent', 'root'] as const)
        it(`rejects ${target} ${replacement} replacement during ${phase}`, async () => {
          const f = await fixture()
          const destination =
            replacement === 'file'
              ? f[target]
              : replacement === 'root'
                ? target === 'file'
                  ? path.join(f.root, 'sessions')
                  : f.repo.journalRoot
                : path.dirname(f[target])
          const held = destination + '.held'
          const before = await fs.readFile(f[target])
          let hit = false
          const open = fs.open.bind(fs)
          const patched = stub(fs, 'open').callsFake(async (...args) => {
            const handle = await open(...args)
            if (String(args[0]) === f[target] && typeof args[1] === 'number') {
              const original = handle[phase].bind(handle)
              handle[phase] = async () => {
                await original()
                if (!hit) {
                  hit = true
                  await fs.rename(destination, held)
                  await copy(held, destination)
                }
              }
            }

            return handle
          })
          try {
            let error: unknown
            try {
              await (target === 'file'
                ? f.session.verifyContextSource(64 * 1024 * 1024)
                : f.journal.verifyContextEvidence(64 * 1024 * 1024))
            } catch (error_) {
              error = error_
            }

            expect(hit, 'injected boundary reached').equal(true)
            expect(error, 'replacement must refuse evidence').instanceOf(Error)
            expect((await fs.readFile(f[target])).equals(before)).equal(true)
          } finally {
            patched.restore()
            if (hit) {
              await fs.rm(destination, {recursive: true})
              await fs.rename(held, destination)
            }

            await f.journal.close()
            await f.session.close()
            await fs.rm(f.root, {force: true, recursive: true})
          }
        })
  for (const target of ['file', 'key', 'events'] as const)
    for (const operation of ['open', 'stat', 'read', 'sync', 'close'] as const)
      it(`retains ownership through ${target} ${operation} failure and cleanup retry`, async () => {
        const f = await fixture()
        const originalBytes = await fs.readFile(f[target])
        let hit = false
        let closes = 0
        const open = fs.open.bind(fs)
        const patched = stub(fs, 'open').callsFake(async (...args) => {
          if (String(args[0]) !== f[target] || typeof args[1] !== 'number') return open(...args)
          if (operation === 'open' && !hit) {
            hit = true
            throw new Error('injected open')
          }

          const handle = await open(...args)
          const close = handle.close.bind(handle)
          handle.close = async () => {
            closes++
            if (operation === 'close' && !hit) {
              hit = true
              throw new Error('injected close')
            }

            await close()
          }

          if (operation !== 'open' && operation !== 'close') {
            const original = handle[operation].bind(handle) as (...params: unknown[]) => Promise<unknown>
            handle[operation] = (async (...params: unknown[]) => {
              if (!hit) {
                hit = true
                throw new Error('injected ' + operation)
              }

              return original(...params)
            }) as never
          }

          return handle
        })
        try {
          let error: unknown
          try {
            await (target === 'file'
              ? f.session.verifyContextSource(64 * 1024 * 1024)
              : f.journal.verifyContextEvidence(64 * 1024 * 1024))
          } catch (error_) {
            error = error_
          }

          expect(hit).equal(true)
          expect(String(error)).contains('injected')
          expect(f.session.hasManagedLease()).equal(true)
          await f.session.settleContextEvidence()
          await f.journal.settleContextEvidence()
          if (operation === 'close') expect(closes).equal(2)
          else expect(closes).equal(operation === 'open' ? 0 : 1)
          expect((await fs.readFile(f[target])).equals(originalBytes)).equal(true)
          patched.restore()
          await f.session.verifyContextSource(64 * 1024 * 1024)
          await f.journal.verifyContextEvidence(64 * 1024 * 1024)
        } finally {
          patched.restore()
          await f.journal.close()
          await f.session.close()
          await fs.rm(f.root, {force: true, recursive: true})
        }
      })

  it('reads the 64 MiB raw boundary and refuses one byte below the required size', async () => {
    const f = await fixture()
    try {
      const limit = 64 * 1024 * 1024
      const initial = (await fs.stat(f.file)).size
      const message = new Message(MessageType.User, {content: 'x'})
      f.session.appendMessages([message])
      await f.session.flush()
      const small = (await fs.stat(f.file)).size
      const entries = f.session.getEntries()
      // Fill exactly one serialized entry while retaining its metadata and valid UTF-8.
      const last = entries.at(-1)!
      if (last.type !== 'message') throw new Error('message expected')
      const size = limit - small + 1
      last.message.contents = ['x'.repeat(size)]
      f.session
        .getConversationMessages()
        .at(-1)!
        .contents.splice(0, 1, ...last.message.contents)
      const header = (await fs.readFile(f.file, 'utf8')).split('\n')[0]
      await fs.writeFile(f.file, header + '\n' + entries.map((e) => JSON.stringify(e) + '\n').join(''))
      const actual = (await fs.stat(f.file)).size
      expect(initial).lessThan(actual)
      expect(actual).equal(limit)
      expect(await f.session.verifyContextSource(limit)).equal(limit)
      let rejected = false
      try {
        await f.session.verifyContextSource(limit - 1)
      } catch {
        rejected = true
      }

      expect(rejected).equal(true)
    } finally {
      await f.journal.close()
      await f.session.close()
      await fs.rm(f.root, {force: true, recursive: true})
    }
  })

  for (const target of ['file', 'key', 'events'] as const)
    for (const operation of ['open', 'read', 'sync', 'close'] as const)
      it(`keeps cancelled ${target} ${operation} pending until actual settlement`, async () => {
        const f = await fixture()
        await f.journal.append('old', 'run-terminal', {
          cleanupErrors: [],
          operations: [],
          outcome: 'completed',
          quiescence: true,
          recording: {status: 'acknowledged'},
          unresolved: [],
        })
        const logs = new MemorySessionLogStore()
        let reached!: () => void
        let release!: () => void
        let settled!: () => void
        const entered = new Promise<void>((r) => {
          reached = r
        })
        const pending = new Promise<void>((r) => {
          release = r
        })
        const done = new Promise<void>((r) => {
          settled = r
        })
        let hit = false
        let calls = 0
        const wait = async () => {
          if (!hit) {
            hit = true
            reached()
            await pending
          }
        }

        const open = fs.open.bind(fs)
        const patched = stub(fs, 'open').callsFake(async (...args) => {
          if (String(args[0]) !== f[target] || typeof args[1] !== 'number') return open(...args)
          if (operation === 'open') await wait()
          const handle = await open(...args)
          if (operation !== 'open') {
            const original = handle[operation].bind(handle) as (...params: unknown[]) => Promise<unknown>
            handle[operation] = (async (...params: unknown[]) => {
              await wait()
              return original(...params)
            }) as never
          }

          return handle
        })
        const agent = new Agent({
          deps: {
            createModel: () => ({
              getModel: () => 'fixed',
              getName: () => 'fixed',
              getProvider: () => 'ollama',
              async invoke() {
                throw new Error('legacy')
              },
              prepare() {
                calls++
                throw new Error('Must not prepare')
              },
            }),
          },
          execution: {journalFactory: async () => f.journal, limits: {cleanupMs: 250}},
          interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
          logStore: logs,
          settings: {model: 'fixed', provider: 'ollama'},
          state: new State(f.session),
          toolProfile: 'none',
        })
        const prefix = await fs.readFile(f.file)
        try {
          const handle = await agent.startRun([new Message(MessageType.User, {content: 'new'})], {
            onRunSnapshot(s) {
              if (s.result && s.unresolved.length === 0) settled()
            },
          })
          await entered
          handle.requestStop('user')
          const result = await handle.finished
          expect(result.outcome).equal('incomplete')
          expect(result.quiescence).equal(false)
          expect(result.unresolved.some((name) => name.startsWith('context-evidence'))).equal(true)
          expect(f.session.hasManagedLease()).equal(true)
          expect(calls).equal(0)
          release()
          await done
          await agent.supervisor.reconcileRun(handle.id, {confirmedStopped: true, operations: []})
          expect(handle.getSnapshot().result).deep.equal(result)
          expect((await fs.readFile(f.file)).subarray(0, prefix.length).equals(prefix)).equal(true)
        } finally {
          release()
          patched.restore()
          await agent.close()
          await f.session.close()
          await logs.close()
          await fs.rm(f.root, {force: true, recursive: true})
        }
      })

  it('accounts for key and all journal bytes together rather than accepting each file separately', async () => {
    const f = await fixture()
    try {
      const bytes = (await fs.stat(f.key)).size + (await fs.stat(f.events)).size
      expect((await f.journal.verifyContextEvidence(bytes)).length).equal(1)
      let error: unknown
      try {
        await f.journal.verifyContextEvidence(bytes - 1)
      } catch (error_) {
        error = error_
      }

      expect(error).instanceOf(Error)
    } finally {
      await f.journal.close()
      await f.session.close()
      await fs.rm(f.root, {force: true, recursive: true})
    }
  })

  for (const operation of ['open', 'sync', 'close'] as const)
    it(`retains directory ${operation} failures through evidence cleanup`, async () => {
      const f = await fixture()
      const directory = path.dirname(f.events)
      let hit = false
      const open = fs.open.bind(fs)
      const patched = stub(fs, 'open').callsFake(async (...args) => {
        if (String(args[0]) !== directory) return open(...args)
        if (operation === 'open' && !hit) {
          hit = true
          throw new Error('directory open fault')
        }

        const handle = await open(...args)
        if (operation !== 'open') {
          const original = handle[operation].bind(handle)
          handle[operation] = async () => {
            if (!hit) {
              hit = true
              throw new Error('directory ' + operation + ' fault')
            }

            await original()
          }
        }

        return handle
      })
      try {
        let error: unknown
        try {
          await f.journal.verifyContextEvidence(64 * 1024 * 1024)
        } catch (error_) {
          error = error_
        }

        expect(hit).equal(true)
        expect(String(error)).contains('directory')
        expect(f.session.hasManagedLease()).equal(true)
        await f.journal.settleContextEvidence()
        patched.restore()
        await f.journal.verifyContextEvidence(64 * 1024 * 1024)
      } finally {
        patched.restore()
        await f.journal.close()
        await f.session.close()
        await fs.rm(f.root, {force: true, recursive: true})
      }
    })

  it('keeps the existing release after a settled failed append', async () => {
    const f = await fixture()
    const open = fs.open.bind(fs)
    const patched = stub(fs, 'open').callsFake(async (...args) => {
      const handle = await open(...args)
      if (args[1] === 'a')
        handle.write = (async () => {
          throw new Error('settled failed append')
        }) as never
      return handle
    })
    try {
      try {
        await f.journal.append('old', 'run-ready', {catalog: 'fixed'})
      } catch {}

      let error: unknown
      try {
        await f.journal.close()
      } catch (error_) {
        error = error_
      }

      expect(String(error)).contains('settled failed append')
      expect(f.session.hasManagedLease()).equal(false)
      await f.session.close()
    } finally {
      patched.restore()
      await fs.rm(f.root, {force: true, recursive: true})
    }
  })

  it('does not release a journal owner while evidence close still fails', async () => {
    const f = await fixture()
    let broken = true
    const open = fs.open.bind(fs)
    const patched = stub(fs, 'open').callsFake(async (...args) => {
      const handle = await open(...args)
      if (String(args[0]) === f.key && typeof args[1] === 'number') {
        const close = handle.close.bind(handle)
        handle.close = async () => {
          if (broken) throw new Error('close not confirmed')
          await close()
        }
      }

      return handle
    })
    try {
      try {
        await f.journal.verifyContextEvidence(64 * 1024 * 1024)
      } catch {}

      let error: unknown
      try {
        await f.journal.close()
      } catch (error_) {
        error = error_
      }

      expect(String(error)).contains('cleanup remains unconfirmed')
      expect(f.session.hasManagedLease()).equal(true)
      broken = false
      await f.journal.close()
      expect(f.session.hasManagedLease()).equal(false)
      await f.session.close()
    } finally {
      broken = false
      patched.restore()
      await f.journal.close()
      await f.session.close()
      await fs.rm(f.root, {force: true, recursive: true})
    }
  })
})
