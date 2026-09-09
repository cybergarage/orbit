// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-process-exit, unicorn/no-process-exit -- Intentional child death is the behavior under test. */

// Exact append/sync boundary assertions; process timeout is never a passing result.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {Message, MessageType, sessionFilePath, SessionRepository} from '../../../../dist/core/index.js'
import {persistedContextMessage, sourceDigest} from '../../../../dist/core/session/compaction.js'
const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true}
if (process.argv[2] === 'child') {
  const root = process.argv[3]
  const stop = process.argv[4]
  const repository = new SessionRepository({rootDir: root})
  repository.initializeStorage(offline)
  const session = repository.create({createdAt: '2026-09-09T00:00:00Z', cwd: root, formatVersion: 2, id: 'fixture'})
  const messages = session.appendMessages([
    new Message(MessageType.User, {content: 'old task'}),
    new Message(MessageType.Assistant, {content: 'test failed'}),
    new Message(MessageType.User, {content: 'continue'}),
  ])
  await session.flush()
  const release = session.acquireManagedLease()
  const candidate = {
    afterTokens: 50,
    beforeTokens: 100,
    digestVersion: 'sha256-json-v1',
    estimatorRevision: 'fixture',
    firstRetainedId: messages[2].id,
    id: 'checkpoint-1',
    model: 'fixture',
    prefixEndId: messages[1].id,
    previousId: null,
    profileRevision: 'fixture',
    projectionVersion: 1,
    provider: 'ollama',
    sessionId: 'fixture',
    sourceDigest: sourceDigest(messages.slice(0, 2).map((value) => persistedContextMessage(value))),
    sourceHeadId: messages[2].id,
    summary: {
      changedPaths: [],
      facts: [],
      goals: [{sourceIds: [messages[0].id], text: 'Fix test'}],
      tests: [],
      uncertainties: [],
      unfinished: [],
      version: 1,
    },
    timestamp: '2026-09-09T00:00:00Z',
    type: 'compaction',
  }
  let step = 0
  const tick = () => {
    step++
    if (String(step) === stop) {
      process.stdout.write(JSON.stringify({step}) + '\n')
      process.exit(87)
    }
  }

  const append = fsp.appendFile.bind(fsp)
  fsp.appendFile = async (...args) => {
    tick()
    const result = await append(...args)
    tick()
    return result
  }

  const open = fsp.open.bind(fsp)
  fsp.open = async (...args) => {
    const handle = await open(...args)
    const sync = handle.sync.bind(handle)
    handle.sync = async () => {
      tick()
      if (stop === 'sync-error') throw new Error('Injected checkpoint sync failure')
      await sync()
      tick()
    }

    return handle
  }

  try {
    await session.commitCompaction(candidate, 'file-and-directory-sync')
  } catch {
    assert.equal(stop, 'sync-error')
    assert.equal(session.getCompaction(), undefined)
    release()
    await session.close().catch(() => {})
    console.log(JSON.stringify({active: false, rejected: true}))
    process.exit(0)
  }

  assert.ok(session.getCompaction())
  release()
  await session.close()
  console.log(JSON.stringify({steps: step}))
} else {
  const run = async (stop) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-checkpoint-fault-')))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', root, String(stop)], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.equal(child.error, undefined)
    assert.equal(child.signal, null)
    assert.equal(child.status, typeof stop === 'number' && stop > 0 ? 87 : 0, child.stderr)
    const result = JSON.parse(child.stdout.trim())
    if (typeof stop === 'number' && stop > 0) assert.equal(result.step, stop)
    const repository = new SessionRepository({rootDir: root})
    const file = sessionFilePath(root, 'fixture', '2026-09-09T00:00:00Z')
    const session = repository.open(file)
    assert.equal(Boolean(session.getCompaction()), stop !== 1)
    assert.equal(session.getConversationMessages().length, 3)
    await session.close()
    fs.rmSync(root, {force: true, recursive: true})
    return result
  }

  const baseline = await run(0)
  for (let stop = 1; stop <= baseline.steps; stop++) {
    // Each isolated recovery must finish before testing the next interruption.
    // eslint-disable-next-line no-await-in-loop
    await run(stop)
  }

  await run('sync-error')
  console.log(JSON.stringify({passed: baseline.steps + 1}))
}
