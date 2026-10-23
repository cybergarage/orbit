// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {ProjectSourceLease} from '../../../src/core/projects/source-lease.js'
import {WriterClaim} from '../../../src/core/session/coordination.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Registered Project source leases', () => {
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
