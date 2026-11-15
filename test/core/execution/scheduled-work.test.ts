// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {stub} from 'sinon'

import {DurableWorkStore} from '../../../src/core/execution/scheduled-work.js'

// Stop after cursor/event acceptance, before job admission, using the real atomic writer.
function pendingTimer(file: string, action?: 'cancel' | 'pause' | 'remove'): string {
  const store = new DurableWorkStore(file)
  const id = store.schedule({effect: 'read', interval: 1000, next: 1000, payload: {safe: true}})
  const rename = fs.renameSync
  let writes = 0
  const fault = stub(fs, 'renameSync').callsFake((from, to) => {
    if (++writes === 2) throw new Error('Interrupted admission')
    rename(from, to)
  })
  try {
    expect(() => store.materialize(1000)).to.throw('Interrupted admission')
    expect(() => store.setData('later', true)).to.throw('persistence uncertain')
  } finally {
    fault.restore()
    store.close()
  }

  if (action) {
    const reopened = new DurableWorkStore(file)
    if (action === 'cancel') reopened.cancel(`${id}:1000`)
    else if (action === 'pause') reopened.pause(id, true, 1000)
    else reopened.removeSchedule(id)
    reopened.close()
  }

  return id
}

describe('Durable scheduled work', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-work-'))
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  it('recovers process death after event acceptance with one stable occurrence and no attempt', () => {
    const file = path.join(root, 'killed-inbox.json')
    const module = pathToFileURL(path.resolve('dist/core/execution/scheduled-work.js')).href
    const script = `import fs from 'node:fs'; import {DurableWorkStore} from ${JSON.stringify(module)};
      const store = new DurableWorkStore(${JSON.stringify(file)});
      store.schedule({effect:'read',next:1000,payload:{safe:true}});
      const rename = fs.renameSync;
      fs.renameSync = (...args) => {rename(...args); process.kill(process.pid,'SIGKILL')};
      store.materialize(1000);`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).equal(undefined)
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const accepted = JSON.parse(fs.readFileSync(file, 'utf8'))
    const id = accepted.events[0].occurrenceId
    expect(accepted.deliveries[0].status).equal('pending')
    const store = new DurableWorkStore(file)
    expect(store.materialize(1000)).deep.equal([id])
    const snapshot = store.snapshot()
    expect(snapshot.runs[0].id).equal(id)
    expect(snapshot.attempts).length(0)
    store.close()
    const reopened = new DurableWorkStore(file)
    expect(reopened.materialize(1000)).deep.equal([])
    expect(reopened.snapshot().runs[0].requestId).equal(snapshot.runs[0].requestId)
    reopened.close()
  })

  it('preserves corrupt consumer acknowledgement evidence without recovery writes', () => {
    const file = path.join(root, 'bad-delivery.json')
    pendingTimer(file)
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.deliveries[0] = {...state.deliveries[0], jobId: 'missing', status: 'acknowledged'}
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new DurableWorkStore(file)).to.throw('Corrupt timer acknowledgement')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
  })

  it('quarantines an opaque effect performed before its result was recorded', () => {
    const file = path.join(root, 'effect.json')
    const effect = path.join(root, 'synthetic-external-effect.txt')
    const module = pathToFileURL(path.resolve('dist/core/execution/scheduled-work.js')).href
    const script = `import fs from 'node:fs'; import {DurableWorkStore} from ${JSON.stringify(module)};
      const store = new DurableWorkStore(${JSON.stringify(file)});
      store.schedule({effect:'opaque',next:1000,payload:{synthetic:true}});
      store.materialize(1000); store.claim(store.snapshot().runs[0].id);
      fs.appendFileSync(${JSON.stringify(effect)},'effect\\n'); process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).equal(undefined)
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const store = new DurableWorkStore(file)
    const state = store.snapshot()
    expect(state.runs[0].status).equal('unknown')
    expect(state.runs[0].result).equal(undefined)
    expect(state.attempts).length(1)
    expect(() => store.claim(state.runs[0].id)).to.throw('not queued')
    expect(store.materialize(1000)).deep.equal([])
    expect(fs.readFileSync(effect, 'utf8')).equal('effect\n')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deliveries[0].status).equal('acknowledged')
    store.close()
  })

  it('recovers accepted timer delivery without treating acknowledgement as execution', () => {
    const file = path.join(root, 'inbox.json')
    const id = pendingTimer(file)
    const accepted = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(accepted.events).length(1)
    expect(accepted.deliveries[0].status).equal('pending')
    expect(accepted.runs).length(0)
    expect(accepted.schedules[0].next).equal(2000)
    const store = new DurableWorkStore(file)
    expect(store.materialize(1000)).deep.equal([`${id}:1000`])
    expect(store.materialize(1000)).deep.equal([])
    expect(store.snapshot().attempts).length(0)
    expect(store.snapshot().runs[0].status).equal('queued')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deliveries[0].status).equal('acknowledged')
    expect(store.snapshot().version).equal(1)
    expect(Object.keys(store.snapshot()).sort()).deep.equal([
      'attempts',
      'data',
      'occurrences',
      'runs',
      'schedules',
      'version',
    ])
    store.close()
  })

  for (const action of ['cancel', 'pause', 'remove'] as const)
    it(`does not resurrect pending timer delivery after ${action}`, () => {
      const file = path.join(root, `${action}.json`)
      pendingTimer(file, action)
      const store = new DurableWorkStore(file)
      expect(store.materialize(1000)).deep.equal([])
      expect(store.snapshot().runs).length(0)
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).deliveries[0].status).equal('cancelled')
      store.close()
    })

  it('rejects timer/public ID collisions without advancing the cursor', () => {
    const file = path.join(root, 'collision.json')
    const store = new DurableWorkStore(file)
    const id = store.schedule({effect: 'read', next: 1000, payload: {safe: true}})
    store.enqueue(`${id}:1000`, {safe: true})
    expect(() => store.materialize(1000)).to.throw('Conflicting occurrence')
    expect(store.snapshot().schedules[0].paused).equal(false)
    store.close()
    const pending = pendingTimer(path.join(root, 'pending.json'))
    const other = new DurableWorkStore(path.join(root, 'pending.json'))
    expect(() => other.enqueue(`${pending}:1000`, {safe: true})).to.throw('Conflicting')
    other.close()
  })

  it('deduplicates redelivered timer facts after task completion', () => {
    const file = path.join(root, 'redelivery.json')
    const store = new DurableWorkStore(file)
    store.schedule({effect: 'read', interval: 1000, next: 1000, payload: {safe: true}})
    const [id] = store.materialize(1000)
    const attempt = store.claim(id)
    store.finish(id, attempt.id, 'succeeded', 'one result')
    const original = store.snapshot()
    store.close()
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.schedules[0].next = 1000 // Synthetic duplicate transport delivery of the same slot.
    fs.writeFileSync(file, JSON.stringify(state))
    const reopened = new DurableWorkStore(file)
    expect(reopened.materialize(1000)).deep.equal([])
    expect(reopened.snapshot().runs).deep.equal(original.runs)
    expect(reopened.snapshot().attempts).deep.equal(original.attempts)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).events).length(1)
    reopened.close()
  })

  for (const corruption of ['orphan', 'duplicate-delivery', 'source', 'payload', 'job-before-ack'] as const)
    it(`refuses ${corruption} in a pending inbox without modifying evidence`, () => {
      const file = path.join(root, `${corruption}.json`)
      pendingTimer(file)
      const state = JSON.parse(fs.readFileSync(file, 'utf8'))
      switch (corruption) {
        case 'duplicate-delivery': {
          state.deliveries.push(state.deliveries[0])
          break
        }

        case 'orphan': {
          state.deliveries.push({...state.deliveries[0], eventId: 'missing'})
          break
        }

        case 'payload': {
          state.events[0].payload = {changed: true}
          break
        }

        case 'source': {
          state.events[0].source = 'untrusted'
          break
        }

        default: {
          state.deliveries[0].jobId = 'uncommitted'
        }
      }

      const bytes = JSON.stringify(state)
      fs.writeFileSync(file, bytes)
      expect(() => new DurableWorkStore(file)).to.throw()
      expect(fs.readFileSync(file, 'utf8')).equal(bytes)
    })

  it('never discards event evidence just because a state is relabelled as legacy', () => {
    const file = path.join(root, 'relabelled.json')
    pendingTimer(file)
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.version = 1
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new DurableWorkStore(file)).to.throw('Ambiguous legacy work state')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
  })

  it('imports v1 history and application cancellation receipts without changing identities', () => {
    const file = path.join(root, 'legacy.json')
    const store = new DurableWorkStore(file)
    for (const id of ['arbitrary:timer:[1]', 'running-read', 'running-opaque', 'terminal', 'uncertain', 'approval'])
      store.enqueue(
        id,
        {safe: true},
        id === 'running-opaque' ? 'opaque' : 'read',
        id === 'approval' ? 'preview' : undefined,
      )
    store.claim('running-read')
    store.claim('running-opaque')
    const terminal = store.claim('terminal')
    store.finish('terminal', terminal.id, 'succeeded', 'retained')
    const uncertain = store.claim('uncertain')
    store.finish('uncertain', uncertain.id, 'unknown', 'uncertain')
    store.setData('cancel:running-read', true)
    const legacy = store.snapshot()
    store.close()
    fs.writeFileSync(file, JSON.stringify(legacy))
    const migrated = new DurableWorkStore(file)
    const state = migrated.snapshot()
    expect(state.runs.map((run) => [run.id, run.requestId])).deep.equal(
      legacy.runs.map((run) => [run.id, run.requestId]),
    )
    expect(state.runs.map((run) => run.status)).deep.equal([
      'queued',
      'queued',
      'unknown',
      'succeeded',
      'unknown',
      'approval',
    ])
    expect(state.attempts.map((attempt) => attempt.id)).deep.equal(legacy.attempts.map((attempt) => attempt.id))
    expect(state.data['cancel:running-read']).equal(true)
    expect(state.runs[3].result).equal('retained')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).equal(2)
    migrated.close()
  })

  it('retains the persistence bound and poisons ambiguous successful rename failures', () => {
    const file = path.join(root, 'ambiguous.json')
    const store = new DurableWorkStore(file)
    expect(() => store.setData('large', 'x'.repeat(16 * 1024 * 1024))).to.throw('history limit')
    const rename = fs.renameSync
    const fault = stub(fs, 'renameSync').callsFake((from, to) => {
      rename(from, to)
      throw new Error('Ambiguous rename')
    })
    try {
      expect(() => store.enqueue('accepted', {})).to.throw('Ambiguous rename')
      expect(() => store.enqueue('second', {})).to.throw('persistence uncertain')
    } finally {
      fault.restore()
      store.close()
    }

    const reopened = new DurableWorkStore(file)
    expect(reopened.snapshot().runs.map((run) => run.id)).deep.equal(['accepted'])
    reopened.close()
  })

  it('rejects expired and consumed one-time enable through the public store', () => {
    const store = new DurableWorkStore(path.join(root, 'one-time-controls.json'))
    const id = store.schedule({effect: 'read', next: 5000, payload: {synthetic: true}})
    store.pause(id, true, 1000)
    store.pause(id, false, 2000)
    store.pause(id, true, 3000)
    expect(() => store.pause(id, false, 5000)).to.throw('expired')
    expect(store.snapshot().schedules[0].paused).equal(true)
    store.pause(id, false, 4000)
    store.materialize(5000)
    expect(() => store.pause(id, false, 6000)).to.throw('already created')
    store.close()
  })

  it('skips disabled recurring slots, cancels queued work, and retains deleted history across restart', () => {
    const file = path.join(root, 'controls.json')
    let store = new DurableWorkStore(file)
    const id = store.schedule({effect: 'read', interval: 1000, next: 1000, payload: {synthetic: true}})
    store.materialize(1000)
    store.pause(id, true, 1500)
    expect(store.snapshot().runs[0].status).equal('cancelled')
    store.pause(id, false, 5500)
    expect(store.snapshot().schedules[0].next).equal(6000)
    store.pause(id, false, 9000)
    expect(store.snapshot().schedules[0].next).equal(6000)
    store.materialize(6000)
    store.removeSchedule(id)
    store.close()
    store = new DurableWorkStore(file)
    expect(store.snapshot().schedules).length(0)
    expect(store.snapshot().runs.map((run) => run.status)).deep.equal(['cancelled', 'cancelled'])
    expect(store.snapshot().occurrences).length(2)
    expect(store.materialize(10_000)).deep.equal([])
    store.close()
  })

  it('materializes the latest missed occurrence and commits its cursor together', () => {
    const file = path.join(root, 'state.json')
    let store = new DurableWorkStore(file)
    const id = store.schedule({effect: 'read', interval: 1000, next: 1000, payload: {folder: 'synthetic'}})
    expect(store.materialize(5500)).to.deep.equal([`${id}:5000`])
    store.close()
    store = new DurableWorkStore(file)
    expect(store.materialize(5500)).to.deep.equal([])
    expect(store.snapshot().schedules[0].next).to.equal(6000)
    expect(store.snapshot().runs).to.have.length(1)
    store.close()
  })

  it('persists approval, denial and cancellation without dispatch', () => {
    const file = path.join(root, 'state.json')
    let store = new DurableWorkStore(file)
    const id = store.enqueue('approval', {value: 'test'}, 'opaque', 'Replace memory with test')
    store.close()
    store = new DurableWorkStore(file)
    expect(store.snapshot().runs[0].status).to.equal('approval')
    expect(() => store.claim(id)).to.throw()
    store.approve(id, false)
    store.close()
    store = new DurableWorkStore(file)
    expect(store.snapshot().runs[0].status).to.equal('cancelled')
    store.close()
  })

  it('rejects conflicting retries and simultaneous live owners', () => {
    const file = path.join(root, 'state.json')
    const store = new DurableWorkStore(file)
    store.enqueue('stable', {task: 1})
    expect(store.enqueue('stable', {task: 1})).to.equal('stable')
    expect(() => store.enqueue('stable', {task: 2})).to.throw('Conflicting')
    expect(() => new DurableWorkStore(file)).to.throw('already owned')
    store.close()
  })

  it('rejects stale completion after read cancellation', () => {
    const store = new DurableWorkStore(path.join(root, 'state.json'))
    const id = store.enqueue('cancel', {})
    const attempt = store.claim(id)
    store.cancel(id)
    expect(() => store.finish(id, attempt.id, 'succeeded', 'late')).to.throw('Stale')
    expect(store.snapshot().runs[0].result).to.equal(undefined)
    store.close()
  })

  it('recovers SIGKILL with stable attempt identity and one visible result; quarantines opaque work', () => {
    const file = path.join(root, 'state.json')
    const module = path.resolve('dist/core/execution/scheduled-work.js')
    const script = `import {DurableWorkStore} from ${JSON.stringify(pathToFileURL(module).href)}; const s=new DurableWorkStore(${JSON.stringify(file)});s.schedule({next:1000,effect:'read',payload:{safe:true}});s.materialize(1000);const r=s.snapshot().runs[0];s.claim(r.id);s.enqueue('write',{},'opaque');s.claim('write');s.enqueue('approval',{},'opaque','preview');process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).equal(undefined)
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    let store = new DurableWorkStore(file)
    const run = store.snapshot().runs[0]
    expect(run.status).to.equal('queued')
    expect(store.snapshot().runs[1].status).to.equal('unknown')
    expect(store.snapshot().runs[2].status).to.equal('approval')
    expect(() => store.claim('write')).to.throw()
    const attempt = store.claim(run.id)
    store.finish(run.id, attempt.id, 'succeeded', 'one result')
    store.close()
    store = new DurableWorkStore(file)
    expect(store.materialize(2000)).to.deep.equal([])
    expect(store.snapshot().runs.filter((r) => r.result === 'one result')).to.have.length(1)
    expect(store.snapshot().attempts.filter((a) => a.runId === run.id)).to.have.length(2)
    store.close()
  })

  it('binds retries to canonical payload and rejects approval bypass for atomic memory updates', () => {
    const store = new DurableWorkStore(path.join(root, 'state.json'))
    store.enqueue('canonical', {a: 1, b: 2})
    expect(store.enqueue('canonical', {a: 1, b: 2})).to.equal('canonical')
    const attempt = store.claim('canonical')
    expect(() =>
      store.finish('canonical', attempt.id, 'succeeded', 'result', {key: 'memory', value: 'bypass'}),
    ).to.throw('Approved')
    expect(store.snapshot().runs[0].status).to.equal('running')
    store.cancel('canonical')
    store.enqueue('approved', {}, 'opaque', 'Replace memory')
    store.approve('approved', true)
    const approved = store.claim('approved')
    store.finish('approved', approved.id, 'succeeded', 'updated', {key: 'memory', value: 'approved value'})
    expect(store.snapshot().data.memory).to.equal('approved value')
    store.close()
  })

  it('preserves and refuses corrupt durable identities', () => {
    const file = path.join(root, 'state.json')
    const store = new DurableWorkStore(file)
    store.enqueue('same', {})
    const state = store.snapshot()
    store.close()
    state.runs.push(state.runs[0])
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new DurableWorkStore(file)).to.throw('Corrupt')
    expect(fs.readFileSync(file, 'utf8')).to.equal(bytes)
  })
})
