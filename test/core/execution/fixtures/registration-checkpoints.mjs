// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-process-exit, unicorn/no-process-exit, no-await-in-loop -- exact subprocess death and sequential fault checkpoints are the test contract */

// Build first. Each checkpoint is an exact filesystem call boundary in an isolated
// subprocess. This exercises process death/I/O errors, not physical power loss.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import {SessionRepository} from '../../../../dist/core/session/repository.js'

const conditions = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true}
const self = fileURLToPath(import.meta.url)
const guard = '.orbit-registration.guard'
const binding = '.orbit-session-binding.json'
const scenarios = [
  'fresh-nested',
  'legacy-disjoint',
  'repeat-disjoint',
  'resume-nested',
  'resume-ready-disjoint',
  'repair-torn-nested',
  'repair-stage-nested',
]
const childMode = process.argv[2] === 'child'
if (childMode) {
  const root = fs.realpathSync(process.env.ORBIT_TEST_ROOT)
  const scenario = process.env.ORBIT_TEST_SCENARIO
  const repository = new SessionRepository({
    rootDir: path.join(root, 'new', 'deep', 'sessions'),
    ...(scenario.endsWith('disjoint') ? {journalRoot: path.join(root, 'journals')} : {}),
  })
  const roots = [repository.rootDir, repository.journalRoot]
  if (scenario.startsWith('legacy')) {
    for (const dir of roots) {
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(
        path.join(dir, binding),
        JSON.stringify({journalRoot: roots[1], sessionRoot: roots[0], version: 1}),
      )
    }
  } else if (!scenario.startsWith('fresh')) {
    repository.initializeStorage(conditions)
    if (scenario === 'resume-nested')
      fs.writeFileSync(
        path.join(roots[0], guard),
        JSON.stringify({
          attemptId: '11111111-1111-4111-8111-111111111111',
          journalRoot: roots[1],
          pairId: repository.scope('probe').pairId,
          sessionRoot: roots[0],
          version: 1,
        }),
      )
  }

  if (scenario === 'repair-torn-nested') fs.writeFileSync(path.join(roots[0], guard), '{torn')
  if (scenario === 'repair-stage-nested')
    fs.writeFileSync(path.join(roots[1], '.orbit-binding-interrupted.tmp'), 'partial staged data')
  const reviewedArtifacts = Object.fromEntries(
    repository
      .inspectStorage()
      .artifacts.filter((a) => a.sha256)
      .map((a) => [a.file, a.sha256]),
  )
  const events = []
  let injected = false
  const fds = new Map()
  let ready = scenario.startsWith('repeat') || scenario === 'resume-ready-disjoint'
  const target = Number(process.env.ORBIT_TEST_CHECKPOINT ?? -1)
  const fault = process.env.ORBIT_TEST_FAULT
  const emit = (value) => fs.writeSync(1, JSON.stringify(value) + '\n')
  const checkpoint = (label) => {
    events.push({label, ready})
    if (events.length - 1 !== target) return
    emit({checkpoint: target, label, ready})
    if (fault === 'death') process.exit(73)
    injected = true
    const error = new Error('Injected registration checkpoint')
    error.code = 'ORBIT_INJECTED'
    throw error
  }

  for (const name of [
    'openSync',
    'readFileSync',
    'writeFileSync',
    'fsyncSync',
    'ftruncateSync',
    'closeSync',
    'renameSync',
    'unlinkSync',
    'mkdirSync',
  ]) {
    const original = fs[name].bind(fs)
    fs[name] = (...args) => {
      const file = typeof args[0] === 'number' ? fds.get(args[0]) : String(args[0])
      if (!file || !file.startsWith(root + path.sep)) return original(...args)
      const label =
        name + ':' + file.replace(root, '<root>').replaceAll(/\.orbit-binding-[^/]+/gu, '.orbit-binding-stage.tmp')
      checkpoint('before:' + label)
      const result = original(...args)
      if (name === 'openSync') {
        fds.set(result, file)
        if (file === path.join(roots[0], guard) && args[1] === 'wx') ready = false
      }

      if (name === 'closeSync') fds.delete(args[0])
      if (name === 'unlinkSync' && file === path.join(roots[0], guard)) ready = true
      checkpoint('after:' + label)
      return result
    }
  }

  try {
    if (scenario.startsWith('resume') || scenario.startsWith('repair'))
      repository.resumeStorage(conditions, {reviewedArtifacts})
    else repository.initializeStorage(conditions)
    if (injected) process.exit(75) // A swallowed I/O error is not a successful fault test.
    checkpoint('before:success-response')
    emit({events})
  } catch (error) {
    if (!injected) throw error
    process.exit(74)
  }
} else {
  let total = 0
  for (const scenario of scenarios.filter(
    (scenario) => !process.env.ORBIT_TEST_SCENARIOS || process.env.ORBIT_TEST_SCENARIOS.split(',').includes(scenario),
  )) {
    const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-registration-control-'))
    const spawn = async (root, checkpoint, fault) => {
      try {
        return {
          ...(await promisify(execFile)(process.execPath, [self, 'child'], {
            encoding: 'utf8',
            env: {
              ...process.env,
              ORBIT_TEST_CHECKPOINT: String(checkpoint),
              ORBIT_TEST_FAULT: fault,
              ORBIT_TEST_ROOT: root,
              ORBIT_TEST_SCENARIO: scenario,
            },
            timeout: 10_000,
          })),
          status: 0,
        }
      } catch (error) {
        return {
          error: typeof error.code === 'number' && !error.killed ? undefined : error,
          status: error.code,
          stderr: error.stderr,
          stdout: error.stdout,
        }
      }
    }

    const control = await spawn(controlRoot, -1, 'none')
    assert.equal(control.error, undefined)
    assert.equal(control.status, 0, control.stderr)
    const {events} = JSON.parse(control.stdout.trim())
    fs.rmSync(controlRoot, {force: true, recursive: true})
    const pending = ['death', 'error'].flatMap((fault) =>
      events.map((expected, checkpoint) => ({checkpoint, expected, fault})),
    )
    const worker = async () => {
      while (pending.length > 0) {
        const {checkpoint, expected, fault} = pending.shift()
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-registration-checkpoint-'))
        try {
          const child = await spawn(root, checkpoint, fault)
          assert.equal(child.error, undefined)
          assert.equal(child.status, fault === 'death' ? 73 : 74, `${scenario}/${checkpoint}/${fault}: ${child.stderr}`)
          const actual = JSON.parse(child.stdout.trim())
          assert.deepEqual(actual, {checkpoint, ...expected})
          const repository = new SessionRepository({
            rootDir: path.join(root, 'new', 'deep', 'sessions'),
            ...(scenario.endsWith('disjoint') ? {journalRoot: path.join(root, 'journals')} : {}),
          })
          let admitted = false
          try {
            const session = repository.create({id: 'probe'})
            admitted = true
            await session.close()
          } catch (error) {
            assert.match(String(error), /unregistered|incomplete|conflicting/u)
          }

          assert.equal(admitted, expected.ready, `${scenario}/${checkpoint}/${fault}/${expected.label}`)
          // The parent controls these private roots and independently inspects the
          // exact artifacts produced by its known interrupted invocation.
          const inspection = repository.inspectStorage()
          const reviewedArtifacts = Object.fromEntries(
            inspection.artifacts.filter((a) => a.sha256).map((a) => [a.file, a.sha256]),
          )
          repository.resumeStorage(conditions, {reviewedArtifacts})
          assert.equal(repository.inspectStorage().state, 'ready')
          const session = repository.create({id: 'resumed'})
          await session.close()
          total++
        } finally {
          fs.rmSync(root, {force: true, recursive: true})
        }
      }
    }

    await Promise.all(Array.from({length: 4}, () => worker()))
    console.log(JSON.stringify({checkpoints: events.length, faultCases: events.length * 2, scenario, timeouts: 0}))
  }

  console.log(JSON.stringify({faultCases: total, physicalPowerLoss: 'not-tested', result: 'passed'}))
}
