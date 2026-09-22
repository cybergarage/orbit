// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {startGuiServer} from '../../../src/apps/gui/server.js'
import {MemoryProjectStore, MemorySessionLogStore, OrbitApplicationService} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('GUI Project API', () => {
  it('checks capabilities, revisions, scope, retries and explicit membership changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-project-api-'))
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        async close() {},
        async invoke() {
          throw new Error('No model dispatch expected')
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'test',
      projectStore: new MemoryProjectStore(),
      provider: 'openai',
      repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
      settings: {},
      settingsSources: [],
    })
    const server = await startGuiServer({service})
    const base = `http://${server.host}:${server.port}`
    const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': server.token}
    const post = (route: string, body: unknown) =>
      fetch(base + route, {body: JSON.stringify(body), headers, method: 'POST'})
    try {
      expect((await fetch(base + '/api/projects')).status).equals(403)
      expect(
        (await fetch(base + '/api/projects', {headers: {...headers, Origin: 'https://untrusted.example'}})).status,
      ).equals(403)
      expect((await post('/api/projects', {directory: null, name: 'A', operationId: 'bad'})).status).equals(400)
      const request = {directory: root, name: 'A', operationId: randomUUID()}
      const a = (await (await post('/api/projects', request)).json()) as {id: string; revision: number}
      expect(a, JSON.stringify(a)).property('id')
      expect(await (await post('/api/projects', request)).json()).property('id', a.id)
      expect((await post('/api/projects', {...request, name: 'Changed'})).status).equals(409)
      const b = (await (await post('/api/projects', {...request, name: 'B', operationId: randomUUID()})).json()) as {
        id: string
      }
      const create = {operationId: randomUUID()}
      const thread = (await (await post(`/api/projects/${a.id}/threads`, create)).json()) as {id: string}
      expect(thread, JSON.stringify(thread)).property('id')
      expect(await (await post(`/api/projects/${a.id}/threads`, create)).json()).property('id', thread.id)
      expect((await post(`/api/projects/${b.id}/sessions/${thread.id}/resume`, {})).status).equals(404)
      expect((await post(`/api/projects/${a.id}/threads`, {...create, file: '/untrusted/path'})).status).equals(400)
      const note = {body: 'Remember the fixture.', operationId: randomUUID(), title: 'Fixture'}
      expect((await fetch(base + `/api/projects/${a.id}/memory`)).status).equals(403)
      const saved = (await (await post(`/api/projects/${a.id}/memory`, note)).json()) as {id: string}
      expect(saved).property('id', note.operationId)
      expect(await (await post(`/api/projects/${a.id}/memory`, note)).json()).property('id', saved.id)
      expect((await post(`/api/projects/${a.id}/memory`, {...note, body: 'Changed'})).status).equals(409)
      expect(
        (
          await post(`/api/projects/${a.id}/memory/excerpts`, {
            ...note,
            excerpt: 'unproven',
            file: '/forged',
            messageId: 'missing',
            sessionId: thread.id,
          })
        ).status,
      ).equals(400)
      const preview = await post(`/api/threads/${thread.id}/memory/preview`, {mode: 'curated', selectedIds: [saved.id]})
      expect(preview.status).equals(200)
      const captured = (await preview.json()) as {entries: {id: string}[]; generation: number;}
      expect(captured.entries.map((entry) => entry.id)).deep.equals([saved.id])
      const update = {body: 'Updated', expectedRevision: 1, operationId: randomUUID(), retired: false, title: 'Fixture'}
      expect(
        (
          await fetch(base + `/api/projects/${b.id}/memory/${saved.id}`, {
            body: JSON.stringify(update),
            headers,
            method: 'PATCH',
          })
        ).status,
      ).equals(404)
      expect(
        (
          await fetch(base + `/api/projects/${a.id}/memory/${saved.id}`, {
            body: JSON.stringify(update),
            headers,
            method: 'PATCH',
          })
        ).status,
      ).equals(200)
      expect(
        (
          await post(`/api/threads/${thread.id}/memory/preview`, {
            expectedGeneration: captured.generation,
            mode: 'curated',
          })
        ).status,
      ).equals(409)
      const move = {expectedRevision: 1, operationId: randomUUID(), projectId: b.id, sourceProjectId: a.id}
      expect((await post(`/api/sessions/${thread.id}/membership`, move)).status).equals(200)
      expect((await post(`/api/sessions/${thread.id}/membership`, move)).status).equals(200)
      expect((await post(`/api/sessions/${thread.id}/membership`, {...move, sourceProjectId: b.id})).status).equals(409)
      expect((await post(`/api/projects/${b.id}/sessions/${thread.id}/resume`, {})).status).equals(200)
      expect(
        (
          await post(`/api/sessions/${thread.id}/membership`, {
            expectedRevision: 2,
            operationId: randomUUID(),
            projectId: null,
            sourceProjectId: b.id,
          })
        ).status,
      ).equals(200)
      const unassigned = (await (await fetch(base + '/api/unassigned', {headers})).json()) as {data: {id: string}[]}
      expect(unassigned.data.map((item) => item.id)).includes(thread.id)
      const archive = await fetch(base + `/api/projects/${a.id}`, {
        body: JSON.stringify({...request, archived: true, expectedRevision: a.revision, operationId: randomUUID()}),
        headers,
        method: 'PATCH',
      })
      expect(archive.status).equals(200)
      expect((await post(`/api/projects/${a.id}/threads`, {operationId: randomUUID()})).status).equals(409)
    } finally {
      await server.close()
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
