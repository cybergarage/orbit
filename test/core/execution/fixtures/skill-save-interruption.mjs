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

import {Message, MessageType, sessionFilePath, SessionRepository, SkillCatalog} from '../../../../dist/core/index.js'
const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true}
if (process.argv[2] === 'child') {
  const root = process.argv[3]
  const stop = process.argv[4]
  const repository = new SessionRepository({rootDir: root})
  repository.initializeStorage(offline)
  const session = repository.create({createdAt: '2026-09-09T00:00:00Z', cwd: root, formatVersion: 2, id: 'fixture'})
  const skillRoot = path.join(root, 'selected-instructions')
  fs.mkdirSync(path.join(skillRoot, 'review'), {recursive: true})
  fs.writeFileSync(path.join(skillRoot, 'review', 'SKILL.md'), '\uFEFF---\r\nname: review\r\ndescription: Isolated storage fixture\r\n---\r\nReview tests.\r\n')
  const catalog = new SkillCatalog([{directory: skillRoot, id: 'fixture'}])
  const skills = await catalog.resolve((await catalog.list()).candidates)
  session.recordTurnContext({cwd: root, maxToolIterations: 1, model: 'fixture', provider: 'ollama', turnId: 'run-1'})
  session.recordTurnEvent({phase: 'started', turnId: 'run-1'})
  session.appendMessages([new Message(MessageType.User, {content: 'Inspect'})], {turnId: 'run-1'})
  await session.flush()
  const release = session.acquireManagedLease()
  const candidate = {id: 'skill-1', sessionId: 'fixture', skills, timestamp: '2026-09-09T00:00:00Z', turnId: 'run-1', type: 'skill_context', version: 1}
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
      if (stop === 'sync-error') throw new Error('Injected Skill sync failure')
      await sync()
      tick()
    }

    return handle
  }

  try {
    await session.commitSkills(candidate, 'file-and-directory-sync')
  } catch {
    assert.equal(stop, 'sync-error')
    assert.equal(session.getSkillContexts().length, 1)
    release()
    await session.close().catch(() => {})
    console.log(JSON.stringify({active: false, rejected: true}))
    process.exit(0)
  }

  assert.equal(session.getSkillContexts().length, 1)
  release()
  await session.close()
  console.log(JSON.stringify({steps: step}))
} else {
  const run = async (stop) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-skill-fault-')))
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
    assert.equal(session.getSkillContexts().length > 0, stop !== 1)
    assert.equal(session.getConversationMessages().length, 1)
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
