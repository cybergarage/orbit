// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {runDeleteSessionCommand} from '../../../src/apps/cli/delete.js'
import {MemorySessionLogStore, StoreSessionLoggerFactory} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('delete command', () => {
  it('asks for confirmation before deleting a session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-delete-command-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    await session.close()
    const logs = new MemorySessionLogStore()
    new StoreSessionLoggerFactory(logs).forSession('session-1').info('delete me')
    let promptedId = ''

    const result = await runDeleteSessionCommand('session-1', {
      async confirm(summary) {
        promptedId = summary.id
        return true
      },
      logStore: logs,
      repository,
    })

    expect(promptedId).to.equal('session-1')
    expect(result).to.deep.include({deleted: true})
    expect(result.session).to.include({id: 'session-1'})
    expect(await repository.findById('session-1')).to.equal(undefined)
    expect((await logs.list('session-1')).data).to.deep.equal([])
  })

  it('preserves the session when confirmation is declined', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-delete-command-cancel-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    await session.close()

    const result = await runDeleteSessionCommand('session-1', {
      confirm: async () => false,
      logStore: new MemorySessionLogStore(),
      repository,
    })

    expect(result.deleted).to.equal(false)
    expect(await repository.findById('session-1')).to.include({id: 'session-1'})
  })

  it('skips confirmation with force and rejects unknown sessions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-delete-command-force-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    await session.close()

    const result = await runDeleteSessionCommand('session-1', {
      async confirm() {
        throw new Error('Confirmation should not be called with force.')
      },
      force: true,
      logStore: new MemorySessionLogStore(),
      repository,
    })

    expect(result.deleted).to.equal(true)
    try {
      await runDeleteSessionCommand('missing', {force: true, logStore: new MemorySessionLogStore(), repository})
      throw new Error('Expected an unknown session error.')
    } catch (error) {
      expect((error as Error).message).to.equal('Unknown session: missing')
    }
  })
})
