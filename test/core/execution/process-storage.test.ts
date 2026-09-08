// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile, spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {MemorySessionLogStore, SessionDeletionService} from '../../../src/core/index.js'
import {SessionRecorder} from '../../../src/core/session/recorder.js'
import {SessionRepository} from '../../session-storage-fixture.js'

const execute = promisify(execFile)
const args = (script: string) => ['--loader', './test/alias-loader.mjs', '--input-type=module', '-e', script]

describe('cross-process managed storage ownership', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-process-storage-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('rejects a competing process through the delegated lease and recovers its stale lock after exit', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({id: 'session'})
    await session.close()
    const {file} = (await repository.findById('session'))!
    const child = spawn(
      process.execPath,
      args(`
      import {SessionRecorder} from './src/core/session/recorder.ts';
      import {SessionRepository} from './src/core/session/repository.ts';
      const repository = new SessionRepository({rootDir: process.env.ORBIT_TEST_SESSIONS});
      import {FileExecutionJournal} from './src/core/execution/journal.ts';
      const recorder = SessionRecorder.open(process.env.ORBIT_TEST_FILE, repository.scope('session'));
      const journal = await FileExecutionJournal.open('session', {root: process.env.ORBIT_TEST_ROOT, level: 'file-sync', lease: recorder.acquireManagedLease()});
      await journal.append('run', 'run-admitted', {requestId: 'request'});
      recorder.close();
      process.stdout.write('owned\\n');
      process.stdin.resume();
      process.stdin.once('data', () => process.exit(73));
    `),
      {
        env: {
          ...process.env,
          ORBIT_TEST_FILE: file,
          ORBIT_TEST_ROOT: repository.journalRoot,
          ORBIT_TEST_SESSIONS: repository.rootDir,
          TS_NODE_PROJECT: 'tsconfig.test.json',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const exited = once(child, 'exit')
    try {
      const ready = await Promise.race([
        once(child.stdout, 'data').then(([data]) => String(data)),
        exited.then(() => {
          throw new Error(stderr)
        }),
      ])
      expect(ready).equal('owned\n')
      expect(() => SessionRecorder.open(file, repository.scope('session'))).throws('already open')
      await new SessionDeletionService(repository, new MemorySessionLogStore(), undefined, 'file-sync')
        .delete('session')
        .then(
          () => {
            throw new Error('Deleted another process writer')
          },
          (error) => {
            expect(String(error)).contains('already open')
          },
        )
      expect(await fs.readFile(path.join(repository.journalRoot, 'session/run/events.jsonl'), 'utf8')).contains(
        'run-admitted',
      )
      child.stdin.write('exit\n')
      expect((await exited)[0]).equal(73)
      const recorder = SessionRecorder.open(file, repository.scope('session'))
      const journal = await FileExecutionJournal.open('session', {
        lease: recorder.acquireManagedLease(),
        level: 'file-sync',
        root: repository.journalRoot,
      })
      expect(journal.records()).length(1)
      await journal.close()
      await recorder.close()
      expect(SessionRecorder.isOpen(file)).equal(false)
    } finally {
      if (child.exitCode === null) {
        child.kill()
        await exited
      }
    }
  })

  for (const checkpoint of ['marker', 'logs', 'transcript', 'journal', 'completed']) {
    it(`resumes deletion after process exit following ${checkpoint}`, async () => {
      const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
      const session = repository.create({id: 'session'})
      const journal = await FileExecutionJournal.open('session', {
        lease: session.acquireWriterLease(),
        level: 'file-sync',
        root: repository.journalRoot,
      })
      await journal.append('run', 'run-admitted', {})
      await journal.close()
      await session.close()
      await fs.writeFile(path.join(root, 'log-artifact'), 'private diagnostic fixture')
      await execute(
        process.execPath,
        args(`
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import {SessionRepository, SessionDeletionService, MemorySessionLogStore} from './src/core/index.ts';
        const root = process.env.ORBIT_TEST_ROOT;
        const checkpoint = process.env.ORBIT_TEST_CHECKPOINT;
        const repository = new SessionRepository({rootDir: path.join(root, 'sessions')});
        const finish = (point) => { if (point === checkpoint) process.exit(73); };
        const logs = new MemorySessionLogStore();
        logs.deleteSession = async () => { await fs.rm(path.join(root, 'log-artifact'), {force: true}); finish('logs'); };
        const rename = fs.rename.bind(fs);
        fs.rename = async (from, to) => { await rename(from, to); const marker = JSON.parse(await fs.readFile(to, 'utf8')); finish(marker.state === 'completed' ? 'completed' : 'marker'); };
        const unlink = fs.unlink.bind(fs);
        fs.unlink = async (file) => { await unlink(file); finish('transcript'); };
        const rm = fs.rm.bind(fs);
        fs.rm = async (file, options) => { await rm(file, options); if (file === path.join(repository.journalRoot, 'session')) finish('journal'); };
        await new SessionDeletionService(repository, logs, undefined, 'file-sync').delete('session');
        process.exit(74);
      `),
        {
          env: {
            ...process.env,
            ORBIT_TEST_CHECKPOINT: checkpoint,
            ORBIT_TEST_ROOT: root,
            TS_NODE_PROJECT: 'tsconfig.test.json',
          },
        },
      ).then(
        () => {
          throw new Error('Missing interruption')
        },
        (error) => {
          expect(error.code, error.stderr).equal(73)
        },
      )
      expect(() => repository.create({id: 'session'})).throws()
      const logs = new MemorySessionLogStore()
      logs.deleteSession = async () => {
        await fs.rm(path.join(root, 'log-artifact'), {force: true})
        return true
      }

      await new SessionDeletionService(repository, logs, undefined, 'file-sync').delete('session')
      expect(await repository.findById('session')).equal(undefined)
      expect(await fs.readdir(path.join(repository.journalRoot, 'deletions'))).deep.equal(['session.json'])
      expect(
        JSON.parse(await fs.readFile(path.join(repository.journalRoot, 'deletions/session.json'), 'utf8')),
      ).deep.equal({sessionId: 'session', state: 'completed', version: 1})
      await fs.access(path.join(root, 'log-artifact')).then(
        () => {
          throw new Error('Log retained')
        },
        () => {},
      )
      await fs.access(path.join(repository.journalRoot, 'session')).then(
        () => {
          throw new Error('Journal retained')
        },
        () => {},
      )
    })
  }
})
