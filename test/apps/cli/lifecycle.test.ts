// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {runDeleteSessionCommand} from '../../../src/apps/cli/delete.js'
import {runProjectCommand} from '../../../src/apps/cli/project.js'
import {runResumeSessionCommand} from '../../../src/apps/cli/resume.js'
import {runSessionArchiveCommand} from '../../../src/apps/cli/session/archive.js'
import {runDeleteSessionCommand as aliasDelete} from '../../../src/apps/cli/session/delete.js'
import {runSessionListCommand} from '../../../src/apps/cli/session/list.js'
import {runSessionUnarchiveCommand} from '../../../src/apps/cli/session/unarchive.js'
import {withProjectCatalog} from '../../../src/apps/project-catalog.js'
import {selectSessionSummary} from '../../../src/apps/session-selection.js'
import {MemoryProjectStore, ProjectService} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

async function rejects(action: Promise<unknown>, message: string) {
  try {
    await action
  } catch (error) {
    expect(String(error)).contains(message)
    return
  }

  throw new Error('Expected rejection')
}

describe('CLI project and session lifecycle', () => {
  let root: string
  let repository: SessionRepository
  let store: MemoryProjectStore
  let service: ProjectService

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-cli-lifecycle-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    store = new MemoryProjectStore()
    service = new ProjectService(
      store,
      repository,
      {
        async closeThread() {},
        getThread(): undefined {},
      },
      root,
    )
  })

  afterEach(async () => {
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  async function saved(id: string, createdAt = '2026-10-14T00:00:00Z') {
    const session = repository.create({
      createdAt,
      cwd: root,
      id,
      model: 'synthetic',
      originator: 'orbit-interactive',
      provider: 'openai',
      systemPrompt: 'Synthetic context',
    })
    await session.close()
    return (await repository.findById(id))!
  }

  it('keeps the session delete alias on the existing implementation', () => {
    expect(aliasDelete).equals(runDeleteSessionCommand)
  })

  it('routes compiled CLI lifecycle commands and enforces non-interactive deletion using synthetic storage', async () => {
    const cliRepository = new SessionRepository({
      journalRoot: path.join(root, '.orbit', 'runs'),
      rootDir: path.join(root, '.orbit', 'sessions'),
    })
    const session = cliRepository.create({cwd: root, id: 'cli-history'})
    await session.close()
    const p = await withProjectCatalog(cliRepository, (service) =>
      service.create({name: 'CLI synthetic project', operationId: randomUUID()}),
    )
    const script =
      "const os = require('node:os'); const path = require('node:path'); const {createRequire} = require('node:module'); const {pathToFileURL} = require('node:url'); os.homedir = () => process.argv[2]; const {execute} = createRequire(path.join(process.cwd(), 'package.json'))('@oclif/core'); execute({args: JSON.parse(process.argv[3]), dir: pathToFileURL(path.join(process.cwd(), 'bin/run.js')).href});"
    const runner = path.join(root, 'cli-runner.cjs')
    await fs.writeFile(runner, script)
    const cli = (args: string[]) =>
      promisify(execFile)(process.execPath, [runner, root, JSON.stringify(args)], {
        cwd: process.cwd(),
        env: {...process.env, ORBIT_LOG_DIR: path.join(root, 'logs')},
      })
    await cli(['session', 'archive', 'cli-history'])
    const listed = JSON.parse((await cli(['session', 'list', '--archive', 'archived'])).stdout)
    expect(listed.data.map((item: {id: string}) => item.id)).deep.equals(['cli-history'])
    await cli(['session', 'unarchive', 'cli-history'])
    await rejects(cli(['session', 'delete', 'cli-history']), '--force')
    await cli(['session', 'delete', 'cli-history', '--force'])
    expect(await cliRepository.findById('cli-history')).to.be.undefined
    await cli(['project', 'archive', p!.id])
    expect(JSON.parse((await cli(['project', 'list', '--archive', 'archived'])).stdout)).length(1)
    await cli(['project', 'unarchive', p!.id])
    await rejects(cli(['project', 'delete', p!.id]), '--force')
    await cli(['project', 'delete', p!.id, '--force'])
    expect(JSON.parse((await cli(['project', 'list'])).stdout)).length(0)
  })

  it('archives and restores the same transcript across restart and repeated operations', async () => {
    const summary = await saved('history')
    const bytes = await fs.readFile(summary.file)
    await runSessionArchiveCommand('history', repository)
    await runSessionArchiveCommand('history', repository)
    repository = new SessionRepository({rootDir: repository.rootDir})
    expect((await runSessionListCommand({archive: 'active'}, repository)).data).length(0)
    expect((await runSessionListCommand({archive: 'archived'}, repository)).data.map((s) => s.id)).deep.equals([
      'history',
    ])
    expect((await runSessionUnarchiveCommand('history', repository)).archived).equals(false)
    expect(await fs.readFile(summary.file)).deep.equals(bytes)
  })

  it('filters before pagination and preserves all-state default selection and directory scope', async () => {
    await saved('older')
    await saved('newer', '2026-10-14T01:00:00Z')
    await runSessionArchiveCommand('newer', repository)
    expect((await runSessionListCommand({archive: 'active', limit: 1}, repository)).data[0].id).equals('older')
    expect((await selectSessionSummary(repository, undefined, {last: true}, root)).id).equals('newer')
    expect((await selectSessionSummary(repository, undefined, {archive: 'active', last: true}, root)).id).equals(
      'older',
    )
    await rejects(selectSessionSummary(repository, 'newer', {archive: 'active'}, root), 'archive filter')
    await rejects(selectSessionSummary(repository, undefined, {last: true}, path.join(root, 'other')), 'No saved')
    expect(
      (await selectSessionSummary(repository, undefined, {all: true, last: true}, path.join(root, 'other'))).id,
    ).equals('newer')
  })

  it('refuses unknown identities, active writers, and damaged archive metadata', async () => {
    await rejects(runSessionArchiveCommand('missing', repository), 'not found')
    const session = repository.create({cwd: root, id: 'busy'})
    try {
      await rejects(runSessionArchiveCommand('busy', repository), 'writing')
    } finally {
      await session.close()
    }

    await saved('damaged')
    await fs.writeFile(path.join(repository.rootDir, '.coordination', 'damaged.archive.json'), 'invalid')
    await rejects(runSessionListCommand({}, repository), 'Session listing failed')
    await rejects(selectSessionSummary(repository, undefined, {last: true}, root), 'Session selection failed')
  })

  it('archives projects and lists both states with exact-ID pagination', async () => {
    const a = await service.create({name: 'A', operationId: randomUUID()})
    const b = await service.create({name: 'B', operationId: randomUUID()})
    await runProjectCommand(service, 'archive', a.id)
    expect(await runProjectCommand(service, 'list', undefined, {archive: 'archived'})).deep.equals([
      await store.query({id: a.id, kind: 'project'}),
    ])
    expect((await runProjectCommand(service, 'list')) as unknown[]).length(2)
    const ids = [a.id, b.id].sort()
    expect(
      ((await runProjectCommand(service, 'list', undefined, {after: ids[0]})) as {id: string}[]).map((p) => p.id),
    ).deep.equals([ids[1]])
    expect(await runProjectCommand(service, 'unarchive', a.id)).property('archived', false)
  })

  it('cancels deletion without mutation and confirms the exact project and scope', async () => {
    const p = await service.create({directory: root, name: 'Synthetic', operationId: randomUUID()})
    await fs.writeFile(path.join(root, 'source.txt'), 'Synthetic source')
    expect(
      await runProjectCommand(service, 'delete', p.id, {
        async confirm(target) {
          expect(target).deep.equals(p)
          return false
        },
      }),
    ).property('deleted', false)
    expect(await store.query({id: p.id, kind: 'project'})).deep.equals(p)
    expect(await runProjectCommand(service, 'delete', p.id, {confirm: async () => true})).property('deleted', true)
    expect(await store.query({id: p.id, kind: 'project'})).equals(null)
    expect(await fs.readFile(path.join(root, 'source.txt'), 'utf8')).equals('Synthetic source')
  })

  it('requires explicit force outside a terminal and never bypasses dependent-session integrity', async () => {
    const p = await service.create({name: 'Occupied', operationId: randomUUID()})
    const session = await service.createSession(p.id, randomUUID(), async () => ({}))
    const {id} = session.getMetadata()
    await session.close()
    await runSessionArchiveCommand(id, repository)
    await rejects(runProjectCommand(service, 'delete', p.id, {force: true}), 'Move or delete all')
    const listed = (await runProjectCommand(service, 'sessions', p.id, {archive: 'archived'})) as {data: unknown[]}
    expect(listed.data).length(1)
    if (!process.stdin.isTTY) await rejects(runProjectCommand(service, 'delete', p.id), '--force')
  })

  it('rejects missing IDs, invalid flags, closed catalogs and revision races after confirmation', async () => {
    await rejects(runProjectCommand(service, 'archive'), 'exact project ID')
    await rejects(runProjectCommand(service, 'delete', randomUUID(), {force: true}), 'Unknown project')
    await rejects(runProjectCommand(service, 'list', undefined, {force: true}), 'only available')
    const p = await service.create({name: 'Race', operationId: randomUUID()})
    await rejects(
      runProjectCommand(service, 'delete', p.id, {
        async confirm() {
          await runProjectCommand(service, 'archive', p.id)
          return true
        },
      }),
      'revision',
    )
    await store.close()
    await rejects(runProjectCommand(service, 'list'), 'closed')
  })

  it('reports unavailable membership and malformed catalog without dispatch or fallback', async () => {
    const p = await service.create({name: 'Unavailable', operationId: randomUUID()})
    const summary = await saved('unavailable')
    await service.changeMembership(summary.id, {
      expectedRevision: 0,
      operationId: randomUUID(),
      projectId: p.id,
      sourceProjectId: null,
      unavailable: true,
    })
    await rejects(
      runResumeSessionCommand(
        summary.id,
        {},
        {assertProjectActive: (id) => service.requireActive(id), repository, stdinIsTTY: true, stdoutIsTTY: true},
      ),
      'unavailable',
    )
    await rejects(runProjectCommand(service, 'delete', p.id, {force: true}), 'Move or delete all')
    await fs.writeFile(path.join(root, 'projects.sqlite'), 'Synthetic invalid database')
    await rejects(
      withProjectCatalog(repository, async () => true, true),
      'database',
    )
  })

  it('persists project lifecycle in the shared SQLite catalog and blocks archived-project resume before opening a writer', async () => {
    const p = await withProjectCatalog(repository, (s) => s.create({name: 'Persistent', operationId: randomUUID()}))
    const id = 'assigned'
    const summary = await saved(id)
    await withProjectCatalog(repository, async (s) => {
      await s.changeMembership(id, {
        expectedRevision: 0,
        operationId: randomUUID(),
        projectId: p!.id,
        sourceProjectId: null,
      })
      await runProjectCommand(s, 'archive', p!.id)
    })
    expect(
      await withProjectCatalog(repository, (s) => runProjectCommand(s, 'list', undefined, {archive: 'archived'})),
    ).to.have.length(1)
    await rejects(
      runResumeSessionCommand(
        id,
        {},
        {
          repository,
          async sessionRunner() {
            throw new Error('Must not dispatch')
          },
          stdinIsTTY: true,
          stdoutIsTTY: true,
        },
      ),
      'Project is archived',
    )
    const reopened = repository.open(summary.file)
    await reopened.close()
    await withProjectCatalog(repository, (s) => runProjectCommand(s, 'unarchive', p!.id))
    await runSessionArchiveCommand(id, repository)
    let resumed = false
    await runResumeSessionCommand(
      id,
      {},
      {
        repository,
        async sessionRunner() {
          resumed = true
        },
        settingsLoader: async () => ({}),
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    )
    expect(resumed).equals(true)
    expect(repository.isArchived(id)).equals(true)
  })
})
