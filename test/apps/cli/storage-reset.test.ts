// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stub} from 'sinon'

import StorageCommand from '../../../src/apps/cli/storage.js'
import {runStorageReset} from '../../../src/apps/storage-reset.js'
import {SessionRepository} from '../../../src/core/session/index.js'
import {planStorageReset, resetStorage, type StorageResetPaths} from '../../../src/core/session/storage-reset.js'

const project = fileURLToPath(new URL('../../../', import.meta.url))
const conditions = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true} as const
const confirmation = {confirmReset: true, exclusiveStorageControl: true, restartersDisabled: true, writersStopped: true}
const quiet = {log() {}}

async function rejects(operation: Promise<unknown>, message: string): Promise<void> {
  try {
    await operation
  } catch (error) {
    expect(String(error)).to.include(message)
    return
  }

  throw new Error('Expected failure: ' + message)
}

describe('offline storage reset', () => {
  let root: string
  let paths: StorageResetPaths
  let repository: SessionRepository

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-reset-'))
    paths = {
      journalRoot: path.join(root, 'runs'),
      logRoot: path.join(root, 'logs'),
      projectFile: path.join(root, 'projects.sqlite'),
      sessionRoot: path.join(root, 'sessions'),
    }
    repository = new SessionRepository({journalRoot: paths.journalRoot, rootDir: paths.sessionRoot})
  })

  afterEach(() => fs.rmSync(root, {force: true, recursive: true}))

  function populate(): void {
    repository.initializeStorage(conditions)
    fs.mkdirSync(paths.logRoot)
    fs.writeFileSync(path.join(paths.logRoot, 'test.log'), 'log')
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.writeFileSync(paths.projectFile + suffix, 'database')
    fs.writeFileSync(path.join(root, 'settings.json'), 'settings')
    fs.writeFileSync(path.join(paths.sessionRoot, 'test.jsonl'), 'test data')
  }

  it('previews all targets without changing contents or asking for confirmation', async () => {
    populate()
    const output: string[] = []
    const plan = planStorageReset(paths)
    await runStorageReset(
      {...paths, dryRun: true},
      {
        async confirm() {
          throw new Error('Unexpected prompt')
        },
        interactive: false,
        log: (message) => output.push(message),
      },
    )
    expect(planStorageReset(paths)).to.deep.equal(plan)
    expect(fs.readFileSync(paths.projectFile, 'utf8')).to.equal('database')
    for (const target of plan.targets) expect(output.join('\n')).to.include(target.path)
  })

  it('clears storage and sidecars but preserves settings, workspace files and external backups', async () => {
    populate()
    fs.mkdirSync(path.join(root, 'workspace'))
    fs.writeFileSync(path.join(root, 'workspace', 'code.ts'), 'source')
    fs.writeFileSync(path.join(root, 'backup.sqlite'), 'backup')
    await runStorageReset({...paths, ...confirmation}, quiet)
    expect(repository.inspectStorage().state).to.equal('unregistered')
    expect(planStorageReset(paths).targets.every((target) => target.identity === null)).to.equal(true)
    expect(fs.readFileSync(path.join(root, 'settings.json'), 'utf8')).to.equal('settings')
    expect(fs.readFileSync(path.join(root, 'workspace', 'code.ts'), 'utf8')).to.equal('source')
    expect(fs.readFileSync(path.join(root, 'backup.sqlite'), 'utf8')).to.equal('backup')
    await runStorageReset({...paths, ...confirmation}, quiet)
  })

  it('initializes a fresh pair only after deletion and supports nested .runs', async () => {
    paths.journalRoot = path.join(paths.sessionRoot, '.runs')
    repository = new SessionRepository({rootDir: paths.sessionRoot})
    populate()
    const previous = repository.inspectStorage().pairId
    await runStorageReset({...paths, ...confirmation, initialize: true}, quiet)
    expect(repository.inspectStorage().state).to.equal('ready')
    expect(repository.inspectStorage().pairId).not.to.equal(previous)
    expect(fs.existsSync(path.join(paths.sessionRoot, 'test.jsonl'))).to.equal(false)
    expect(fs.existsSync(paths.projectFile)).to.equal(false)
  })

  it('confirms offline conditions interactively and leaves declined storage untouched', async () => {
    populate()
    const plan = planStorageReset(paths)
    await rejects(
      runStorageReset(paths, {
        ...quiet,
        async confirm(message) {
          expect(message).to.include('RESET').and.include('exclusive administrative control').and.include('restarters')
          return false
        },
        interactive: true,
      }),
      'cancelled',
    )
    expect(planStorageReset(paths)).to.deep.equal(plan)
    await runStorageReset(paths, {
      ...quiet,
      async confirm() {
        return true
      },
      interactive: true,
    })
    expect(fs.existsSync(paths.sessionRoot)).to.equal(false)
  })

  it('refuses incomplete automation consent and noninteractive implicit consent', async () => {
    populate()
    await rejects(runStorageReset(paths, {...quiet, interactive: false}), 'requires a terminal')
    for (const key of ['writersStopped', 'restartersDisabled', 'exclusiveStorageControl'] as const)
      // eslint-disable-next-line no-await-in-loop -- verify each missing offline declaration independently
      await rejects(runStorageReset({...paths, ...confirmation, [key]: false}, quiet), 'requires --writers-stopped')
    expect(repository.inspectStorage().state).to.equal('ready')
  })

  it('never mixes custom targets with default user storage', async () => {
    await rejects(runStorageReset({dryRun: true, sessionRoot: paths.sessionRoot}, quiet), 'together')
    expect(fs.readdirSync(root)).to.deep.equal([])
  })

  it('refuses active owners before invalidating registration', async () => {
    repository.initializeStorage(conditions)
    const session = repository.create({cwd: root})
    try {
      expect(() => resetStorage(planStorageReset(paths), conditions)).to.throw('Local writer')
      expect(repository.inspectStorage().state).to.equal('ready')
    } finally {
      await session.close()
    }
  })

  it('refuses unknown ownership evidence without deleting it', () => {
    repository.initializeStorage(conditions)
    const directory = path.join(paths.sessionRoot, '.coordination')
    fs.mkdirSync(directory, {recursive: true})
    const owner = path.join(directory, 'test.owner')
    fs.writeFileSync(owner, '{}')
    expect(() => resetStorage(planStorageReset(paths), conditions)).to.throw('unknown writer')
    expect(fs.readFileSync(owner, 'utf8')).to.equal('{}')
  })

  it('clears explicitly selected torn registration evidence', async () => {
    populate()
    fs.writeFileSync(path.join(paths.sessionRoot, '.orbit-registration.guard'), 'torn')
    await runStorageReset({...paths, ...confirmation}, quiet)
    expect(repository.inspectStorage().state).to.equal('unregistered')
  })

  it('refuses conflicting partners, overlaps, protected ancestors and relative paths', () => {
    populate()
    expect(() => planStorageReset({...paths, journalRoot: path.join(root, 'different')})).to.throw('partner')
    expect(() => planStorageReset({...paths, logRoot: paths.sessionRoot})).to.throw('Overlapping')
    expect(() => planStorageReset({...paths, sessionRoot: os.homedir()})).to.throw('ancestor')
    expect(() => planStorageReset({...paths, logRoot: path.parse(root).root})).to.throw('ancestor')
    expect(() => planStorageReset({...paths, logRoot: process.cwd()})).to.throw('ancestor')
    expect(() => planStorageReset({...paths, logRoot: 'logs'})).to.throw('absolute')
    expect(() => planStorageReset({...paths, projectFile: path.join(root, 'settings.json')})).to.throw('.sqlite')
  })

  it('refuses target and nested symlinks without touching their destinations', function () {
    if (process.platform === 'win32') this.skip()
    populate()
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep'), 'keep')
    const link = path.join(paths.logRoot, 'link')
    fs.symlinkSync(outside, link, 'dir')
    expect(() => planStorageReset(paths)).to.throw('Unsafe')
    expect(() => planStorageReset({...paths, logRoot: link})).to.throw('symlink')
    expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).to.equal('keep')
  })

  it('refuses nested and ancestor registrations and workspace/configuration content', () => {
    populate()
    const nested = path.join(paths.logRoot, 'nested')
    fs.mkdirSync(nested)
    fs.writeFileSync(path.join(nested, '.orbit-session-binding.json'), '{}')
    expect(() => planStorageReset(paths)).to.throw('Nested')
    fs.rmSync(nested, {recursive: true})
    fs.writeFileSync(path.join(root, '.orbit-session-binding.json'), '{}')
    expect(() => planStorageReset(paths)).to.throw('Ancestor')
    fs.rmSync(path.join(root, '.orbit-session-binding.json'))
    fs.writeFileSync(path.join(paths.logRoot, 'settings.json'), '{}')
    expect(() => planStorageReset(paths)).to.throw('configuration')
  })

  it('rechecks target identity after confirmation', () => {
    const plan = planStorageReset(paths)
    fs.mkdirSync(paths.logRoot)
    expect(() => resetStorage(plan, conditions)).to.throw('changed')
    expect(fs.existsSync(paths.logRoot)).to.equal(true)
  })

  it('reports partial deletion and permits retry under continued offline control', () => {
    populate()
    const plan = planStorageReset(paths)
    const remove = fs.rmSync.bind(fs)
    const fault = stub(fs, 'rmSync').callsFake((file, options) => {
      if (String(file) === plan.paths.logRoot) throw new Error('Injected removal failure')
      return remove(file, options)
    })
    try {
      expect(() => resetStorage(plan, conditions, true)).to.throw('Remaining targets')
      expect(repository.inspectStorage().state).not.to.equal('ready')
      expect(fs.existsSync(paths.journalRoot)).to.equal(false)
      expect(fs.existsSync(paths.projectFile)).to.equal(true)
    } finally {
      fault.restore()
    }

    resetStorage(planStorageReset(paths), conditions, true)
    expect(repository.inspectStorage().state).to.equal('ready')
  })

  it('reports initialization failure separately after a complete clear', () => {
    populate()
    const sync = stub(fs, 'fsyncSync').throws(new Error('Injected sync failure'))
    try {
      expect(() => resetStorage(planStorageReset(paths), conditions, true)).to.throw(
        'Storage was cleared, but initialization failed',
      )
      expect(fs.existsSync(paths.projectFile)).to.equal(false)
      expect(fs.existsSync(paths.logRoot)).to.equal(false)
    } finally {
      sync.restore()
    }
  })

  it('routes CLI reset flags and rejects flags outside reset', async () => {
    populate()
    const roots = [
      '--session-root',
      paths.sessionRoot,
      '--journal-root',
      paths.journalRoot,
      '--log-root',
      paths.logRoot,
      '--project-file',
      paths.projectFile,
    ]
    const log = stub(StorageCommand.prototype, 'log')
    try {
      await StorageCommand.run(['reset', ...roots, '--dry-run'], project)
      expect(log.firstCall.args[0]).to.include('preview')
      expect(repository.inspectStorage().state).to.equal('ready')
      await rejects(StorageCommand.run(['inspect', '--dry-run'], project), 'only accepted')
      await rejects(StorageCommand.run(['reset', 'some-session', ...roots], project), 'session ID')
      await StorageCommand.run(
        [
          'reset',
          ...roots,
          '--confirm-reset',
          '--writers-stopped',
          '--restarters-disabled',
          '--exclusive-storage-control',
        ],
        project,
      )
      expect(repository.inspectStorage().state).to.equal('unregistered')
    } finally {
      log.restore()
    }
  })
})
