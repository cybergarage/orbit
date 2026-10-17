// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import {SessionRepository} from '../../src/core/session/repository.js'
import {executeInitialization, type InitializationProfile, planInitialization} from '../../src/index.js'

const consent = {
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  confirmation: 'INITIALIZE',
  exclusiveStorageControl: true,
} as const

describe('scoped initialization', () => {
  let profile: InitializationProfile
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-init-'))
    profile = {
      cacheRoots: [path.join(root, 'cache')],
      ownedRoots: [root],
      preservedPaths: [path.join(root, 'workspace')],
      scheduledRoots: [path.join(root, 'gui-scheduled')],
      settingsFiles: [path.join(root, 'settings.json')],
      stores: [
        {
          journalRoot: path.join(root, 'runs'),
          logRoot: path.join(root, 'logs'),
          projectFile: path.join(root, 'projects.sqlite'),
          sessionRoot: path.join(root, 'sessions'),
        },
      ],
    }
    for (const dir of ['cache', 'workspace', 'skills', 'sessions', 'runs', 'logs', 'gui-scheduled']) {
      fs.mkdirSync(path.join(root, dir))
      fs.writeFileSync(path.join(root, dir, 'fixture.txt'), 'synthetic')
    }

    fs.writeFileSync(profile.settingsFiles[0], '{"apiKey":"SYNTHETIC-SECRET"}')
    fs.writeFileSync(path.join(root, 'projects.sqlite'), 'synthetic database')
    fs.writeFileSync(path.join(root, 'gui-scheduled', 'work.json'), '{"schedules":["synthetic"]}')
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'preserve')
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  for (const mode of ['settings', 'data', 'all'] as const)
    it(`resets only ${mode} scope; retains user work, shared context and unselected settings`, () => {
      const plan = planInitialization(profile, mode)
      expect(JSON.stringify(plan)).not.contains('SYNTHETIC-SECRET')
      expect(plan.targets.reduce((n, t) => n + t.files, 0)).greaterThan(0)
      executeInitialization(plan, consent)
      expect(fs.existsSync(profile.settingsFiles[0])).equal(mode === 'data')
      expect(fs.existsSync(profile.stores[0].sessionRoot)).equal(mode === 'settings')
      expect(fs.existsSync(profile.scheduledRoots[0])).equal(mode === 'settings')
      expect(fs.existsSync(profile.cacheRoots[0])).equal(mode !== 'all')
      for (const keep of ['workspace/fixture.txt', 'skills/fixture.txt', 'AGENTS.md'])
        expect(fs.existsSync(path.join(root, keep))).equal(true)
      const again = planInitialization(profile, mode)
      executeInitialization(again, consent)
      expect(planInitialization(profile, mode).targets.every((t) => t.files === 0)).equal(true)
    })

  it('rejects missing consent, changed targets, nested targets, aliases, hardlinks and workspace content', () => {
    let plan = planInitialization(profile, 'all')
    expect(() => executeInitialization(plan, {...consent, allWritersStopped: false} as never)).throw('offline')
    fs.appendFileSync(profile.settingsFiles[0], 'changed')
    expect(() => executeInitialization(plan, consent)).throw('changed')
    expect(() => planInitialization({...profile, cacheRoots: [root]}, 'all')).throw('Protected')
    expect(() => planInitialization({...profile, cacheRoots: [path.join(root, 'skills')]}, 'all')).throw('Protected')
    expect(() => planInitialization({...profile, cacheRoots: [profile.stores[0].sessionRoot]}, 'all')).throw(
      'Conflicting',
    )
    fs.symlinkSync(root, path.join(root, 'cache', 'alias'), 'dir')
    expect(() => planInitialization(profile, 'all')).throw('Unsafe')
    fs.unlinkSync(path.join(root, 'cache', 'alias'))
    fs.linkSync(profile.settingsFiles[0], path.join(root, 'cache', 'linked'))
    expect(() => planInitialization(profile, 'all')).throw('Unsafe')
    fs.unlinkSync(path.join(root, 'cache', 'linked'))
    fs.writeFileSync(path.join(root, 'cache', 'ORBIT.md'), 'work')
    expect(() => planInitialization(profile, 'all')).throw('workspace')
    fs.unlinkSync(path.join(root, 'cache', 'ORBIT.md'))
    plan = planInitialization({...profile, settingsFiles: []}, 'settings')
    expect(plan.targets).deep.equal([])
  })

  it('rejects an active scheduled owner and a live Orbit writer despite declarations', async () => {
    fs.writeFileSync(path.join(profile.scheduledRoots[0], 'work.json.lock'), 'synthetic')
    expect(() => executeInitialization(planInitialization(profile, 'data'), consent)).throw('Scheduled')
    fs.unlinkSync(path.join(profile.scheduledRoots[0], 'work.json.lock'))
    fs.rmSync(profile.stores[0].sessionRoot, {recursive: true})
    fs.rmSync(profile.stores[0].journalRoot, {recursive: true})
    const repository = new SessionRepository({
      journalRoot: profile.stores[0].journalRoot,
      rootDir: profile.stores[0].sessionRoot,
    })
    repository.initializeStorage(consent)
    const session = repository.create({cwd: root})
    try {
      expect(() => executeInitialization(planInitialization(profile, 'data'), consent)).throw()
    } finally {
      await session.close()
    }
  })

  it('reports partial failure without rollback copies and permits a newly reviewed retry', () => {
    const plan = planInitialization(profile, 'all')
    const original = fs.rmSync
    const failure = stub(fs, 'rmSync').callsFake((file, options) => {
      if (String(file) === plan.targets[1].path) throw new Error('Synthetic failure')
      original(file, options)
    })
    try {
      expect(() => executeInitialization(plan, consent)).throw('incomplete')
    } finally {
      failure.restore()
    }

    expect(fs.existsSync(plan.targets[0].path)).equal(false)
    executeInitialization(planInitialization(profile, 'all'), consent)
    expect(fs.existsSync(profile.preservedPaths[0])).equal(true)
  })
})
