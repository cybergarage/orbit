// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */

import {expect} from 'chai'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {InitializationProfile} from '../../../src/core/maintenance/initialization.js'

import {initializationRoutes} from '../../../src/apps/gui/initialization-routes.js'
import {planInitialization} from '../../../src/core/maintenance/initialization.js'

const declarations = {
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  confirmation: 'INITIALIZE',
  exclusiveStorageControl: true,
}

describe('GUI initialization maintenance', () => {
  for (const mode of ['settings', 'data', 'all'] as const)
    it(`shares ${mode} plans, rejects unknown paths, stops before execution and stays offline`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-init-http-'))
      const settings = path.join(root, 'settings.json')
      fs.writeFileSync(settings, '{"apiKey":"SYNTHETIC-SECRET"}')
      const scheduled = path.join(root, 'gui-scheduled')
      fs.mkdirSync(scheduled)
      fs.writeFileSync(path.join(scheduled, 'work.json'), '{}')
      fs.writeFileSync(path.join(scheduled, 'work.json.lock'), 'owned fixture')
      const profile: InitializationProfile = {
        cacheRoots: [],
        ownedRoots: [root],
        preservedPaths: [],
        scheduledRoots: [scheduled],
        settingsFiles: [settings],
        stores: [],
      }
      let closes = 0
      const routes = initializationRoutes(profile, async () => {
        closes++
        fs.rmSync(path.join(scheduled, 'work.json.lock'), {force: true})
      })
      const app = express()
      app.use(express.json())
      app.use('/api', routes.router)
      app.use('/api', routes.admission)
      app.post('/api/work', (_r, response) => response.json({accepted: true}))
      app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
        response.status(400).json({error: error.message})
      })
      const server = app.listen(0, '127.0.0.1')
      await new Promise<void>((resolve) => {
        server.once('listening', resolve)
      })
      const base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api`
      const post = (route: string, body: unknown) =>
        fetch(base + route, {body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}, method: 'POST'})
      const selection = {mode, settingsFiles: mode === 'data' ? [] : [settings]}
      try {
        const unauthorized = await post('/initialization/prepare', {
          ...selection,
          settingsFiles: ['/unselected/settings.json'],
        })
        expect(unauthorized.status).equal(400)
        expect(closes).equal(0)
        const preview = await (await post('/initialization/plan', selection)).json()
        expect(JSON.stringify(preview)).not.contains('SYNTHETIC-SECRET')
        expect(preview).deep.equal(planInitialization({...profile, settingsFiles: selection.settingsFiles}, mode))
        expect(closes).equal(0)
        expect((await post('/initialization/execute', {...declarations, id: preview.id})).status).equal(409)
        const reviewed = await (await post('/initialization/prepare', selection)).json()
        expect(closes).equal(1)
        expect((await post('/work', {})).status).equal(503)
        expect((await post('/initialization/execute', {id: reviewed.id})).status).equal(400)
        expect(fs.existsSync(settings)).equal(true)
        const result = await post('/initialization/execute', {...declarations, id: reviewed.id})
        expect(result.status).equal(200)
        expect(fs.existsSync(settings)).equal(mode === 'data')
        expect(fs.existsSync(scheduled)).equal(mode === 'settings')
        expect((await post('/initialization/execute', {...declarations, id: reviewed.id})).status).equal(409)
        expect((await post('/work', {})).status).equal(503)
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
        fs.rmSync(root, {force: true, recursive: true})
      }
    })

  it('never deletes when resource shutdown rejects', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-init-refusal-'))
    const settings = path.join(root, 'settings.json')
    fs.writeFileSync(settings, 'fixture')
    const routes = initializationRoutes(
      {
        cacheRoots: [],
        ownedRoots: [root],
        preservedPaths: [],
        scheduledRoots: [],
        settingsFiles: [settings],
        stores: [],
      },
      async () => {
        throw new Error('Synthetic stop refusal')
      },
    )
    const app = express()
    app.use(express.json())
    app.use(routes.router)
    app.use(routes.admission)
    app.use((error: Error, _r: express.Request, response: express.Response, _n: express.NextFunction) => {
      response.status(400).json({error: error.message})
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => {
      server.once('listening', resolve)
    })
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`
    try {
      const response = await fetch(base + '/initialization/prepare', {
        body: JSON.stringify({mode: 'all', settingsFiles: [settings]}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(response.status).equal(400)
      expect(await response.text()).contains('stop refusal')
      expect(fs.existsSync(settings)).equal(true)
      expect((await fetch(base + '/anything')).status).equal(503)
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      fs.rmSync(root, {force: true, recursive: true})
    }
  })

  it('drains already admitted requests and rejects new work before closing resources', async () => {
    let finish: (() => void) | undefined
    let closed = false
    let admitted: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      admitted = resolve
    })
    const routes = initializationRoutes(
      {cacheRoots: [], ownedRoots: [], preservedPaths: [], scheduledRoots: [], settingsFiles: [], stores: []},
      async () => {
        closed = true
      },
    )
    const app = express()
    app.use(express.json())
    app.use('/api', routes.router)
    app.use('/api', routes.admission)
    app.post('/api/work', (_request, response) => {
      finish = () => {
        if (!response.headersSent) response.json({done: true})
      }

      admitted?.()
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => {
      server.once('listening', resolve)
    })
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api`
    try {
      const pending = fetch(base + '/work', {method: 'POST'})
      await ready
      const preparing = fetch(base + '/initialization/prepare', {
        body: JSON.stringify({mode: 'settings', settingsFiles: []}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      let maintenance = false
      while (!maintenance) {
        // Observe the admission barrier without relying on fixed sleeps.
        // eslint-disable-next-line no-await-in-loop
        const status = (await (await fetch(base + '/initialization')).json()) as {maintenance: boolean}
        maintenance = status.maintenance
      }

      expect(closed).equal(false)
      expect((await fetch(base + '/work', {method: 'POST'})).status).equal(503)
      finish?.()
      expect((await pending).status).equal(200)
      expect((await preparing).status).equal(200)
      expect(closed).equal(true)
    } finally {
      finish?.()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  })
})
