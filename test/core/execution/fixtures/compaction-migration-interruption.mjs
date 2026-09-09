// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-process-exit, unicorn/no-process-exit -- Intentional child death is the behavior under test. */

// Build first. Each injected exit must reach the exact boundary; timeout is failure.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {
  migrateSessionTranscript,
  recoverSessionWriter,
  sessionFilePath,
  SessionRecorder,
  SessionRepository,
} from '../../../../dist/core/index.js'
import {coordinationPaths, migrationIntentPath} from '../../../../dist/core/session/coordination.js'

const conditions = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true}
if (process.argv[2] === 'child') {
  const root = process.argv[3]
  const stop = Number(process.argv[4])
  const repository = new SessionRepository({rootDir: root})
  repository.initializeStorage(conditions)
  const session = repository.create({createdAt: '2026-09-09T00:00:00Z', cwd: root, id: 'fixture'})
  const file = session.getFile()
  await session.close()
  const scope = repository.scope('fixture')
  const descriptors = new Map()
  const open = fs.openSync.bind(fs)
  const close = fs.closeSync.bind(fs)
  fs.openSync = (...args) => {
    const fd = open(...args)
    descriptors.set(fd, String(args[0]))
    return fd
  }

  fs.closeSync = (fd) => {
    descriptors.delete(fd)
    return close(fd)
  }

  let step = 0
  const trace = []
  const tick = (method, phase, file) => {
    step++
    trace.push({file: path.relative(root, file), method, phase})
    if (step === stop) {
      process.stdout.write(JSON.stringify({method, phase, step}) + '\n')
      process.exit(86)
    }
  }

  for (const method of ['writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync']) {
    const original = fs[method].bind(fs)
    fs[method] = (...args) => {
      const target = typeof args[0] === 'number' ? descriptors.get(args[0]) : String(args[0])
      if (!target?.startsWith(root)) return original(...args)
      tick(method, 'before', target)
      const value = original(...args)
      tick(method, 'after', target)
      return value
    }
  }

  migrateSessionTranscript(scope, file, conditions)
  process.stdout.write(JSON.stringify({steps: step, trace}) + '\n')
} else {
  const run = (stop) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-migration-fault-')))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', root, String(stop)], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.equal(child.error, undefined)
    assert.equal(child.signal, null)
    assert.equal(child.status, stop ? 86 : 0, child.stderr)
    const output = JSON.parse(child.stdout.trim())
    if (stop) assert.equal(output.step, stop)
    const repository = new SessionRepository({rootDir: root})
    const scope = repository.scope('fixture')
    const file = sessionFilePath(root, 'fixture', '2026-09-09T00:00:00Z')
    const files = coordinationPaths(scope)
    const intent = migrationIntentPath(scope)
    if (fs.existsSync(files.guard) || fs.existsSync(intent)) {
      assert.equal(SessionRecorder.isOpen(file), true)
      assert.throws(() => repository.open(file))
      if (fs.existsSync(intent)) {
        assert.throws(() => recoverSessionWriter(scope, conditions), /migration-aware/)
        migrateSessionTranscript(scope, file, conditions, true)
      } else {
        recoverSessionWriter(scope, conditions)
        const header = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0])
        if (header.version === 1) migrateSessionTranscript(scope, file, conditions)
      }
    }

    const reopened = repository.open(file)
    assert.ok([1, 2].includes(reopened.formatVersion))
    return reopened.close().then(() => {
      fs.rmSync(root, {force: true, recursive: true})
      return output
    })
  }

  const baseline = await run(0)
  for (let stop = 1; stop <= baseline.steps; stop++) {
    // Each isolated recovery must finish before testing the next interruption.
    // eslint-disable-next-line no-await-in-loop
    await run(stop)
  }

  console.log(JSON.stringify({boundaries: baseline.trace, passed: baseline.steps}))
}
