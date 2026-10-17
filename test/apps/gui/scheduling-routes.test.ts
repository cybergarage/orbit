// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {LocalScheduler} from '../../../src/apps/gui/local-scheduler.js'
import {startGuiServer} from '../../../src/apps/gui/server.js'
import {DurableWorkStore} from '../../../src/core/execution/scheduled-work.js'
import {MemorySessionLogStore, OrbitApplicationService} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('GUI scheduling routes', () => {
  it('protects assets and schedule mutations and validates the transport without dispatch', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-routes-synthetic-')))
    const scheduler = new LocalScheduler(new DurableWorkStore(path.join(root, 'work.json')), async () => {
      throw new Error('Dispatch forbidden by this fixture')
    })
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          throw new Error('Models forbidden')
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      provider: 'ollama',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settingsSources: [],
    })
    const server = await startGuiServer({scheduler, service})
    const origin = `http://${server.host}:${server.port}`
    const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': server.token}
    const value = {
      next: 1000,
      operationId: randomUUID(),
      task: {
        instructions: 'No model work',
        name: 'Synthetic',
        permissions: 'workspace-read',
        version: 1,
        workspace: root,
      },
    }
    try {
      expect((await fetch(`${origin}/api/schedules`)).status).equal(403)
      const page = await fetch(`${origin}/?token=${server.token}`)
      expect(page.headers.get('content-security-policy')).include('img-src data:')
      expect(page.headers.get('content-security-policy')).not.include("img-src 'self'")
      expect((await fetch(`${origin}/client.js`)).status).equal(403)
      expect(
        (await fetch(`${origin}/api/schedules`, {headers: {...headers, Origin: 'https://unexpected.example'}})).status,
      ).equal(403)
      expect(
        (
          await fetch(`${origin}/api/schedules`, {
            body: JSON.stringify({...value, cron: '* * * * *'}),
            headers,
            method: 'POST',
          })
        ).status,
      ).equal(400)
      const created = await fetch(`${origin}/api/schedules`, {body: JSON.stringify(value), headers, method: 'POST'})
      expect(created.status).equal(201)
      const {id} = (await created.json()) as {id: string}
      const replay = await fetch(`${origin}/api/schedules`, {body: JSON.stringify(value), headers, method: 'POST'})
      expect(await replay.json()).deep.equal({id})
      expect(
        (
          await fetch(`${origin}/api/schedules/${id}`, {
            body: JSON.stringify({paused: 'yes'}),
            headers,
            method: 'PATCH',
          })
        ).status,
      ).equal(400)
      expect(
        (await fetch(`${origin}/api/schedules/${id}`, {body: JSON.stringify({paused: true}), headers, method: 'PATCH'}))
          .status,
      ).equal(200)
      expect(
        (
          await fetch(`${origin}/api/scheduled-runs/missing/reconcile`, {
            body: JSON.stringify({confirmedStopped: false, evidence: 'test'}),
            headers,
            method: 'POST',
          })
        ).status,
      ).equal(400)
      expect(scheduler.snapshot().runs).length(0)
      expect(scheduler.snapshot().schedules).length(1)
      expect(scheduler.snapshot().enabled).equal(false)
      expect(scheduler.snapshot().schedules[0].paused).equal(true)
      expect((await fetch(`${origin}/api/schedules/${id}`, {method: 'DELETE'})).status).equal(403)
      expect((await fetch(`${origin}/api/schedules/${id}`, {headers, method: 'DELETE'})).status).equal(200)
      expect((await fetch(`${origin}/api/schedules/${id}`, {headers, method: 'DELETE'})).status).equal(200)
      expect(scheduler.snapshot().schedules).length(0)
    } finally {
      await server.close()
      await scheduler.close()
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
