// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {coordinationPaths, WriterClaim} from '../../../src/core/session/coordination.js'
import {SessionRepository} from '../../session-storage-fixture.js'

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
    fs.renameSync(replacement, files.owner)
    expect(() => claim.release()).throws('identity changed')
    expect(fs.readFileSync(files.owner).equals(bytes)).equal(true)
    // Only this synthetic fixture is removed, then retained cleanup can settle.
    fs.unlinkSync(files.owner)
    claim.release()
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
