// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {startGuiServer} from '../../../src/apps/gui/server.js'
import {OrbitApplicationService, SessionRepository} from '../../../src/core/index.js'

describe('GUI server', () => {
  it('protects and validates the local application API', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-server-'))
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          throw new Error('The server test does not invoke a model.')
        },
      }),
      cwd: root,
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settingsSources: [],
      version: 'test-version',
    })
    const server = await startGuiServer({service, token: 'test-capability-token'})
    const baseUrl = `http://${server.host}:${server.port}`
    const headers = {'X-Orbit-Token': server.token}

    try {
      const unauthorized = await fetch(`${baseUrl}/api/runtime`)
      expect(unauthorized.status).to.equal(403)

      const runtime = await fetch(`${baseUrl}/api/runtime`, {headers})
      expect(runtime.status).to.equal(200)
      expect(await runtime.json()).to.include({cwd: root, version: 'test-version'})

      const createdResponse = await fetch(`${baseUrl}/api/threads`, {headers, method: 'POST'})
      expect(createdResponse.status).to.equal(201)
      const created = (await createdResponse.json()) as {id: string}

      const invalidMessage = await fetch(`${baseUrl}/api/threads/${created.id}/messages`, {
        body: JSON.stringify({content: '   '}),
        headers: {...headers, 'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(invalidMessage.status).to.equal(400)

      const preferences = await fetch(`${baseUrl}/api/preferences`, {
        body: JSON.stringify({debugPanelVisible: false, diagnosticCapture: 'metadata'}),
        headers: {...headers, 'Content-Type': 'application/json'},
        method: 'PATCH',
      })
      expect(await preferences.json()).to.deep.equal({debugPanelVisible: false, diagnosticCapture: 'metadata'})
    } finally {
      await server.close()
      await service.close()
    }
  })
})
