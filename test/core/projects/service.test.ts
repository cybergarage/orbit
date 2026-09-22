// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {Message, MessageType} from '../../../src/core/index.js'
import {MemorySessionLogStore} from '../../../src/core/logs/index.js'
import {ProjectMemoryService} from '../../../src/core/projects/memory-service.js'
import {MemoryProjectStore} from '../../../src/core/projects/memory-store.js'
import {ProjectService} from '../../../src/core/projects/service.js'
import {SessionDeletionService} from '../../../src/core/session/deletion-service.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Project session coordination', () => {
  let root: string
  let repository: SessionRepository
  let store: MemoryProjectStore
  let service: ProjectService
  let running = false

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-project-service-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    store = new MemoryProjectStore()
    running = false
    service = new ProjectService(
      store,
      repository,
      {async closeThread() {}, getThread: () => (running ? {status: 'running'} : undefined)},
      root,
    )
  })

  afterEach(async () => {
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('synchronizes project creation and reconciles an exact retry without a second session', async () => {
    const project = await service.create({name: 'Project', operationId: randomUUID()})
    const operationId = randomUUID()
    const session = await service.createSession(project.id, operationId, async () => ({
      model: 'test',
      provider: 'openai',
    }))
    expect(session.getMetadata().cwd).equals(root)
    expect(await service.membership(session.getId())).include({projectId: project.id, revision: 1})
    await session.close()
    const retried = await service.createSession(project.id, operationId, async () => ({
      model: 'different',
      provider: 'openai',
    }))
    expect(retried.getMetadata().model).equals('test')
    await retried.close()
    expect((await repository.listPage()).data).length(1)
  })

  it('retains a pending reservation and empty orphan when the project changes before commit', async () => {
    const project = await service.create({name: 'Project', operationId: randomUUID()})
    const operationId = randomUUID()
    try {
      await service.createSession(project.id, operationId, async () => {
        await service.update(project.id, {
          archived: true,
          directory: null,
          expectedRevision: 1,
          name: project.name,
          operationId: randomUUID(),
        })
        return {}
      })
      throw new Error('Expected creation failure')
    } catch (error) {
      expect(String(error)).contains('creation incomplete')
    }

    expect(await store.query({id: operationId, kind: 'reservation'})).property('state', 'pending')
    expect(await service.membership(operationId)).equals(null)
    expect((await repository.listPage()).data).length(1)
  })

  it('reconciles completed CLI deletion and retires derived memory without requiring CLI catalog access', async () => {
    const project = await service.create({name: 'Project', operationId: randomUUID()})
    const session = await service.createSession(project.id, randomUUID(), async () => ({}))
    const [message] = session.appendMessages([new Message(MessageType.Assistant, {content: 'Retain this fact.'})])
    await session.synchronize('file-sync')
    await session.close()
    const memory = new ProjectMemoryService(service, {async closeThread() {}, getThread(): undefined {}})
    const note = await memory.saveExcerpt(project.id, {
      excerpt: 'Retain this fact.',
      messageId: message.id,
      operationId: randomUUID(),
      sessionId: session.getId(),
      title: 'Fact',
    })
    const logs = new MemorySessionLogStore()
    try {
      await new SessionDeletionService(repository, logs).delete(session.getId())
      expect((await service.listSessions(project.id)).data).length(0)
      expect(await service.membership(session.getId())).property('projectId', null)
      expect(await store.query({id: note.id, kind: 'memory'})).property('retired', true)
    } finally {
      await memory.close()
      await logs.close()
    }
  })

  it('refuses corrupt deletion evidence rather than hiding the source as missing', async () => {
    const project = await service.create({name: 'Project', operationId: randomUUID()})
    const session = await service.createSession(project.id, randomUUID(), async () => ({}))
    await session.close()
    await fs.mkdir(path.join(repository.journalRoot, 'deletions'), {recursive: true})
    await fs.writeFile(path.join(repository.journalRoot, 'deletions', session.getId() + '.json'), '{"version":99}')
    try {
      await service.listSessions(project.id)
      throw new Error('Expected invalid evidence')
    } catch (error) {
      expect(String(error)).contains('Invalid Project source deletion marker')
    }

    expect(await service.membership(session.getId())).property('projectId', project.id)
  })

  it('moves only idle registered sessions while preserving their cwd and history', async () => {
    const a = await service.create({name: 'A', operationId: randomUUID()})
    const b = await service.create({name: 'B', operationId: randomUUID()})
    const session = await service.createSession(a.id, randomUUID(), async () => ({}))
    const id = session.getId()
    await session.close()
    running = true
    try {
      await service.changeMembership(id, {
        expectedRevision: 1,
        operationId: randomUUID(),
        projectId: b.id,
        sourceProjectId: a.id,
      })
      throw new Error('Expected active-session refusal')
    } catch (error) {
      expect(String(error)).contains('idle')
    }

    running = false
    const options = {expectedRevision: 1, operationId: randomUUID(), projectId: b.id, sourceProjectId: a.id}
    await service.changeMembership(id, options)
    expect(await service.changeMembership(id, options)).include({projectId: b.id, revision: 2})
    expect((await repository.findById(id))?.cwd).equals(root)
  })
})
