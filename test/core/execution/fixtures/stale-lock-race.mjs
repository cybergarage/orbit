// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Diagnostic probe, separate from the passing regression suite. Build first.
// Exit 1 means two simultaneous writers reproduced the unresolved stale-lock race.
/* eslint-disable no-await-in-loop */
import {execFileSync, spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {SessionRepository} from '../../../../dist/core/index.js'
const recorderModule = new URL('../../../../dist/core/session/recorder.js', import.meta.url).href
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-stale-race-'))
const repo = new SessionRepository({rootDir: root})
const session = repo.create({id: 'session'})
await session.close()
const {file} = await repo.findById('session')
const dead = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], {encoding: 'utf8'}))
await fs.writeFile(file + '.lock', JSON.stringify({pid: dead, token: 'stale-fixture'}))
const script = `import fs from 'node:fs';const {SessionRecorder} = await import(process.env.ORBIT_TEST_RECORDER);const read=fs.readFileSync.bind(fs);let paused=false;fs.readFileSync=(file,...args)=>{const value=read(file,...args);if(file===process.env.ORBIT_TEST_FILE+'.lock'&&!paused){paused=true;fs.writeFileSync(process.env.ORBIT_TEST_GATE+'.ready','');const end=Date.now()+10000;while(!fs.existsSync(process.env.ORBIT_TEST_GATE+'.go')){if(Date.now()>end)process.exit(75);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)}}return value};try{SessionRecorder.open(process.env.ORBIT_TEST_FILE);process.stdout.write('owned\\n');process.stdin.resume()}catch(e){process.stdout.write('rejected\\n');process.exit(0)}`
const children = []
async function waitFile(file) {
  for (let n = 0; n < 1000; n++) {
    if (await fs.stat(file).catch(() => null)) return
    await new Promise((r) => {
      setTimeout(r, 10)
    })
  }

  throw new Error('Barrier timeout')
}

try {
  for (const name of ['a', 'b']) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        ORBIT_TEST_FILE: file,
        ORBIT_TEST_GATE: path.join(root, name),
        ORBIT_TEST_RECORDER: recorderModule,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exit = once(child, 'exit')
    // Both readers must reach the barrier before either output is awaited.
    // eslint-disable-next-line unicorn/prefer-top-level-await
    const output = once(child.stdout, 'data').then(([d]) => String(d).trim())
    children.push({child, exit, output})
  }

  await Promise.all(['a', 'b'].map((n) => waitFile(path.join(root, n + '.ready'))))
  await fs.writeFile(path.join(root, 'a.go'), '')
  const first = await children[0].output
  await fs.writeFile(path.join(root, 'b.go'), '')
  const second = await children[1].output
  if (first === 'owned' && second === 'owned') process.exitCode = 1
  console.log(
    JSON.stringify({
      first,
      lock: JSON.parse(await fs.readFile(file + '.lock', 'utf8')).token !== 'stale-fixture',
      second,
      simultaneousLiveOwners: children.every(({child}) => child.exitCode === null),
    }),
  )
} finally {
  for (const {child, exit} of children) {
    if (child.exitCode === null) child.kill()
    await exit
  }

  await fs.rm(root, {force: true, recursive: true})
}
