// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first. Exit 0 requires rejection after each interrupted registration.
// A timeout or wrong checkpoint is a fixture failure, never evidence of exclusion.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {SessionRepository} from '../../../../dist/core/index.js'

const moduleURL = new URL('../../../../dist/core/session/repository.js', import.meta.url).href
const conditions = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true}
const script = `
import fs from 'node:fs';
const {SessionRepository} = await import(process.env.ORBIT_TEST_MODULE);
const write = fs.writeFileSync.bind(fs);
const sync = fs.fsyncSync.bind(fs);
let bindings = 0;
fs.writeFileSync = (...args) => {
  const result = write(...args);
  if (typeof args[1] === 'string' && args[1].includes('"sessionRoot"')) {
    bindings++;
    if (bindings === 2 && process.env.ORBIT_TEST_MODE === 'death') process.exit(73);
  }
  return result;
};
fs.fsyncSync = fd => {
  if (bindings === 2 && process.env.ORBIT_TEST_MODE === 'sync-error') throw new Error('Injected binding sync failure');
  return sync(fd);
};
try {
  new SessionRepository({rootDir: process.env.ORBIT_TEST_ROOT}).initializeStorage(${JSON.stringify(conditions)});
} catch (error) {
  if (error.message !== 'Injected binding sync failure') throw error;
  process.exit(74);
}
throw new Error('Missing registration interruption');
`
let failures = 0
for (const mode of ['death', 'sync-error']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-registration-interruption-'))
  try {
    const storage = path.join(root, 'sessions')
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: {...process.env, ORBIT_TEST_MODE: mode, ORBIT_TEST_MODULE: moduleURL, ORBIT_TEST_ROOT: storage},
      timeout: 10_000,
    })
    assert.equal(child.error, undefined)
    assert.equal(child.status, mode === 'death' ? 73 : 74, child.stderr)
    const repository = new SessionRepository({rootDir: storage})
    let writableAdmission = 'rejected'
    try {
      const session = repository.create({id: 'before-offline-resume'})
      writableAdmission = 'accepted'
      // eslint-disable-next-line no-await-in-loop
      await session.close()
    } catch (error) {
      assert.match(String(error), /registration|initializ|incomplete/iu)
    }

    repository.initializeStorage(conditions)
    const resumed = repository.create({id: 'after-offline-resume'})
    // eslint-disable-next-line no-await-in-loop
    await resumed.close()
    console.log(JSON.stringify({childExit: child.status, mode, offlineResume: 'succeeded', writableAdmission}))
    if (writableAdmission !== 'rejected') failures++
  } finally {
    fs.rmSync(root, {force: true, recursive: true})
  }
}

process.exitCode = failures ? 1 : 0
