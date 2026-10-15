// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sinon from 'sinon'

import {runSessionRenameCommand} from '../../src/apps/cli/session/rename.js'
import {
  createSessionInformation,
  MemorySessionLogStore,
  Message,
  MessageType,
  SessionDeletionService,
  sessionDisplayName,
} from '../../src/core/index.js'
import {SessionRepository} from '../session-storage-fixture.js'

async function rejects(action: Promise<unknown>, text: string) {
  try {
    await action
  } catch (error) {
    expect(String(error)).contains(text)
    return
  }

  throw new Error('Expected rejection')
}

describe('Session display name persistence', () => {
  let root: string
  let repository: SessionRepository
  let id: string
  let file: string
  let bytes: Buffer

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-title-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create()
    session.appendMessages([new Message(MessageType.User, {content: 'Original synthetic conversation'})])
    id = session.getId()
    file = session.getFile()!
    await session.close()
    bytes = await fs.readFile(file)
  })

  afterEach(async () => {
    sinon.restore()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('keeps old transcripts compatible, persists Japanese titles across reopening and clears to preview', async () => {
    const old = (await repository.findById(id))!
    expect(old.title).to.be.undefined
    expect(old.titleRevision).equals(0)
    expect(sessionDisplayName(old)).equals('Original synthetic conversation')
    const input = {expectedRevision: 0, operationId: randomUUID(), title: '  日本語 の会話  '}
    const saved = await repository.rename(id, input)
    expect(saved).include({title: '日本語 の会話', titleRevision: 1})
    expect(await repository.rename(id, input)).deep.equals(saved)
    repository = new SessionRepository({rootDir: repository.rootDir})
    expect((await repository.listPage()).data[0]).deep.equals(saved)
    const opened = repository.open(file)
    expect(createSessionInformation(opened)).include({title: saved.title, titleRevision: 1})
    await opened.close()
    const cleared = await repository.rename(id, {expectedRevision: 1, operationId: randomUUID(), title: null})
    expect(cleared.title).to.be.undefined
    expect(sessionDisplayName(cleared)).equals(old.preview)
    expect(await fs.readFile(file)).deep.equals(bytes)
  })

  it('validates empty names, controls and length while accepting the boundary', async () => {
    for (const title of ['', '   ', 'bad\nname', 'x'.repeat(257)]) {
      // eslint-disable-next-line no-await-in-loop
      await rejects(repository.rename(id, {expectedRevision: 0, operationId: randomUUID(), title}), 'Invalid')
    }

    expect(await runSessionRenameCommand(id, 'x'.repeat(256), {}, repository)).property('titleRevision', 1)
    expect(await fs.readFile(file)).deep.equals(bytes)
  })

  it('rejects stale concurrent editors and changed replay inputs without changing newer data', async () => {
    const input = {expectedRevision: 0, operationId: randomUUID(), title: 'First'}
    await repository.rename(id, input)
    await rejects(repository.rename(id, {...input, title: 'Changed'}), 'input changed')
    const results = await Promise.allSettled(
      ['A', 'B'].map((title) =>
        repository.rename(id, {
          expectedRevision: 1,
          operationId: randomUUID(),
          title,
        }),
      ),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).length(1)
    expect((await repository.findById(id))!.titleRevision).equals(2)
    await rejects(repository.rename(id, input), 'revision changed')
  })

  it('recovers a retry after publication acknowledgement fails', async () => {
    const rename = fsSync.renameSync.bind(fsSync)
    const stub = sinon.stub(fsSync, 'renameSync').callsFake((source, destination) => {
      rename(source, destination)
      throw new Error('Synthetic acknowledgement failure')
    })
    const input = {expectedRevision: 0, operationId: randomUUID(), title: 'Durable'}
    await rejects(repository.rename(id, input), 'acknowledgement')
    stub.restore()
    expect(await repository.rename(id, input)).include({title: 'Durable', titleRevision: 1})
    expect(
      (await fs.readdir(path.join(repository.rootDir, '.coordination'))).filter((name) => name.endsWith('.tmp')),
    ).length(0)
  })

  it('refuses corrupt metadata and unsettled journal artifacts without touching the transcript', async () => {
    const journal = path.join(repository.journalRoot, id)
    await fs.mkdir(journal, {recursive: true})
    await fs.writeFile(path.join(journal, 'unknown'), 'Synthetic unsettled artifact')
    const input = {expectedRevision: 0, operationId: randomUUID(), title: 'Blocked'}
    await rejects(repository.rename(id, input), 'Unknown journal artifact')
    await fs.rm(journal, {recursive: true})
    await repository.rename(id, input)
    await fs.writeFile(path.join(repository.rootDir, '.coordination', id + '.title.json'), '{corrupt')
    await rejects(repository.rename(id, {...input, expectedRevision: 1, operationId: randomUUID()}), 'not found')
    expect(await fs.readFile(file)).deep.equals(bytes)
  })

  it('refuses open writers and deleted sessions and preserves archive metadata', async () => {
    const input = {expectedRevision: 0, operationId: randomUUID(), title: 'Archived title'}
    const opened = repository.open(file)
    await rejects(repository.rename(id, input), 'already open')
    await opened.close()
    await repository.setArchived(id, true)
    expect(await repository.rename(id, input)).property('archived', true)
    const deletion = new SessionDeletionService(repository, new MemorySessionLogStore())
    await deletion.delete(id)
    await deletion.delete(id)
    expect(repository.getTitle(id)).deep.equals({titleRevision: 0})
    await rejects(repository.rename(id, input), 'delet')
  })
})
