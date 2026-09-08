// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stub} from 'sinon'

import StorageCommand from '../../../src/apps/cli/storage.js'
import {SessionRepository} from '../../../src/core/index.js'

const project = fileURLToPath(new URL('../../../', import.meta.url))
describe('storage command', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-storage-cli-'))
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  it('inspects absent storage without creating it or requiring offline declarations', async () => {
    const log = stub(StorageCommand.prototype, 'log')
    const sessionRoot = path.join(root, 'sessions')
    try {
      await StorageCommand.run(['inspect', '--session-root', sessionRoot], project)
      expect(JSON.parse(log.firstCall.args[0]!).state).equal('unregistered')
      expect(fs.existsSync(sessionRoot)).equal(false)
    } finally {
      log.restore()
    }
  })

  it('requires offline conditions and explicit digest review for torn metadata', async () => {
    const log = stub(StorageCommand.prototype, 'log')
    const sessionRoot = path.join(root, 'sessions');
      const roots = ['--session-root', sessionRoot]
    const conditions = ['--writers-stopped', '--restarters-disabled', '--exclusive-storage-control']
    try {
      await StorageCommand.run(['initialize', ...roots], project).then(
        () => {
          throw new Error('Unconfirmed maintenance accepted')
        },
        (error) => expect(String(error)).contains('All three confirmations'),
      )
      await StorageCommand.run(['initialize', ...roots, ...conditions], project)
      const repository = new SessionRepository({rootDir: sessionRoot})
      const file = path.join(repository.rootDir, '.orbit-registration.guard')
      fs.writeFileSync(file, 'torn')
      await StorageCommand.run(['resume', ...roots, ...conditions], project).then(
        () => {
          throw new Error('Unreviewed repair accepted')
        },
        (error) => expect(String(error)).contains('digest review'),
      )
      const sha = repository.inspectStorage().artifacts.find((a) => a.file === file)!.sha256!
      const reviewFile = path.join(root, 'review.json')
      fs.writeFileSync(reviewFile, JSON.stringify({[file]: sha}))
      await StorageCommand.run(['resume', ...roots, ...conditions, '--reviewed-artifacts', reviewFile], project)
      expect(repository.inspectStorage().state).equal('ready')
    } finally {
      log.restore()
    }
  })
})
