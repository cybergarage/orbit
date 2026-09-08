// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import {stub} from 'sinon'

import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {
  coordinationPaths,
  initializeSessionStorage,
  isSessionLocked,
  MemorySessionLogStore,
  recoverSessionWriter,
  retrySessionCleanup,
  Session,
  SessionDeletionService,
  SessionRecorder,
  SessionRepository,
} from '../../../src/core/index.js'
import {offlineStorage} from '../../session-storage-fixture.js'

const execute = promisify(execFile)

describe('guarded session recovery', () => {
  let root: string
  let repository: SessionRepository

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-guard-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    repository.initializeStorage(offlineStorage)
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('requires reciprocal registration and rejects conflicting and nested bindings', async () => {
    const unregistered = new SessionRepository({rootDir: path.join(root, 'empty')})
    expect(() => unregistered.create()).throws('unregistered')
    expect(() => unregistered.initializeStorage({} as never)).throws('Offline maintenance')
    expect(() =>
      new SessionRepository({journalRoot: path.join(root, 'other'), rootDir: repository.rootDir}).create(),
    ).throws('conflicting')
    expect(() =>
      initializeSessionStorage(path.join(repository.rootDir, 'nested'), path.join(root, 'other'), offlineStorage),
    ).throws('ancestor')
    expect(() => initializeSessionStorage(path.join(root, 'other'), repository.journalRoot, offlineStorage)).throws(
      'ancestor',
    )
    await fs.unlink(path.join(repository.journalRoot, '.orbit-session-binding.json'))
    expect(() => repository.create()).throws('incomplete')
    expect(() => repository.initializeStorage(offlineStorage)).throws('explicit offline')
    repository.resumeStorage(offlineStorage)
    const session = repository.create()
    await session.close()
  })

  it('converges root aliases but rejects invalid IDs, duplicate IDs and hard-linked transcripts', async () => {
    await fs.symlink(repository.rootDir, path.join(root, 'alias'), 'dir')
    const alias = new SessionRepository({journalRoot: repository.journalRoot, rootDir: path.join(root, 'alias')})
    expect(alias.rootDir).equal(repository.rootDir)
    const session = repository.create({id: 'same'})
    expect(() => alias.create({id: 'same'})).throws('already open')
    const file = session.getFile()!
    await session.close()
    expect(() => alias.create({createdAt: '2026-08-01T00:00:00Z', id: 'same'})).throws('Duplicate')
    expect(() => repository.create({id: '../bad'})).throws('Invalid')
    expect(fsSync.existsSync(path.join(repository.rootDir, '.coordination', 'bad.guard'))).equal(false)
    await fs.link(file, path.join(root, 'linked'))
    expect(() => repository.open(file)).throws('Hard-linked')
    expect(isSessionLocked(repository.scope('same'))).equal(false)
    await fs.unlink(path.join(root, 'linked'))
    const reopened = alias.open(file)
    await reopened.close()
  })

  it('uses actual filesystem case identity for registered roots and writer exclusion', async () => {
    const alternateRoot = path.join(root, 'SESSIONS')
    const sameDirectory = fsSync.existsSync(alternateRoot)
    const alternate = new SessionRepository({rootDir: alternateRoot})
    const first = repository.create({id: 'case-identity'})
    try {
      if (sameDirectory) {
        expect(alternate.rootDir).equal(repository.rootDir)
        expect(alternate.journalRoot).equal(repository.journalRoot)
        expect(coordinationPaths(alternate.scope('case-identity'))).deep.equal(
          coordinationPaths(repository.scope('case-identity')),
        )
        expect(() => alternate.create({id: 'case-identity'})).throws('already open')
        expect(isSessionLocked(alternate.scope('case-identity'))).equal(true)
      } else {
        alternate.initializeStorage(offlineStorage)
        expect(alternate.rootDir).not.equal(repository.rootDir)
        expect(coordinationPaths(alternate.scope('case-identity')).owner).not.equal(
          coordinationPaths(repository.scope('case-identity')).owner,
        )
        const independent = alternate.create({id: 'case-identity'})
        await independent.close()
        expect(isSessionLocked(alternate.scope('case-identity'))).equal(false)
        expect(isSessionLocked(repository.scope('case-identity'))).equal(true)
      }
    } finally {
      await first.close()
    }

    if (sameDirectory) {
      expect(isSessionLocked(alternate.scope('case-identity'))).equal(false)
      const reopened = alternate.open(first.getFile()!)
      await reopened.close()
    }
  })

  it('never mutates ownership from read-only inspection or reclaims an abandoned guard', async () => {
    const session = repository.create({id: 'inspect'})
    const file = session.getFile()!
    await session.close()
    const scope = repository.scope('inspect')
    const paths = coordinationPaths(scope)
    await fs.writeFile(paths.owner, '{malformed')
    expect(SessionRecorder.isOpen(file)).equal(true)
    expect(isSessionLocked(scope)).equal(true)
    expect(await fs.readFile(paths.owner, 'utf8')).equal('{malformed')
    expect(() => repository.open(file)).throws('owner is unknown')
    expect(fsSync.existsSync(paths.guard)).equal(false)
    await fs.unlink(paths.owner)
    await fs.writeFile(paths.guard, '')
    expect(() => repository.open(file)).throws('guard busy')
    expect(() => recoverSessionWriter(scope, {} as never)).throws('Offline')
    recoverSessionWriter(scope, offlineStorage)
    const reopened = repository.open(file)
    await reopened.close()
    expect(SessionRecorder.isOpen(path.join(root, 'unknown'))).equal(true)
  })

  it('retains failed admission cleanup without returning a recorder and retries only that attempt', async () => {
    const session = repository.create({id: 'cleanup'})
    const file = session.getFile()!
    await session.close()
    const scope = repository.scope('cleanup')
    const paths = coordinationPaths(scope)
    const unlink = fsSync.unlinkSync.bind(fsSync)
    const fail = stub(fsSync, 'unlinkSync').callsFake((file) => {
      if (String(file) === paths.guard) throw new Error('guard unlink unavailable')
      unlink(file)
    })
    try {
      expect(() => repository.open(file)).throws('cleanup is retained')
    } finally {
      fail.restore()
    }

    expect(fsSync.existsSync(paths.guard)).equal(true)
    expect(() => repository.open(file)).throws('cleanup is pending')
    await retrySessionCleanup(scope)
    expect(fsSync.existsSync(paths.guard)).equal(false)
    const reopened = repository.open(file)
    await retrySessionCleanup(scope)
    expect(() => repository.open(file)).throws('already open')
    await reopened.close()
  })

  it('retries guard-only close after owner removal without reopening writes or removing a replacement', async () => {
    const scope = repository.scope('close')
    const paths = coordinationPaths(scope)
    const session = repository.create({id: 'close'})
    const unlink = fsSync.unlinkSync.bind(fsSync)
    const fail = stub(fsSync, 'unlinkSync').callsFake((file) => {
      if (String(file) === paths.guard) throw new Error('blocked guard cleanup')
      unlink(file)
    })
    try {
      await session.close().then(
        () => {
          throw new Error('Unexpected close')
        },
        (error) => {
          expect(String(error)).contains('blocked')
        },
      )
    } finally {
      fail.restore()
    }

    expect(fsSync.existsSync(paths.owner)).equal(false)
    expect(fsSync.existsSync(paths.guard)).equal(true)
    expect(() => session.acquireWriterLease()).throws('live persistent')
    await Promise.all([session.close(), session.close(), retrySessionCleanup(scope)])
    const next = repository.open(session.getFile()!)
    const token = await fs.readFile(paths.owner, 'utf8')
    await session.close()
    await retrySessionCleanup(scope)
    expect(await fs.readFile(paths.owner, 'utf8')).equal(token)
    await next.close()
  })

  it('cleans its partial owner under its guard after owner write failure', async () => {
    const scope = repository.scope('partial')
    const write = fsSync.writeFileSync.bind(fsSync)
    let writes = 0
    const fail = stub(fsSync, 'writeFileSync').callsFake(((...args: Parameters<typeof fsSync.writeFileSync>) => {
      if (++writes === 2) throw new Error('partial owner failure')
      return write(...args)
    }) as typeof fsSync.writeFileSync)
    try {
      expect(() => repository.create({id: 'partial'})).throws('partial owner failure')
    } finally {
      fail.restore()
    }

    expect(isSessionLocked(scope)).equal(false)
    const session = repository.create({id: 'partial'})
    await session.close()
  })

  it('validates journal capabilities before I/O and prevents premature release or reuse', async () => {
    const session = repository.create({id: 'lease'})
    let touches = 0
    const io = {
      ...fs,
      async stat(...args: Parameters<typeof fs.stat>) {
        touches++
        return fs.stat(...args)
      },
    } as typeof fs
    const invalid = await FileExecutionJournal.open('lease', {
      io,
      lease: (() => {}) as never,
      root: repository.journalRoot,
    }).catch((error) => error)
    expect(String(invalid)).contains('Invalid')
    expect(touches).equal(0)
    const lease = session.acquireWriterLease()
    await FileExecutionJournal.open('other', {io, lease, root: repository.journalRoot}).then(
      () => {
        throw new Error('Accepted wrong session')
      },
      (error) => {
        expect(String(error)).contains('mismatched')
      },
    )
    await FileExecutionJournal.open('lease', {io, lease, root: path.join(root, 'wrong')}).catch((error) => {
      expect(String(error)).contains('mismatched')
    })
    const journal = await FileExecutionJournal.open('lease', {lease, root: repository.journalRoot})
    expect(() => lease()).throws('Journal owns')
    await FileExecutionJournal.open('lease', {lease, root: repository.journalRoot}).catch((error) => {
      expect(String(error)).contains('consumed')
    })
    const closing = session.close()
    expect(isSessionLocked(repository.scope('lease'))).equal(true)
    await journal.append('run', 'run-admitted', {})
    await journal.close()
    await closing
    await FileExecutionJournal.open('lease', {lease, root: repository.journalRoot}).catch((error) => {
      expect(String(error)).contains('Invalid')
    })
    expect(() =>
      new Session({
        journalRoot: repository.journalRoot,
        metadata: {file: session.getFile(), id: 'fake'},
      } as never).acquireWriterLease(),
    ).throws()
    expect(touches).equal(0)
  })

  it('refuses legacy deletion and keeps one scope through delayed service deletion', async () => {
    const session = repository.create({id: 'delete'})
    const file = session.getFile()!
    await session.close()
    await repository.delete('delete').then(
      () => {
        throw new Error('Legacy deletion accepted')
      },
      (error) => {
        expect(String(error)).contains('SessionDeletionService')
      },
    )
    expect(fsSync.existsSync(file)).equal(true)
    const logs = new MemorySessionLogStore()
    let arrived!: () => void
    let proceed!: () => void
    const ready = new Promise<void>((resolve) => {
      arrived = resolve
    })
    logs.deleteSession = async () => {
      arrived()
      await new Promise<void>((resolve) => {
        proceed = resolve
      })
      return true
    }

    const service = new SessionDeletionService(repository, logs)
    const pending = service.delete('delete')
    await ready
    expect(() => repository.open(file)).throws('already open')
    expect(() => repository.create({id: 'delete'})).throws()
    await service.delete('delete').then(
      () => {
        throw new Error('Second deleter accepted')
      },
      (error) => {
        expect(String(error)).contains('already open')
      },
    )
    proceed()
    await pending
    logs.deleteSession = async () => true
    expect(await service.delete('delete')).deep.equal({id: 'delete'})
    expect(() => repository.create({id: 'delete'})).throws('deletion is recorded')
  })

  for (const checkpoint of ['guard-created', 'owner-read', 'stale-unlinked', 'owner-created', 'guard-released']) {
    it(`fails closed across process death at ${checkpoint}`, async () => {
      const session = repository.create({id: 'crash'})
      const file = session.getFile()!
      await session.close()
      const dead = await execute(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])
      const scope = repository.scope('crash')
      const paths = coordinationPaths(scope)
      await fs.writeFile(paths.owner, JSON.stringify({pid: Number(dead.stdout), token: 'stale', version: 1}))
      const script = `
        import fs from 'node:fs';
        import {SessionRepository} from './src/core/session/repository.ts';
        const repository = new SessionRepository({rootDir: process.env.ORBIT_TEST_SESSIONS});
        const checkpoint = process.env.ORBIT_TEST_CHECKPOINT;
        const finish = point => {if (point === checkpoint) process.exit(73)};
        const open = fs.openSync.bind(fs), read = fs.readFileSync.bind(fs), unlink = fs.unlinkSync.bind(fs);
        fs.openSync = (file, ...args) => {const result = open(file, ...args); if (String(file).endsWith('.guard')) finish('guard-created'); if (String(file).endsWith('.owner') && args[0] === 'wx') finish('owner-created'); return result};
        fs.readFileSync = (file, ...args) => {const result = read(file, ...args); if (String(file).endsWith('.owner')) finish('owner-read'); return result};
        fs.unlinkSync = file => {unlink(file); if (String(file).endsWith('.owner')) finish('stale-unlinked'); if (String(file).endsWith('.guard')) finish('guard-released')};
        repository.open(process.env.ORBIT_TEST_FILE); process.exit(74);
      `
      await execute(process.execPath, ['--loader', './test/alias-loader.mjs', '--input-type=module', '-e', script], {
        env: {
          ...process.env,
          ORBIT_TEST_CHECKPOINT: checkpoint,
          ORBIT_TEST_FILE: file,
          ORBIT_TEST_SESSIONS: repository.rootDir,
          TS_NODE_PROJECT: 'tsconfig.test.json',
        },
      }).then(
        () => {
          throw new Error('Missing process death')
        },
        (error) => {
          expect(error.code, error.stderr).equal(73)
        },
      )
      if (checkpoint !== 'guard-released') {
        expect(() => repository.open(file)).throws('guard busy')
        if (checkpoint === 'owner-created') {
          expect(() => recoverSessionWriter(scope, offlineStorage)).throws('unknown owner')
          expect(fsSync.existsSync(paths.guard)).equal(true)
          return
        }

        recoverSessionWriter(scope, offlineStorage)
      }

      const reopened = repository.open(file)
      await reopened.close()
    })
  }

  it('keeps reciprocal registration disabled after the initializer dies between roots', async () => {
    const storage = new SessionRepository({rootDir: path.join(root, 'new-sessions')})
    const script = `
      import fs from 'node:fs';
      import {SessionRepository} from './src/core/session/repository.ts';
      const repo = new SessionRepository({rootDir: process.env.ORBIT_TEST_ROOT});
      const sync = fs.fsyncSync.bind(fs), open = fs.openSync.bind(fs); const files = new Map();
      fs.openSync = (...args) => {const fd = open(...args); files.set(fd, String(args[0])); return fd};
      fs.fsyncSync = fd => {sync(fd); if (files.get(fd)?.endsWith('.orbit-session-binding.json')) process.exit(73)};
      repo.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true});
    `
    await execute(process.execPath, ['--loader', './test/alias-loader.mjs', '--input-type=module', '-e', script], {
      env: {...process.env, ORBIT_TEST_ROOT: storage.rootDir, TS_NODE_PROJECT: 'tsconfig.test.json'},
    }).then(
      () => {
        throw new Error('Missing interruption')
      },
      (error) => {
        expect(error.code, error.stderr).equal(73)
      },
    )
    expect(() => storage.create()).throws('incomplete')
    storage.resumeStorage(offlineStorage)
    const created = storage.create()
    await created.close()
  })

  for (const artifact of ['owner', 'guard']) {
    it(`restarts offline maintenance after process death removing ${artifact}`, async () => {
      const session = repository.create({id: 'maintenance'})
      const file = session.getFile()!
      await session.close()
      const scope = repository.scope('maintenance')
      const paths = coordinationPaths(scope)
      const dead = await execute(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])
      await fs.writeFile(paths.owner, JSON.stringify({pid: Number(dead.stdout), token: 'stale', version: 1}))
      await fs.writeFile(paths.guard, '')
      // This fixture owns both isolated roots; no service/restarter is launched until recovery finishes.
      const gate = path.join(root, 'external-admission-disabled')
      await fs.writeFile(gate, '')
      const script = `
        import fs from 'node:fs';
        import {SessionRepository, recoverSessionWriter} from './src/core/index.ts';
        const repo = new SessionRepository({rootDir: process.env.ORBIT_TEST_ROOT});
        const unlink = fs.unlinkSync.bind(fs);
        fs.unlinkSync = file => {unlink(file); if (String(file).endsWith('.' + process.env.ORBIT_TEST_ARTIFACT)) process.exit(73)};
        recoverSessionWriter(repo.scope('maintenance'), {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true});
      `
      await execute(process.execPath, ['--loader', './test/alias-loader.mjs', '--input-type=module', '-e', script], {
        env: {
          ...process.env,
          ORBIT_TEST_ARTIFACT: artifact,
          ORBIT_TEST_ROOT: repository.rootDir,
          TS_NODE_PROJECT: 'tsconfig.test.json',
        },
      }).then(
        () => {
          throw new Error('Missing interruption')
        },
        (error) => {
          expect(error.code, error.stderr).equal(73)
        },
      )
      expect(fsSync.existsSync(gate)).equal(true)
      if (artifact === 'owner') expect(() => repository.open(file)).throws('guard busy')
      recoverSessionWriter(scope, offlineStorage)
      await fs.unlink(gate)
      const reopened = repository.open(file)
      await reopened.close()
    })
  }

  it('settles lost unlink acknowledgement without removing a replacement token', async () => {
    const paths = coordinationPaths(repository.scope('ack'))
    const session = repository.create({id: 'ack'})
    const unlink = fsSync.unlinkSync.bind(fsSync)
    let lost = false
    const failure = stub(fsSync, 'unlinkSync').callsFake((file) => {
      unlink(file)
      if (String(file) === paths.owner && !lost) {
        lost = true
        throw new Error('acknowledgement lost')
      }
    })
    try {
      await session.close().catch((error) => {
        expect(String(error)).contains('acknowledgement lost')
      })
    } finally {
      failure.restore()
    }

    expect(fsSync.existsSync(paths.guard)).equal(true)
    await session.close()
    expect(isSessionLocked(repository.scope('ack'))).equal(false)
  })

  it('exports storage maintenance and scoped inspection from the public library', async () => {
    const library = await import('../../../src/index.js')
    expect(library.initializeSessionStorage).equal(initializeSessionStorage)
    expect(library.recoverSessionWriter).equal(recoverSessionWriter)
    expect(library.retrySessionCleanup).equal(retrySessionCleanup)
    expect(library.isSessionLocked).equal(isSessionLocked)
  })

  it('rejects copied capabilities and changed bindings before journal I/O', async () => {
    const session = repository.create({id: 'binding-lease'})
    const lease = session.acquireWriterLease()
    const options = {lease, root: repository.journalRoot}
    let touched = 0
    const io = {
      ...fs,
      async stat(...args: Parameters<typeof fs.stat>) {
        touched++
        return fs.stat(...args)
      },
    } as typeof fs
    await FileExecutionJournal.open('binding-lease', {...options, io, lease: (() => lease()) as never}).then(
      () => {
        throw new Error('Copied capability accepted')
      },
      (error) => {
        expect(String(error)).contains('Invalid')
      },
    )
    const bindingFile = path.join(repository.journalRoot, '.orbit-session-binding.json')
    const original = await fs.readFile(bindingFile, 'utf8')
    try {
      await fs.writeFile(bindingFile, original.replace(repository.rootDir, path.join(root, 'different')))
      await FileExecutionJournal.open('binding-lease', {...options, io}).then(
        () => {
          throw new Error('Changed binding accepted')
        },
        (error) => {
          expect(String(error)).contains('conflicting')
        },
      )
      expect(touched).equal(0)
    } finally {
      await fs.writeFile(bindingFile, original)
      lease()
      await session.close()
    }
  })

  it('does not unlink a replaced guard after a failed close', async () => {
    const scope = repository.scope('guard-replaced');
      const session = repository.create({id: 'guard-replaced'})
    const paths = coordinationPaths(scope);
      const unlink = fsSync.unlinkSync.bind(fsSync)
    const fail = stub(fsSync, 'unlinkSync').callsFake((file) => {
      if (String(file) === paths.guard) throw new Error('guard retained')
      unlink(file)
    })
    try {
      await session.close().catch((error) => {
        expect(String(error)).contains('guard retained')
      })
    } finally {
      fail.restore()
    }

    const original = await fs.readFile(paths.guard, 'utf8')
    const replacement = JSON.stringify({pid: process.pid, token: 'replacement', version: 1})
    try {
      await fs.writeFile(paths.guard, replacement)
      await retrySessionCleanup(scope).then(
        () => {
          throw new Error('Replaced guard removed')
        },
        (error) => {
          expect(String(error)).contains('token changed')
        },
      )
      expect(await fs.readFile(paths.guard, 'utf8')).equal(replacement)
    } finally {
      await fs.writeFile(paths.guard, original)
      await session.close()
    }
  })

  for (const point of ['guard-write', 'transcript-write', 'close-guard-write']) {
    it(`cleans only its own resources after ${point} failure`, async () => {
      const scope = repository.scope('io-unwind');
        const paths = coordinationPaths(scope)
      const session = point === 'close-guard-write' ? repository.create({id: 'io-unwind'}) : undefined
      const write = fsSync.writeFileSync.bind(fsSync)
      let count = 0
      const fail = stub(fsSync, 'writeFileSync').callsFake(((...args: Parameters<typeof fsSync.writeFileSync>) => {
        count++
        if (
          (point === 'transcript-write' && typeof args[0] === 'string' && args[0].endsWith('.jsonl')) ||
          (point !== 'transcript-write' && count === 1)
        )
          throw new Error('injected transition write failure')
        return write(...args)
      }) as typeof fsSync.writeFileSync)
      try {
        if (session)
          await session.close().catch((error) => {
            expect(String(error)).contains('injected')
          })
        else expect(() => repository.create({id: 'io-unwind'})).throws()
      } finally {
        fail.restore()
      }

      if (session) await session.close()
      await retrySessionCleanup(scope)
      expect(fsSync.existsSync(paths.guard)).equal(false)
      expect(fsSync.existsSync(paths.owner)).equal(false)
    })
  }

  it('rejects registering an ancestor around another registered repository', () => {
    expect(() => initializeSessionStorage(root, path.join(root, '.runs'), offlineStorage)).throws('nested')
  })
})
