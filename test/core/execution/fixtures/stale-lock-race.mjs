// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first. Pause one stale reclaimer inside its guard, then try two competitors.
// Exit 0 requires explicit rejection and successful recovery; timeout is a failure.
/* eslint-disable no-await-in-loop */
import {execFileSync, spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {coordinationPaths, SessionRepository} from '../../../../dist/core/index.js'
const moduleURL = new URL('../../../../dist/core/session/repository.js', import.meta.url).href
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-stale-race-'))
const repo = new SessionRepository({rootDir: root})
repo.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
const session = repo.create({id: 'session'})
await session.close()
const {file} = await repo.findById('session')
const paths = coordinationPaths(repo.scope('session'))
const dead = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], {encoding: 'utf8'}))
await fs.writeFile(paths.owner, JSON.stringify({pid: dead, token: 'stale-fixture', version: 1}))
const script = `
import fs from 'node:fs';
const {SessionRepository} = await import(process.env.ORBIT_TEST_MODULE);
const repo = new SessionRepository({rootDir: process.env.ORBIT_TEST_ROOT});
const read = fs.readFileSync.bind(fs); let paused = false;
fs.readFileSync = (file, ...args) => {
  const value = read(file, ...args);
  if (file === process.env.ORBIT_TEST_OWNER && process.env.ORBIT_TEST_PAUSE === 'yes' && !paused) {
    paused = true; fs.writeFileSync(process.env.ORBIT_TEST_GATE + '.ready', '');
    const end = Date.now() + 10000;
    while (!fs.existsSync(process.env.ORBIT_TEST_GATE + '.go')) {
      if (Date.now() > end) process.exit(75);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return value;
};
try {repo.open(process.env.ORBIT_TEST_FILE); process.stdout.write('owned\\n'); process.stdin.resume()}
catch (error) {process.stdout.write('rejected:' + error.message + '\\n'); process.exit(0)}
`
const children = []
function launch(pause = false) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      ORBIT_TEST_FILE: file,
      ORBIT_TEST_GATE: path.join(root, 'a'),
      ORBIT_TEST_MODULE: moduleURL,
      ORBIT_TEST_OWNER: paths.owner,
      ORBIT_TEST_PAUSE: pause ? 'yes' : 'no',
      ORBIT_TEST_ROOT: repo.rootDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exit = once(child, 'exit')
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += d
  })
  const output = Promise.race([
    once(child.stdout, 'data').then(([d]) => String(d).trim()),
    exit.then(([code]) => {
      if (code !== 0) throw new Error(`Child exit ${code}: ${stderr}`)
      return 'no-output'
    }),
  ])
  const record = {child, exit, output}
  children.push(record)
  return record
}

async function waitReady() {
  for (let i = 0; i < 1000; i++) {
    if (await fs.stat(path.join(root, 'a.ready')).catch(() => null)) return
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }

  throw new Error('Guard barrier timeout')
}

try {
  const first = launch(true)
  await waitReady()
  const second = await launch().output
  if (!second.includes('guard busy')) throw new Error(`Missing guard refusal: ${second}`)
  await fs.writeFile(path.join(root, 'a.go'), '')
  if ((await first.output) !== 'owned') throw new Error('First writer not admitted')
  const token = await fs.readFile(paths.owner, 'utf8')
  const third = await launch().output
  if (!third.includes('already open') || (await fs.readFile(paths.owner, 'utf8')) !== token)
    throw new Error(`Live owner not protected: ${third}`)
  first.child.kill()
  await first.exit
  const recovered = repo.open(file)
  await recovered.close()
  console.log(
    JSON.stringify({
      first: 'owned',
      recoveredAfterExit: true,
      second: 'guard-rejected',
      simultaneousLiveOwners: false,
      third: 'owner-rejected',
    }),
  )
} finally {
  for (const {child, exit} of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exit
  }

  await fs.rm(root, {force: true, recursive: true})
}
