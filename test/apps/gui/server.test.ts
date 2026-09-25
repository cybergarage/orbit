// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {startGuiServer} from '../../../src/apps/gui/server.js'
import {
  guiSlashCommandHelpMessage,
  MemorySessionLogStore,
  OrbitApplicationService,
  PLUGIN_SCHEMA,
  PluginCatalog,
  SkillCatalog,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('GUI server', () => {
  it('protects and validates the local application API', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-server-'))
    const skillRoot = await fs.realpath(root)
    await fs.mkdir(path.join(skillRoot, 'review'))
    await fs.writeFile(
      path.join(skillRoot, 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Inspect tests\nlicense: MIT\ncompatibility: Requires Node.js\n---\nInspect the test.',
    )
    const packageRoot = path.join(root, 'plugin')
    await fs.mkdir(packageRoot)
    await fs.writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({$schema: PLUGIN_SCHEMA, name: 'gui-plugin'}))
    const plugins = await new PluginCatalog([{directory: packageRoot, id: 'gui'}], {dataRoot: path.join(root, 'data')}).load(new SkillCatalog([{directory: skillRoot, id: 'gui'}]))
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          throw new Error('The server test does not invoke a model.')
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'test-model',
      plugins,
      provider: 'ollama',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settingsSources: [],
      skillCatalog: new SkillCatalog([{directory: skillRoot, id: 'test'}]),
      version: 'test-version',
    })
    const server = await startGuiServer({service, token: 'test-capability-token'})
    const baseUrl = `http://${server.host}:${server.port}`
    const headers = {'X-Orbit-Token': server.token}

    try {
      const page = await fetch(`${baseUrl}/?token=${server.token}`)
      expect(page.status).to.equal(200)
      const html = await page.text()
      // The log pane must shrink within the viewport when restored logs are long.
      // Otherwise its grid row grows and pushes the composer below the hidden body overflow.
      const diagnosticsStyle = html.match(/\.diagnostics\s*\{([^}]+)\}/)?.[1]
      expect(diagnosticsStyle).to.match(/min-height:\s*0\s*;/)
      expect(diagnosticsStyle).to.match(/min-width:\s*0\s*;/)

      const unauthorized = await fetch(`${baseUrl}/api/runtime`)
      expect(unauthorized.status).to.equal(403)

      expect((await fetch(`${baseUrl}/api/plugins`)).status).equal(403)
      const pluginResponse = await fetch(`${baseUrl}/api/plugins`, {headers})
      expect(pluginResponse.status).equal(200)
      const pluginMetadata = await pluginResponse.json() as {plugins: Array<{id: string}>}
      expect(pluginMetadata.plugins[0].id).equal('gui')
      const skills = await fetch(`${baseUrl}/api/skills`, {headers})
      expect(skills.status).to.equal(200)
      const listing = (await skills.json()) as {candidates: Array<{compatibility?: string; license?: string;}>}
      expect(listing.candidates[0]).to.include({compatibility: 'Requires Node.js', license: 'MIT'})

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
      const unsupportedSelection = await fetch(`${baseUrl}/api/threads/${created.id}/messages`, {
        body: JSON.stringify({content: 'hello', requestId: 'selected', selection: {scope: 'unqualified'}}),
        headers: {...headers, 'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(unsupportedSelection.status).to.equal(400)

      for (const limits of [{toolRounds: -1}, {toolRounds: 1.5}, {unknown: 1}, {elapsedMs: 0}]) {
        // Each invalid request must finish before asserting its response.
        // eslint-disable-next-line no-await-in-loop
        const invalidLimits = await fetch(`${baseUrl}/api/threads/${created.id}/messages`, {
          body: JSON.stringify({content: 'hello', limits, requestId: 'invalid-limits'}),
          headers: {...headers, 'Content-Type': 'application/json'}, method: 'POST',
        })
        expect(invalidLimits.status).equal(400)
      }

      const commandResponse = await fetch(`${baseUrl}/api/threads/${created.id}/messages`, {
        body: JSON.stringify({content: '/help'}),
        headers: {...headers, 'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(commandResponse.status).to.equal(202)
      const command = (await commandResponse.json()) as {runId: string; threadId: string}
      expect(command).to.include({threadId: created.id})

      const commandThread = await fetch(`${baseUrl}/api/threads/${created.id}`, {headers})
      const commandSnapshot = (await commandThread.json()) as {messages: Array<{content: string}>}
      expect(commandSnapshot.messages.map((message) => message.content)).to.deep.equal([
        '/help',
        guiSlashCommandHelpMessage,
      ])
      expect(service.getEvents().find((event) => event.type === 'command.submitted')?.data).to.deep.equal({
        commandLength: 5,
        commandName: '/help',
        responseLength: guiSlashCommandHelpMessage.length,
      })

      const logs = await fetch(
        `${baseUrl}/api/sessions/${created.id}/logs?category=lifecycle&outcome=succeeded&limit=20`,
        {headers},
      )
      expect(logs.status).to.equal(200)
      const logPage = (await logs.json()) as {
        data: Array<{correlation: {sessionId?: string}; eventType: string; message: string; version: number}>
      }
      expect(logPage.data.map((record) => record.eventType)).to.include('session.created')
      expect(logPage.data.every((record) => record.correlation.sessionId === created.id)).to.equal(true)
      expect(logPage.data.every((record) => record.version === 2)).to.equal(true)

      const health = await fetch(`${baseUrl}/api/logs/health`, {headers})
      expect(health.status).to.equal(200)
      expect(await health.json()).to.include({failed: 0})

      const preferences = await fetch(`${baseUrl}/api/preferences`, {
        body: JSON.stringify({debugPanelVisible: false, diagnosticCapture: 'metadata'}),
        headers: {...headers, 'Content-Type': 'application/json'},
        method: 'PATCH',
      })
      expect(await preferences.json()).to.deep.equal({debugPanelVisible: false, diagnosticCapture: 'metadata'})

      const deleted = await fetch(`${baseUrl}/api/sessions/${created.id}`, {headers, method: 'DELETE'})
      expect(deleted.status).to.equal(200)
      expect(await deleted.json()).to.deep.equal({deleted: true, id: created.id})

      const missing = await fetch(`${baseUrl}/api/sessions/${created.id}`, {headers, method: 'DELETE'})
      expect(missing.status).to.equal(200)
      expect(await missing.json()).to.deep.equal({deleted: true, id: created.id})

      const missingLogs = await fetch(`${baseUrl}/api/sessions/${created.id}/logs`, {headers})
      expect(missingLogs.status).to.equal(404)
    } finally {
      await server.close()
      await service.close()
    }
  })
})
