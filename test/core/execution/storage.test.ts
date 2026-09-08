// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {MemorySessionLogStore, SessionDeletionService} from '../../../src/core/index.js'
import {openTestJournal, SessionRepository} from '../../session-storage-fixture.js'

function faultIO(
  targetFile: (file: string) => boolean,
  override: (handle: Awaited<ReturnType<typeof fs.open>>, key: string | symbol) => unknown,
): typeof fs {
  return {
    ...fs,
    async open(
      file: Parameters<typeof fs.open>[0],
      flags: Parameters<typeof fs.open>[1],
      mode?: Parameters<typeof fs.open>[2],
    ) {
      const handle = await fs.open(file, flags, mode)
      if (!targetFile(String(file))) return handle
      return new Proxy(handle, {
        get(target, key) {
          const replacement = override(target, key)
          if (replacement !== undefined) return replacement
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  } as typeof fs
}

describe('required journal storage faults', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-storage-contract-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('finishes short writes before acknowledging a single record', async () => {
    let writes = 0
    const io = faultIO(
      (file) => file.endsWith('events.jsonl'),
      (handle, key) =>
        key === 'write'
          ? async (buffer: Buffer, offset: number, length: number) => {
              writes++
              return handle.write(buffer, offset, Math.min(length, 17))
            }
          : undefined,
    )
    const journal = await openTestJournal('session', {io, releaseLease() {}, root})
    await journal.append('run', 'run-admitted', {requestId: 'request'})
    expect(writes).greaterThan(1)
    expect(journal.records()).length(1)
    await journal.close()
    const reopened = await openTestJournal('session', {releaseLease() {}, root})
    expect(reopened.records()).length(1)
    await reopened.close()
  })

  it('preserves a partial write and refuses further execution', async () => {
    let writes = 0
    const io = faultIO(
      (file) => file.endsWith('events.jsonl'),
      (handle, key) =>
        key === 'write'
          ? async (buffer: Buffer, offset: number, length: number) => {
              if (++writes > 1) throw new Error('disk full')
              return handle.write(buffer, offset, Math.min(length, 5))
            }
          : undefined,
    )
    const journal = await openTestJournal('session', {io, releaseLease() {}, root})
    await journal.append('run', 'run-admitted', {}).then(
      () => {
        throw new Error('Unexpected ack')
      },
      () => {},
    )
    await journal.close().catch(() => {})
    const file = path.join(root, 'session/run/events.jsonl')
    const bytes = await fs.readFile(file)
    await openTestJournal('session', {releaseLease() {}, root}).then(
      () => {
        throw new Error('Torn record accepted')
      },
      (error) => {
        expect(String(error)).contains('Torn')
      },
    )
    expect(await fs.readFile(file)).deep.equal(bytes)
  })

  it('rejects key synchronization failure and releases the delegated lease', async () => {
    let releases = 0
    const io = faultIO(
      (file) => path.basename(file) === 'key',
      (_handle, key) =>
        key === 'sync'
          ? async () => {
              throw new Error('key sync unavailable')
            }
          : undefined,
    )
    await openTestJournal('session', {
      io,
      releaseLease() {
        releases++
      },
      root,
    }).then(
      () => {
        throw new Error('Unexpected open')
      },
      (error) => {
        expect(String(error)).contains('key sync')
      },
    )
    expect(releases).equal(1)
  })

  it('rejects ancestor sync failure without selecting a weaker level', async () => {
    let releases = 0
    const io = faultIO(
      (file) => file === root,
      (_handle, key) =>
        key === 'sync'
          ? async () => {
              throw new Error('directory sync unsupported')
            }
          : undefined,
    )
    await openTestJournal('session', {
      io,
      releaseLease() {
        releases++
      },
      root,
    }).then(
      () => {
        throw new Error('Unexpected fallback')
      },
      (error) => {
        expect(String(error)).contains('directory sync')
      },
    )
    expect(releases).equal(1)
    const weak = await openTestJournal('session', {io, level: 'file-sync', releaseLease() {}, root})
    await weak.append('run', 'run-admitted', {})
    expect(weak.level).equal('file-sync')
    await weak.close()
  })

  it('rejects unsupported levels at runtime and coalesces journal close', async () => {
    let releases = 0
    await openTestJournal('session', {
      level: 'unsupported' as never,
      releaseLease() {
        releases++
      },
      root,
    }).catch(() => {})
    expect(releases).equal(1)
    const journal = new MemoryExecutionJournal('session', () => {
      releases++
    })
    const first = journal.close()
    expect(journal.close()).equal(first)
    await first
    expect(releases).equal(2)
  })

  it('treats event IDs as idempotency keys and rejects conflicting records', async () => {
    const journal = new MemoryExecutionJournal('session')
    const first = await journal.append('run', 'run-admitted', {}, 0, 'event')
    expect(await journal.append('run', 'run-admitted', {}, 99, 'event')).deep.equal(first)
    await journal.append('run', 'run-admitted', {requestId: 'changed'}, 0, 'event').then(
      () => {
        throw new Error('Conflict accepted')
      },
      (error) => {
        expect(String(error)).contains('Conflicting')
      },
    )
    expect(journal.records()).length(1)
  })

  it('retains deletion intent after transcript removal and retries without the transcript', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({id: 'session'})
    await session.close()
    const service = new SessionDeletionService(repository, new MemorySessionLogStore())
    const remove = stub(fs, 'rm').callsFake(async () => {
      throw new Error('journal deletion interrupted')
    })
    try {
      await service.delete('session').catch(() => {})
    } finally {
      remove.restore()
    }

    expect(await repository.findById('session')).equal(undefined)
    expect(await service.delete('session')).deep.equal({id: 'session'})
    const marker = JSON.parse(await fs.readFile(path.join(repository.journalRoot, 'deletions/session.json'), 'utf8'))
    expect(marker).deep.equal({sessionId: 'session', state: 'completed', version: 1})
  })

  it('does not remove any artifact until deletion intent is acknowledged', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({id: 'session'})
    await session.close()
    const logs = new MemorySessionLogStore()
    let logDeletes = 0
    const original = logs.deleteSession.bind(logs)
    logs.deleteSession = async (id) => {
      logDeletes++
      return original(id)
    }

    const rename = stub(fs, 'rename').rejects(new Error('marker sync failed'))
    try {
      await new SessionDeletionService(repository, logs).delete('session').catch(() => {})
    } finally {
      rename.restore()
    }

    expect(await repository.findById('session')).not.equal(undefined)
    expect(logDeletes).equal(0)
  })

  it('retries after all artifacts were deleted but the final marker failed', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({id: 'session'})
    await session.close()
    const service = new SessionDeletionService(repository, new MemorySessionLogStore())
    const original = fs.rename
    const rename = stub(fs, 'rename').callsFake(async (from, to) => {
      const marker = JSON.parse(await fs.readFile(from, 'utf8'))
      if (marker.state === 'completed') throw new Error('final marker unavailable')
      return original(from, to)
    })
    try {
      await service.delete('session').catch(() => {})
    } finally {
      rename.restore()
    }

    expect(await repository.findById('session')).equal(undefined)
    expect(await service.delete('session')).deep.equal({id: 'session'})
  })

  it('shares Session close while the managed memory lease is retained', async () => {
    const {Session} = await import('../../../src/core/session/session.js')
    const session = new Session()
    const release = session.acquireManagedLease()
    const first = session.close()
    const second = session.close()
    expect(first).equal(second)
    release()
    await Promise.all([first, second])
    expect(() => session.acquireManagedLease()).throws('closed')
  })
})
