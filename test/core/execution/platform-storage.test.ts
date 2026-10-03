// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {stub} from 'sinon'

import {assertSupportedSyncLevel, defaultFileSyncLevel} from '../../../src/core/session/durability.js'
import {offlineStorage, openTestJournal, SessionRepository} from '../../session-storage-fixture.js'

describe('platform storage acknowledgements', () => {
  it('selects truthful defaults and rejects an explicit unsupported guarantee', () => {
    expect(defaultFileSyncLevel('win32')).equal('file-sync')
    for (const platform of ['darwin', 'linux'] as const) {
      expect(defaultFileSyncLevel(platform)).equal('file-and-directory-sync')
      expect(() => assertSupportedSyncLevel('file-and-directory-sync', platform)).not.to.throw()
    }

    expect(() => assertSupportedSyncLevel('file-and-directory-sync', 'win32')).throws('unsupported on Windows')
    expect(() => assertSupportedSyncLevel('file-sync', 'win32')).not.to.throw()
  })

  it('records the default level and releases journal ownership after close', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-platform-storage-'))
    try {
      const journal = await openTestJournal('session', {root})
      try {
        expect(journal.level).equal(defaultFileSyncLevel())
        const record = await journal.append('run', 'run-admitted', {level: journal.level})
        expect(record.data.level).equal(defaultFileSyncLevel())
      } finally {
        await journal.close()
      }

      const reopened = await openTestJournal('session', {root})
      await reopened.close()
    } finally {
      fs.rmSync(root, {force: true, recursive: true})
    }
  })

  it('never downgrades a requested directory guarantee or leaks the delegated lease', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-platform-storage-'))
    let released = 0
    try {
      let journal: Awaited<ReturnType<typeof openTestJournal>> | undefined
      let error: unknown
      try {
        journal = await openTestJournal('session', {
          level: 'file-and-directory-sync',
          releaseLease() {
            released++
          },
          root,
        })
      } catch (error_) {
        error = error_
      }

      if (process.platform === 'win32') {
        expect(String(error)).contains('unsupported on Windows')
        expect(fs.existsSync(path.join(root, 'session'))).equal(false)
        expect(released).equal(1)
      } else {
        expect(error).equal(undefined)
        expect(journal!.level).equal('file-and-directory-sync')
        await journal!.close()
        expect(released).equal(1)
      }

      const retry = await openTestJournal('session', {root})
      await retry.close()
    } finally {
      fs.rmSync(root, {force: true, recursive: true})
    }
  })

  it('flushes existing registration files through writable handles without ignoring file failures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-platform-storage-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const descriptors = new Map<number, {file: string; flags: number | string}>()
    const originalOpen = fs.openSync.bind(fs)
    const originalSync = fs.fsyncSync.bind(fs)
    const open = stub(fs, 'openSync').callsFake(((...args: Parameters<typeof fs.openSync>) => {
      const descriptor = originalOpen(...args)
      descriptors.set(descriptor, {file: String(args[0]), flags: args[1]})
      return descriptor
    }) as typeof fs.openSync)
    let synced = 0
    const sync = stub(fs, 'fsyncSync').callsFake((descriptor) => {
      const value = descriptors.get(descriptor)!
      if (value.file.endsWith('.orbit-session-binding.json')) {
        // eslint-disable-next-line no-bitwise -- validate writable access used by FlushFileBuffers
        expect(Number(value.flags) & fs.constants.O_RDWR).equal(fs.constants.O_RDWR)
        synced++
        throw new Error('required file flush failed')
      }

      if (process.platform === 'win32') expect(fs.fstatSync(descriptor).isDirectory()).equal(false)
      originalSync(descriptor)
    })
    try {
      expect(() => repository.initializeStorage(offlineStorage)).throws()
    } finally {
      open.restore()
      sync.restore()
      fs.rmSync(root, {force: true, recursive: true})
    }

    expect(synced).greaterThan(0)
  })
})
