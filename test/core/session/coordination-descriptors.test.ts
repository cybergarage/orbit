// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {stub} from 'sinon'

import {beginTranscriptMaintenance, coordinationPaths, WriterClaim} from '../../../src/core/session/coordination.js'
import {offlineStorage, SessionRepository} from '../../session-storage-fixture.js'

describe('coordination descriptor ownership', () => {
  let root: string
  let repository: SessionRepository

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-descriptors-')))
    repository = new SessionRepository({rootDir: root})
  })

  afterEach(() => fs.rmSync(root, {force: true, recursive: true}))

  it('keeps owner descriptors open until verified unlink across repeated names', () => {
    const scope = repository.scope('reused')
    const files = coordinationPaths(scope)
    const open = fs.openSync.bind(fs)
    const descriptors: number[] = []
    const track = stub(fs, 'openSync').callsFake(((file, ...args) => {
      const fd = open(file, ...args)
      if (String(file) === files.owner || String(file) === files.guard) descriptors.push(fd)
      return fd
    }) as typeof fs.openSync)
    try {
      for (let i = 0; i < 100; i++) {
        const claim = WriterClaim.acquire(scope, () => {})
        expect(() => fs.fstatSync(descriptors.at(-1)!)).not.throws()
        expect(() => WriterClaim.acquire(scope, () => {})).throws('already open')
        claim.release()
        for (const fd of descriptors) expect(() => fs.fstatSync(fd)).throws()
        descriptors.length = 0
        expect(fs.existsSync(files.owner) || fs.existsSync(files.guard)).equal(false)
      }
    } finally {
      track.restore()
    }
  })

  it('rejects an identical-token replacement and closes the original descriptor', () => {
    const scope = repository.scope('replaced')
    const files = coordinationPaths(scope)
    const claim = WriterClaim.acquire(scope, () => {})
    const replacement = path.join(root, 'replacement')
    const bytes = fs.readFileSync(files.owner)
    fs.writeFileSync(replacement, bytes)
    try {
      fs.renameSync(replacement, files.owner)
    } catch (error) {
      // Windows may prohibit replacing a file while its creation handle is held.
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      expect(fs.readFileSync(files.owner).equals(bytes)).equal(true)
      claim.release()
      return
    }

    expect(() => claim.release()).throws('identity changed')
    expect(fs.readFileSync(files.owner).equals(bytes)).equal(true)
    // Only this synthetic fixture is removed, then retained cleanup can settle.
    fs.unlinkSync(files.owner)
    claim.release()
  })

  it('rejects a changed inode even when the owner token is unchanged', () => {
    const scope = repository.scope('identity-changed')
    const files = coordinationPaths(scope)
    const claim = WriterClaim.acquire(scope, () => {})
    const lstat = fs.lstatSync.bind(fs)
    const altered = stub(fs, 'lstatSync').callsFake(((file, ...args) => {
      const stat = lstat(file, ...args)
      if (String(file) === files.owner) return Object.assign(Object.create(stat), {ino: stat.ino === 0 ? 1 : 0})
      return stat
    }) as typeof fs.lstatSync)
    try {
      expect(() => claim.release()).throws('identity changed')
      expect(fs.existsSync(files.owner)).equal(true)
    } finally {
      altered.restore()
      claim.release()
    }
  })

  for (const failure of ['write', 'unlink']) {
    it(`closes descriptors and preserves evidence after ${failure} failure`, () => {
      const scope = repository.scope('failed-' + failure)
      const files = coordinationPaths(scope)
      const descriptors: number[] = []
      const open = fs.openSync.bind(fs)
      const track = stub(fs, 'openSync').callsFake(((file, ...args) => {
        const fd = open(file, ...args)
        if (/\.(guard|owner)$/u.test(String(file))) descriptors.push(fd)
        return fd
      }) as typeof fs.openSync)
      let claim: undefined | WriterClaim
      let fail: ReturnType<typeof stub> | undefined
      try {
        if (failure === 'write') {
          fail = stub(fs, 'writeFileSync').throws(new Error('write failed'))
          expect(() => WriterClaim.acquire(scope, () => {})).throws()
        } else {
          claim = WriterClaim.acquire(scope, () => {})
          fail = stub(fs, 'unlinkSync').throws(new Error('unlink failed'))
          expect(() => claim!.release()).throws('unlink failed')
          expect(fs.existsSync(files.owner)).equal(true)
        }

        for (const fd of descriptors) expect(() => fs.fstatSync(fd)).throws()
      } finally {
        fail?.restore()
        track.restore()
        claim?.release()
      }
    })
  }

  for (const resume of [false, true]) {
    it(`closes maintenance descriptors without deleting evidence on abort (resume=${resume})`, () => {
      const scope = repository.scope('maintenance')
      const files = coordinationPaths(scope)
      const open = fs.openSync.bind(fs)
      const descriptors: number[] = []
      const track = stub(fs, 'openSync').callsFake(((file, ...args) => {
        const fd = open(file, ...args)
        if (String(file) === files.guard) descriptors.push(fd)
        return fd
      }) as typeof fs.openSync)
      try {
        const guard = beginTranscriptMaintenance(scope, offlineStorage, resume, 'synthetic-resume-token')
        guard.close()
        for (const fd of descriptors) expect(() => fs.fstatSync(fd)).throws()
        expect(fs.existsSync(files.guard)).equal(true)
      } finally {
        track.restore()
      }
    })
  }

  it('closes every descriptor when preparation fails', () => {
    const scope = repository.scope('prepare-failed')
    const open = fs.openSync.bind(fs)
    const descriptors: number[] = []
    const track = stub(fs, 'openSync').callsFake(((file, ...args) => {
      const fd = open(file, ...args)
      if (/\.(guard|owner)$/u.test(String(file))) descriptors.push(fd)
      return fd
    }) as typeof fs.openSync)
    try {
      expect(() =>
        WriterClaim.acquire(scope, () => {
          throw new Error('preparation failed')
        }),
      ).throws('preparation failed')
      for (const fd of descriptors) expect(() => fs.fstatSync(fd)).throws()
    } finally {
      track.restore()
    }
  })
})
