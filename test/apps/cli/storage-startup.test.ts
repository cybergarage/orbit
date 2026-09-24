// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {runInteractiveCommand} from '../../../src/apps/cli/_interactive.js'
import {runGuiCommand} from '../../../src/apps/cli/gui.js'
import {ensureStartupStorage} from '../../../src/apps/storage-startup.js'
import {SessionRepository} from '../../../src/core/session/index.js'

async function failure(operation: Promise<void>): Promise<string> {
  try {
    await operation
  } catch (error) {
    return (error as Error).message
  }

  throw new Error('Expected startup to fail')
}

describe('storage startup', () => {
  let directory: string
  let repository: SessionRepository

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-startup-'))
    repository = new SessionRepository({rootDir: path.join(directory, 'sessions')})
  })

  afterEach(() => fs.rmSync(directory, {force: true, recursive: true}))

  it('creates a registered pair only after explicit confirmation and skips ready storage', async () => {
    let prompts = 0
    const options = {
      async confirm(message: string) {
        prompts++
        expect(message).to.include(repository.rootDir).and.include(repository.journalRoot)
        expect(message).to.include('stop all other Orbit writers').and.include('automatic restarters')
        expect(message).to.include('exclusive administrative control').and.include('(y/N)')
        return true
      },
      interactive: true,
    }
    await ensureStartupStorage(repository, options)
    expect(repository.inspectStorage().state).to.equal('ready')
    await ensureStartupStorage(repository, options)
    expect(prompts).to.equal(1)
  })

  it('leaves missing storage untouched when declined', async () => {
    expect(await failure(ensureStartupStorage(repository, {confirm: async () => false, interactive: true}))).to.include(
      'cancelled',
    )
    expect(fs.existsSync(repository.rootDir)).to.equal(false)
  })

  it('does not prompt or write without a terminal', async () => {
    expect(
      await failure(
        ensureStartupStorage(repository, {
          async confirm() {
            throw new Error('Unexpected prompt')
          },
          interactive: false,
        }),
      ),
    ).to.include('orbit storage initialize')
    expect(fs.existsSync(repository.rootDir)).to.equal(false)
  })

  for (const artifact of ['.orbit-registration.guard', '.orbit-session-binding.json']) {
    it(`preserves ${artifact} and directs incomplete storage to offline recovery`, async () => {
      fs.mkdirSync(repository.rootDir)
      const file = path.join(repository.rootDir, artifact)
      fs.writeFileSync(file, '{}')
      expect(
        await failure(
          ensureStartupStorage(repository, {
            async confirm() {
              throw new Error('Unexpected prompt')
            },
            interactive: true,
          }),
        ),
      ).to.include('orbit storage resume')
      expect(fs.readFileSync(file, 'utf8')).to.equal('{}')
      expect(fs.existsSync(repository.journalRoot)).to.equal(false)
    })
  }

  it('propagates initializer failures without continuing startup', async () => {
    repository.initializeStorage = () => {
      throw new Error('Initialization failed')
    }

    expect(await failure(ensureStartupStorage(repository, {confirm: async () => true, interactive: true}))).to.equal(
      'Initialization failed',
    )
  })

  it('checks GUI storage before resolving models or opening the server', async () => {
    expect(
      await failure(
        runGuiCommand(
          {},
          {
            async storagePreflight() {
              throw new Error('Storage blocked')
            },
          },
        ),
      ),
    ).to.equal('Storage blocked')
  })

  it('checks interactive storage before resolving models or starting the session', async () => {
    const stdin = process.stdin.isTTY
    const stdout = process.stdout.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: true})
    Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true})
    try {
      expect(
        await failure(
          runInteractiveCommand(
            {},
            async () => {
              throw new Error('Unexpected session')
            },
            {
              async storagePreflight() {
                throw new Error('Storage blocked')
              },
            },
          ),
        ),
      ).to.equal('Storage blocked')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: stdin})
      Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: stdout})
    }
  })
})
