// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {
  inspectSessionStorage,
  isSessionLocked,
  recoverSessionWriter,
  resumeSessionStorage,
  SessionRecorder,
  SessionRepository,
} from '../../../src/core/index.js'
import {offlineStorage} from '../../session-storage-fixture.js'

const binding = '.orbit-session-binding.json'
const guard = '.orbit-registration.guard'
describe('offline storage registration', () => {
  let root: string
  let repository: SessionRepository

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-registration-'))
    repository = new SessionRepository({journalRoot: path.join(root, 'journals'), rootDir: path.join(root, 'sessions')})
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  it('exports read-only inspection and explicit resume without issuing authority', async () => {
    const library = await import('../../../src/index.js')
    expect(library.inspectSessionStorage).equal(inspectSessionStorage)
    expect(library.resumeSessionStorage).equal(resumeSessionStorage)
    expect(repository.inspectStorage().state).equal('unregistered')
    expect(fs.existsSync(repository.rootDir)).equal(false)
    expect(() => repository.resumeStorage({} as never)).throws('Offline maintenance')
  })

  it('converts v1 under guards while preserving transcripts, journals and deletion evidence', () => {
    for (const dir of [repository.rootDir, repository.journalRoot]) {
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, binding),
        JSON.stringify({journalRoot: repository.journalRoot, sessionRoot: repository.rootDir, version: 1}),
      )
      fs.writeFileSync(path.join(dir, 'preserved'), 'original bytes')
    }

    expect(repository.inspectStorage().state).equal('legacy')
    expect(() => repository.scope('legacy')).throws('incomplete')
    repository.initializeStorage(offlineStorage)
    const {pairId} = repository.scope('legacy')
    repository.initializeStorage(offlineStorage)
    expect(repository.scope('legacy').pairId).equal(pairId)
    for (const dir of [repository.rootDir, repository.journalRoot])
      expect(fs.readFileSync(path.join(dir, 'preserved'), 'utf8')).equal('original bytes')
  })

  it('fsyncs each existing v2 binding on repetition and retains refusal after a sync failure', () => {
    repository.initializeStorage(offlineStorage)
    const scope = repository.scope('existing')
    const originalOpen = fs.openSync.bind(fs)
    const originalSync = fs.fsyncSync.bind(fs)
    const descriptors = new Map<number, string>()
    const synced = new Set<string>()
    const open = stub(fs, 'openSync').callsFake(((...args: Parameters<typeof fs.openSync>) => {
      const fd = originalOpen(...args)
      descriptors.set(fd, String(args[0]))
      return fd
    }) as typeof fs.openSync)
    const sync = stub(fs, 'fsyncSync').callsFake((fd) => {
      const file = descriptors.get(fd)!
      if (file.endsWith(binding)) {
        synced.add(file)
        if (file.startsWith(repository.journalRoot)) throw new Error('Injected existing file sync failure')
      }

      originalSync(fd)
    })
    try {
      expect(() => repository.initializeStorage(offlineStorage)).throws('Injected existing')
      expect(synced.size).equal(2)
    } finally {
      open.restore()
      sync.restore()
    }

    expect(() => repository.create()).throws('incomplete')
    expect(isSessionLocked(scope)).equal(true)
    expect(() => recoverSessionWriter(scope, offlineStorage)).throws('incomplete')
    expect(() => repository.initializeStorage(offlineStorage)).throws('explicit offline')
    repository.resumeStorage(offlineStorage)
    expect(repository.scope('existing').pairId).equal(scope.pairId)
  })

  it('preserves torn guard evidence and requires an exact offline review before replacement', () => {
    repository.initializeStorage(offlineStorage)
    const file = path.join(repository.rootDir, guard)
    fs.writeFileSync(file, '{torn')
    expect(() => repository.resumeStorage(offlineStorage)).throws('digest review')
    const report = repository.inspectStorage()
    const sha = report.artifacts.find((a) => a.file === file)!.sha256!
    expect(() => repository.resumeStorage(offlineStorage, {reviewedArtifacts: {[file]: '0'.repeat(64)}})).throws(
      'digest review',
    )
    repository.resumeStorage(offlineStorage, {reviewedArtifacts: {[file]: sha}})
    expect(
      fs.readFileSync(path.join(repository.rootDir, '.orbit-registration-evidence-' + sha + '.bin'), 'utf8'),
    ).equal('{torn')
    expect(repository.inspectStorage().state).equal('ready')
  })

  it('rejects conflicting pair identities even when the operator supplies their digests', () => {
    repository.initializeStorage(offlineStorage)
    const file = path.join(repository.journalRoot, binding)
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({...value, pairId: '22222222-2222-4222-8222-222222222222'}))
    const reviewedArtifacts = Object.fromEntries(repository.inspectStorage().artifacts.map((a) => [a.file, a.sha256!]))
    expect(() => repository.resumeStorage(offlineStorage, {reviewedArtifacts})).throws('Conflicting registration pair')
    expect(fs.existsSync(path.join(repository.rootDir, guard))).equal(false)
  })
  for (const kind of ['symlink', 'hardlink'])
    it(`refuses a ${kind} metadata artifact without modifying its target`, () => {
      repository.initializeStorage(offlineStorage)
      const file = path.join(repository.rootDir, binding)
      const saved = path.join(root, 'saved')
      fs.renameSync(file, saved)
      if (kind === 'symlink') fs.symlinkSync(saved, file)
      else fs.linkSync(saved, file)
      const bytes = fs.readFileSync(saved)
      expect(repository.inspectStorage().state).equal('conflicting')
      expect(() => repository.resumeStorage(offlineStorage)).throws('Invalid registration artifact')
      expect(fs.readFileSync(saved).equals(bytes)).equal(true)
    })

  it('refuses maintenance around local ownership and quarantines a writer when registration becomes pending', async () => {
    repository.initializeStorage(offlineStorage)
    const session = repository.create({id: 'active'})
    const file = session.getFile()!
    const scope = repository.scope('active')
    expect(() => repository.initializeStorage(offlineStorage)).throws('Local writer or cleanup')
    const marker = path.join(repository.journalRoot, guard)
    fs.writeFileSync(marker, '')
    expect(SessionRecorder.isOpen(file)).equal(true)
    expect(isSessionLocked(scope)).equal(true)
    expect(() => session.acquireWriterLease()).throws('incomplete')
    await session.close().then(
      () => {
        throw new Error('Unexpected release')
      },
      (error) => expect(String(error)).match(/incomplete/u),
    )
    expect(fs.existsSync(path.join(repository.rootDir, '.coordination', 'active.owner'))).equal(true)
    // Undo only this test's deliberate external protocol violation before cleanup.
    fs.unlinkSync(marker)
    await session.close()
  })

  it('rejects retained staging artifacts and only removes inspected leftovers after preserving them', () => {
    repository.initializeStorage(offlineStorage)
    const file = path.join(repository.journalRoot, '.orbit-binding-interrupted.tmp')
    fs.writeFileSync(file, 'partial staged data')
    expect(() => repository.scope('pending')).throws('incomplete')
    expect(() => repository.resumeStorage(offlineStorage)).throws('digest review')
    const sha = repository.inspectStorage().artifacts.find((a) => a.file === file)!.sha256!
    repository.resumeStorage(offlineStorage, {reviewedArtifacts: {[file]: sha}})
    expect(fs.existsSync(file)).equal(false)
    expect(
      fs.readFileSync(path.join(repository.journalRoot, '.orbit-registration-evidence-' + sha + '.bin'), 'utf8'),
    ).equal('partial staged data')
  })

  it('resyncs existing ancestry before the first guard and removes only reviewed dead legacy locks', () => {
    fs.mkdirSync(repository.rootDir, {recursive: true})
    const legacy = path.join(repository.rootDir, 'old.jsonl.lock')
    fs.writeFileSync(legacy, JSON.stringify({pid: 2_147_483_647, token: 'legacy-token'}))
    const descriptors = new Map<number, string>()
    const synced = new Set<string>()
    const originalOpen = fs.openSync.bind(fs)
    const originalSync = fs.fsyncSync.bind(fs)
    let observedGuard = false
    const open = stub(fs, 'openSync').callsFake(((...args: Parameters<typeof fs.openSync>) => {
      const file = String(args[0])
      if (file.endsWith(guard) && args[1] === 'wx' && !observedGuard) {
        observedGuard = true
        let directory = repository.rootDir
        while (true) {
          expect(synced.has(directory), directory).equal(true)
          const parent = path.dirname(directory)
          if (parent === directory) break
          directory = parent
        }
      }

      const fd = originalOpen(...args)
      descriptors.set(fd, file)
      return fd
    }) as typeof fs.openSync)
    const sync = stub(fs, 'fsyncSync').callsFake((fd) => {
      originalSync(fd)
      synced.add(descriptors.get(fd)!)
    })
    try {
      repository.initializeStorage(offlineStorage)
    } finally {
      open.restore()
      sync.restore()
    }

    expect(observedGuard).equal(true)
    expect(fs.existsSync(legacy)).equal(false)
    expect(repository.inspectStorage().state).equal('ready')
  })

  it('refuses an observable root replacement during registration and retains the Session guard', () => {
    repository.initializeStorage(offlineStorage)
    const originalOpen = fs.openSync.bind(fs)
    const originalSync = fs.fsyncSync.bind(fs)
    const descriptors = new Map<number, string>()
    let replaced = false
    const open = stub(fs, 'openSync').callsFake(((...args: Parameters<typeof fs.openSync>) => {
      const fd = originalOpen(...args)
      descriptors.set(fd, String(args[0]))
      return fd
    }) as typeof fs.openSync)
    const sync = stub(fs, 'fsyncSync').callsFake((fd) => {
      originalSync(fd)
      if (!replaced && descriptors.get(fd) === path.join(repository.rootDir, guard)) {
        replaced = true
        fs.renameSync(repository.journalRoot, path.join(root, 'displaced-journal'))
        fs.mkdirSync(repository.journalRoot)
      }
    })
    try {
      expect(() => repository.initializeStorage(offlineStorage)).throws('root identity changed')
    } finally {
      open.restore()
      sync.restore()
    }

    expect(replaced).equal(true)
    expect(fs.existsSync(path.join(repository.rootDir, guard))).equal(true)
    expect(() => repository.scope('after-replacement')).throws('incomplete')
  })

  it('preserves an interrupted evidence copy and syncs a new complete copy before repair', () => {
    repository.initializeStorage(offlineStorage)
    const file = path.join(repository.rootDir, guard)
    fs.writeFileSync(file, '{torn')
    const sha = repository.inspectStorage().artifacts.find((a) => a.file === file)!.sha256!
    const prefix = '.orbit-registration-evidence-' + sha
    const partial = path.join(repository.rootDir, prefix + '.bin')
    fs.writeFileSync(partial, '')
    repository.resumeStorage(offlineStorage, {reviewedArtifacts: {[file]: sha}})
    expect(fs.readFileSync(partial, 'utf8')).equal('')
    const copies = fs.readdirSync(repository.rootDir).filter((name) => name.startsWith(prefix + '-'))
    expect(copies).length(1)
    expect(fs.readFileSync(path.join(repository.rootDir, copies[0]), 'utf8')).equal('{torn')
    expect(repository.inspectStorage().state).equal('ready')
  })
})
