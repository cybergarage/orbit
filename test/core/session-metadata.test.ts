// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {readSessionArchive, writeSessionArchive} from '../../src/core/session/archive.js'
import {readModelSelection, writeModelSelection} from '../../src/core/session/model-selection.js'
import {readSessionTitle, writeSessionTitle} from '../../src/core/session/title.js'
import {SessionRepository} from '../session-storage-fixture.js'

describe('Additive session metadata', () => {
  let root: string
  let repository: SessionRepository
  const id = 'synthetic-session'
  const extension = {nested: [false, null, {approved: false}], unknownStatus: 'unknown'}
  const selection = {model: 'synthetic-model', provider: 'openai'}
  let operationId: string
  const file = (suffix: string) => path.join(root, '.coordination', `${id}.${suffix}.json`)
  const save = (suffix: string, value: unknown) => fs.writeFileSync(file(suffix), JSON.stringify(value))
  const load = (suffix: string) => JSON.parse(fs.readFileSync(file(suffix), 'utf8'))
  const title = () => ({expectedRevision: 0, operationId, revision: 1, sessionId: id, title: 'Synthetic'})

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-metadata-')))
    repository = new SessionRepository({rootDir: root})
    fs.mkdirSync(path.join(root, '.coordination'), {recursive: true})
    operationId = randomUUID()
  })

  afterEach(() => fs.rmSync(root, {force: true, recursive: true}))

  for (const tag of [undefined, 1]) {
    it(`reads current fields with tag ${String(tag)} and preserves extensions when updating`, async () => {
      const common = {extension, sessionId: id, ...(tag === undefined ? {} : {version: tag})}
      save('archive', {...common, archived: true})
      save('model', {...common, selection: {...selection, future: extension}})
      save('title', {...common, ...title()})
      expect(readSessionArchive(root, id)).equals(true)
      expect(readModelSelection(root, id)).deep.equals(selection)
      expect(readSessionTitle(root, id)).deep.equals({title: 'Synthetic', titleRevision: 1})
      const scope = repository.scope(id)
      await writeSessionArchive(scope, false)
      writeModelSelection(scope, {...selection, model: 'next-model'})
      const input = {expectedRevision: 1, operationId: randomUUID(), title: 'Next'}
      writeSessionTitle(scope, input)
      expect(writeSessionTitle(scope, input)).deep.equals({title: 'Next', titleRevision: 2})
      for (const suffix of ['archive', 'model', 'title']) {
        expect(load(suffix)).not.have.property('version')
        expect(load(suffix).extension).deep.equals(extension)
      }

      expect(load('model').selection.future).deep.equals(extension)
      expect(() => writeSessionTitle(scope, {...input, title: 'Changed'})).throws('input changed')
      expect(() => writeSessionTitle(scope, {...input, operationId: randomUUID()})).throws('revision changed')
    })
  }

  it('uses defaults only for absent records', () => {
    expect(readSessionArchive(root, id)).equals(false)
    expect(readModelSelection(root, id)).to.be.undefined
    expect(readSessionTitle(root, id)).deep.equals({titleRevision: 0})
    for (const bad of [null, [], {}, {version: 2}, {version: '1'}]) {
      for (const suffix of ['archive', 'model', 'title']) save(suffix, bad)
      expect(() => readSessionArchive(root, id)).throws()
      expect(() => readModelSelection(root, id)).throws()
      expect(() => readSessionTitle(root, id)).throws()
    }
  })

  it('rejects wrong identities, invalid known fields and unknown explicit tags', () => {
    for (const patch of [{sessionId: 'other'}, {version: 2}, {version: null}]) {
      save('archive', {archived: false, sessionId: id, ...patch})
      save('model', {selection, sessionId: id, ...patch})
      save('title', {...title(), ...patch})
      expect(() => readSessionArchive(root, id)).throws()
      expect(() => readModelSelection(root, id)).throws()
      expect(() => readSessionTitle(root, id)).throws()
    }

    save('archive', {archived: 'false', sessionId: id})
    save('model', {selection: {...selection, provider: ''}, sessionId: id})
    save('title', {...title(), revision: 3})
    expect(() => readSessionArchive(root, id)).throws()
    expect(() => readModelSelection(root, id)).throws()
    expect(() => readSessionTitle(root, id)).throws()
  })

  it('rejects oversized updates while retaining original bytes and strict mutation inputs', async () => {
    const scope = repository.scope(id)
    const value = {archived: false, padding: '', sessionId: id}
    value.padding = 'x'.repeat(4096 - Buffer.byteLength(JSON.stringify(value)))
    save('archive', value)
    const before = fs.readFileSync(file('archive'))
    try {
      await writeSessionArchive(scope, false)
    } catch (error) {
      expect(String(error)).contains('4 KiB')
      expect(fs.readFileSync(file('archive'))).deep.equals(before)
      expect(() => writeModelSelection(scope, {...selection, extra: true} as typeof selection)).throws()
      return
    }

    throw new Error('Expected size rejection')
  })
})
