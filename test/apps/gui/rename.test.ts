// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */
import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import {runProjectCommand} from '../../../src/apps/cli/project.js'
import {startGuiServer} from '../../../src/apps/gui/server.js'
import {selectedSessionSummary} from '../../../src/apps/gui/session-information.js'
import {
  MemoryProjectStore,
  MemorySessionLogStore,
  OrbitApplicationService,
  type SessionSummary,
  type ThreadSnapshot,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

describe('Rename HTTP and application integration', () => {
  let root: string
  let repository: SessionRepository
  let service: OrbitApplicationService
  let closeAgent: () => Promise<void>
  let releaseClose: () => void

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-rename-integration-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    closeAgent = async () => {}
    releaseClose = () => {}
    service = new OrbitApplicationService({
      contexts: [],
      createAgent: () => ({
        close: () => closeAgent(),
        async invoke() {
          throw new Error('Synthetic fixture must not dispatch')
        },
      }),
      cwd: root,
      logStore: new MemorySessionLogStore(),
      model: 'synthetic',
      projectStore: new MemoryProjectStore(),
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
    })
  })

  afterEach(async () => {
    releaseClose()
    restore()
    await service.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('uses authenticated shared APIs, keeps list/detail/open names consistent, preserves moves and rejects stale input', async () => {
    const server = await startGuiServer({service})
    const base = `http://${server.host}:${server.port}/api`
    const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': server.token}
    const request = (route: string, body: unknown, method = 'PATCH') =>
      fetch(base + route, {body: JSON.stringify(body), headers, method})
    try {
      const project = await service.projects!.create({directory: root, name: 'Original', operationId: randomUUID()})
      // Name-only rename must not inspect an unrelated unavailable directory.
      const directoryCheck = stub(fs, 'stat').rejects(new Error('Synthetic offline directory'))
      const renamed = (await runProjectCommand(service.projects!, 'rename', project.id, {
        name: '  日本語 project  ',
      })) as typeof project
      directoryCheck.restore()
      expect(renamed).include({archived: false, defaultDirectory: root, name: '日本語 project', revision: 2})
      const settings = await request(`/projects/${project.id}`, {
        expectedRevision: 2,
        name: 'Settings name',
        operationId: randomUUID(),
      })
      expect(settings.status).equals(200)
      expect(await settings.json()).include({archived: false, defaultDirectory: root, name: 'Settings name'})
      const renameProject = {expectedRevision: 3, name: 'Common name', operationId: randomUUID()}
      expect((await request(`/projects/${project.id}/rename`, renameProject, 'POST')).status).equals(200)
      expect((await request(`/projects/${project.id}/rename`, renameProject, 'POST')).status).equals(200)
      const thread = await service.createProjectThread(project.id, {operationId: randomUUID()})
      const before = await repository.findById(thread.id)
      const bytes = await fs.readFile(before!.file)
      const input = {expectedRevision: 0, operationId: randomUUID(), title: '日本語 session'}
      expect(
        (
          await fetch(`${base}/sessions/${thread.id}`, {
            body: JSON.stringify(input),
            headers: {'Content-Type': 'application/json'},
            method: 'PATCH',
          })
        ).status,
      ).equals(403)
      expect((await request(`/sessions/${thread.id}`, {...input, file: '/forged'})).status).equals(400)
      const response = await request(`/sessions/${thread.id}`, input)
      expect(response.status).equals(200)
      const session = (await response.json()) as SessionSummary
      expect(session).include({title: input.title, titleRevision: 1})
      expect((await request(`/sessions/${thread.id}`, input)).status).equals(200)
      expect((await request(`/sessions/${thread.id}`, {...input, operationId: randomUUID()})).status).equals(409)
      const detail = (await (await fetch(`${base}/sessions/${thread.id}`, {headers})).json()) as SessionSummary
      const listing = (await (await fetch(`${base}/sessions`, {headers})).json()) as {data: SessionSummary[]}
      const projectList = (await (await fetch(`${base}/projects/${project.id}/sessions`, {headers})).json()) as {
        data: {session: SessionSummary}[]
      }
      const open = (await (await fetch(`${base}/threads/${thread.id}`, {headers})).json()) as ThreadSnapshot
      expect(detail).deep.equals(listing.data[0])
      expect(detail).deep.equals(projectList.data[0].session)
      expect(open).include({title: input.title, titleRevision: 1})
      expect(selectedSessionSummary(open, listing.data)).include({title: input.title, titleRevision: 1})
      expect(await fs.readFile(before!.file)).deep.equals(bytes)
      await service.deleteSession(thread.id)
      expect((await request(`/sessions/${thread.id}`, input)).status).not.equals(200)
      expect((await fetch(`${base}/sessions/${thread.id}`, {headers})).status).equals(404)
    } finally {
      await server.close()
    }
  })

  it('blocks run admission during rename and reopens the idle conversation', async () => {
    const closing = deferred()
    const settled = deferred()
    closeAgent = () => {
      closing.resolve()
      return settled.promise
    }

    releaseClose = settled.resolve
    const thread = service.createThread()
    const rename = service.renameSession(thread.id, {
      expectedRevision: 0,
      operationId: randomUUID(),
      title: 'Idle title',
    })
    await closing.promise
    let refused: unknown
    try {
      await service.startRun(thread.id, 'Synthetic input')
    } catch (error) {
      refused = error
    }

    expect(String(refused)).contains('lifecycle change')
    settled.resolve()
    expect(await rename).include({title: 'Idle title', titleRevision: 1})
    expect(service.getThread(thread.id)).include({status: 'idle', title: 'Idle title'})
  })

  it('refuses running and quarantined threads before closing ownership', async () => {
    for (const thread of [{status: 'running'}, {run: {quarantined: true}, status: 'idle'}]) {
      const snapshot = stub(service, 'getThread').returns(thread as ThreadSnapshot)
      let rejected: unknown
      try {
        // eslint-disable-next-line no-await-in-loop
        await service.renameSession('synthetic', {expectedRevision: 0, operationId: randomUUID(), title: 'Busy'})
      } catch (error) {
        rejected = error
      }

      expect(String(rejected)).contains('active or quarantined')
      snapshot.restore()
    }
  })
})
