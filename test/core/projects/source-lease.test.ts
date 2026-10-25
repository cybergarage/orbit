// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spy} from 'sinon'

import {ProjectSourceLease} from '../../../src/core/projects/source-lease.js'
import {WriterClaim} from '../../../src/core/session/coordination.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Registered Project source leases', () => {
  it('acquires mixed-case, numeric and punctuation identities in stable ordinal order without mutating input', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-source-order-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const expected = ['-', '10', '2', 'A-upper', '_', 'a-', 'a-lower', 'a_']
    const acquire = spy(WriterClaim, 'acquire')
    try {
      for (const input of [[...expected].reverse(), ['a-lower', '2', '_', 'A-upper', 'a_', '-', '10', 'a-']]) {
        acquire.resetHistory()
        const original = [...input]
        const lease = ProjectSourceLease.acquire(repository, input)
        try {
          expect(acquire.getCalls().map((call) => call.args[0].sessionId)).deep.equals(expected)
          expect(input).deep.equals(original)
        } finally {
          lease.close()
        }
      }
    } finally {
      acquire.restore()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('releases earlier ordered claims when a later session already has a writer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-source-conflict-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const writer = WriterClaim.acquire(repository.scope('a-last'), () => {}, true)
    try {
      expect(() => ProjectSourceLease.acquire(repository, ['a-last', 'A-first'])).throws()
      const available = ProjectSourceLease.acquire(repository, ['A-first'])
      available.close()
      expect(() => WriterClaim.acquire(repository.scope('a-last'), () => {}, true)).throws()
    } finally {
      writer.release()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('captures at original paths, excludes unleased sessions and prevents a concurrent writer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-source-lease-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const a = repository.create(); const b = repository.create()
    const aId = a.getId(); const bId = b.getId()
    await a.close(); await b.close()
    const lease = ProjectSourceLease.acquire(repository, [aId])
    try {
      expect((await lease.capture(aId)).sessionId).equals(aId)
      expect(() => WriterClaim.acquire(repository.scope(aId), () => {}, true)).throws()
      try {await lease.capture(bId); throw new Error('Expected unleased rejection')} catch (error) {expect(String(error)).contains('not leased')}
    } finally {lease.close()}

    const next = ProjectSourceLease.acquire(repository, [aId, bId])
    next.close()
    await fs.rm(root, {force: true, recursive: true})
  })
})
