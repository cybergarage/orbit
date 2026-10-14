// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import syncFs from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {writeDeletionMarker} from '../../../src/core/execution/deletion.js'
import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {RunSupervisor} from '../../../src/core/execution/run.js'
import {Message, MessageType} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

async function refuses(action: Promise<unknown>, text: string) {
  try {
    await action
  } catch (error) {
    expect(String(error)).contains(text)
    return
  }

  throw new Error('Expected refusal')
}

describe('Persistent session archive', () => {
  let root: string
  let repository: SessionRepository

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-archive-test-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('preserves transcript identity and bytes across archive, restart, repeated requests and restoration', async () => {
    const session = repository.create({cwd: root, id: 'synthetic'})
    session.appendMessages([new Message(MessageType.User, {contents: ['Synthetic history']})])
    await session.close()
    const original = (await repository.findById('synthetic'))!
    const bytes = await fs.readFile(original.file)
    expect(original.archived).equals(false)
    await repository.setArchived('synthetic', true)
    await repository.setArchived('synthetic', true)
    repository = new SessionRepository({rootDir: repository.rootDir})
    expect((await repository.findById('synthetic'))!.archived).equals(true)
    expect((await repository.listPage({archive: 'active'})).data).length(0)
    expect((await repository.listPage({archive: 'archived'})).data.map((s) => s.id)).deep.equals(['synthetic'])
    expect((await repository.listPage()).data).length(1)
    const restored = await repository.setArchived('synthetic', false)
    expect(restored).include({archived: false, cwd: original.cwd, file: original.file, id: original.id})
    expect(await fs.readFile(original.file)).deep.equals(bytes)
    expect((await repository.listPage({archive: 'active'})).data).length(1)
  })

  it('preserves an acknowledged execution journal and diagnostic file through archive and restoration', async () => {
    const session = repository.create({id: 'settled'})
    const journal = await FileExecutionJournal.open('settled', {
      lease: session.acquireWriterLease(),
      level: process.platform === 'win32' ? 'file-sync' : 'file-and-directory-sync',
      root: repository.journalRoot,
    })
    const supervisor = new RunSupervisor()
    const handle = await supervisor.startRun({
      configuration: {},
      async execute(run) {
        await run.ready([])
        return 1
      },
      input: {},
      journal: async () => journal,
      requestId: 'synthetic-run',
      sessionId: 'settled',
    })
    expect((await handle.finished).outcome).equals('completed')
    await supervisor.close()
    await journal.close()
    await session.close()
    const directory = path.join(repository.journalRoot, 'settled', handle.id)
    const journalFile = path.join(directory, 'events.jsonl')
    const bytes = await fs.readFile(journalFile)
    const logs = path.join(root, 'synthetic-diagnostic.log')
    await fs.writeFile(logs, 'Synthetic diagnostics')
    await repository.setArchived('settled', true)
    await repository.setArchived('settled', false)
    expect(await fs.readFile(journalFile)).deep.equals(bytes)
    expect(await fs.readFile(logs, 'utf8')).equals('Synthetic diagnostics')
  })

  it('filters before pagination and rejects invalid filters', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      const session = repository.create({id})
      // eslint-disable-next-line no-await-in-loop
      await session.close()
      // eslint-disable-next-line no-await-in-loop
      if (id === 'a' || id === 'c') await repository.setArchived(id, true)
    }

    const first = await repository.listPage({archive: 'archived', limit: 1})
    const second = await repository.listPage({archive: 'archived', cursor: first.nextCursor, limit: 1})
    expect(new Set([...first.data, ...second.data].map((s) => s.id))).deep.equals(new Set(['a', 'c']))
    expect(second.nextCursor).to.be.undefined
    await refuses(repository.listPage({archive: 'invalid' as 'all'}), 'Invalid')
  })

  it('refuses open writers, deletion markers, missing identities and concurrent changes', async () => {
    const session = repository.create({id: 'owned'})
    await refuses(repository.setArchived('owned', true), 'already open')
    await session.close()
    const outcomes = await Promise.allSettled([
      repository.setArchived('owned', true),
      repository.setArchived('owned', false),
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).length(1)
    await refuses(repository.setArchived('missing', true), 'not found')
    await writeDeletionMarker(
      repository.journalRoot,
      'owned',
      'deleting',
      process.platform === 'win32' ? 'file-sync' : 'file-and-directory-sync',
    )
    await refuses(repository.setArchived('owned', false), 'deletion is recorded')
  })

  it('retains complete metadata and releases ownership after interrupted replacement', async () => {
    const session = repository.create({id: 'interrupted'})
    await session.close()
    await repository.setArchived('interrupted', true)
    const rename = stub(syncFs, 'renameSync').throws(new Error('Synthetic rename failure'))
    try {
      await refuses(repository.setArchived('interrupted', false), 'Synthetic rename failure')
    } finally {
      rename.restore()
    }

    expect(repository.isArchived('interrupted')).equals(true)
    expect(
      (await fs.readdir(path.join(repository.rootDir, '.coordination'))).filter((name) => name.endsWith('.tmp')),
    ).deep.equals([])
    expect((await repository.setArchived('interrupted', false)).archived).equals(false)
  })

  it('refuses unsettled durable evidence without changing transcript or journal bytes', async () => {
    const session = repository.create({id: 'unsettled'})
    await session.close()
    const summary = (await repository.findById('unsettled'))!
    const transcript = await fs.readFile(summary.file)
    const directory = path.join(repository.journalRoot, 'unsettled', 'synthetic-run')
    await fs.mkdir(directory, {recursive: true})
    const file = path.join(directory, 'events.jsonl')
    await fs.writeFile(file, 'incomplete synthetic journal')
    await refuses(repository.setArchived('unsettled', true), 'Torn journal')
    expect(repository.isArchived('unsettled')).equals(false)
    expect(await fs.readFile(summary.file)).deep.equals(transcript)
    expect(await fs.readFile(file, 'utf8')).equals('incomplete synthetic journal')
  })

  it('does not treat corrupt archive metadata as an active session', async () => {
    const session = repository.create({id: 'corrupt'})
    await session.close()
    await repository.setArchived('corrupt', true)
    await fs.writeFile(path.join(repository.rootDir, '.coordination', 'corrupt.archive.json'), '{}')
    const page = await repository.listPage()
    expect(page.data).length(0)
    expect(page.errors).length(1)
    await refuses(repository.setArchived('corrupt', false), 'not found')
  })
})
