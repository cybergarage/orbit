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
let bindings = 0; const files = new Map(); const open = fs.openSync.bind(fs);
fs.openSync = (...args) => {const fd = open(...args); files.set(fd, String(args[0])); return fd};
fs.writeFileSync = (...args) => {
  const result = write(...args);
  if (files.get(args[0])?.endsWith('.orbit-session-binding.json')) {
    bindings++;
    if (bindings === 2 && process.env.ORBIT_TEST_MODE === 'death') process.exit(73);
  }
  return result;
};
fs.fsyncSync = fd => {
  if (bindings === 2 && files.get(fd)?.endsWith('.orbit-session-binding.json') && process.env.ORBIT_TEST_MODE === 'sync-error') throw new Error('Injected binding sync failure');
  return sync(fd);
};
try {
  new SessionRepository({rootDir: process.env.ORBIT_TEST_ROOT, journalRoot: process.env.ORBIT_TEST_JOURNAL}).initializeStorage(${JSON.stringify(conditions)});
} catch (error) {
  if (error.message !== 'Injected binding sync failure') throw error;
  process.exit(74);
}
throw new Error('Missing registration interruption');
`
let failures = 0
for (const mode of ['death', 'sync-error']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-registration-interruption-'))
  const journalRoot = process.env.ORBIT_TEST_JOURNAL_PARENT
    ? fs.mkdtempSync(path.join(process.env.ORBIT_TEST_JOURNAL_PARENT, 'orbit-registration-journal-'))
    : undefined
  try {
    const storage = path.join(root, 'sessions')
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ORBIT_TEST_MODE: mode,
        ORBIT_TEST_MODULE: moduleURL,
        ORBIT_TEST_ROOT: storage,
        ...(journalRoot ? {ORBIT_TEST_JOURNAL: journalRoot} : {}),
      },
      timeout: 10_000,
    })
    assert.equal(child.error, undefined)
    assert.equal(child.status, mode === 'death' ? 73 : 74, child.stderr)
    const repository = new SessionRepository({journalRoot, rootDir: storage})
    if (journalRoot)
      assert.notEqual(
        fs.statSync(repository.rootDir).dev,
        fs.statSync(repository.journalRoot).dev,
        'Cross-filesystem mode requires distinct filesystems',
      )
    let writableAdmission = 'rejected'
    try {
      const session = repository.create({id: 'before-offline-resume'})
      writableAdmission = 'accepted'
      // eslint-disable-next-line no-await-in-loop
      await session.close()
    } catch (error) {
      assert.match(String(error), /registration|initializ|incomplete/iu)
    }

    repository.resumeStorage(conditions)
    const resumed = repository.create({id: 'after-offline-resume'})
    // eslint-disable-next-line no-await-in-loop
    await resumed.close()
    console.log(
      JSON.stringify({
        childExit: child.status,
        distinctFilesystems: Boolean(journalRoot),
        mode,
        offlineResume: 'succeeded',
        writableAdmission,
      }),
    )
    if (writableAdmission !== 'rejected') failures++
  } finally {
    fs.rmSync(root, {force: true, recursive: true})
    if (journalRoot) fs.rmSync(journalRoot, {force: true, recursive: true})
  }
}

process.exitCode = failures ? 1 : 0
