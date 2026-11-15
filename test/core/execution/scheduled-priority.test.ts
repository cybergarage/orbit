// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {stub} from 'sinon'

import {DurableWorkStore, type WorkClaim, type WorkEnqueueOptions, type WorkSchedule} from '../../../src/index.js'

function finish(store: DurableWorkStore, claim: WorkClaim): void {
  store.finish(claim.run.id, claim.attempt.id, 'succeeded', 'synthetic result')
}

describe('Durable scheduled job priority', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-priority-'))
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  it('defaults old callers to FIFO and binds only explicit priority to replay identity', () => {
    const store = new DurableWorkStore(path.join(root, 'default.json'))
    store.enqueue('first', {priority: 'low'})
    store.enqueue('second', {priority: 'high'})
    expect(store.enqueue('first', {priority: 'low'}, 'read', undefined, {priority: 'normal'})).equal('first')
    expect(() => store.enqueue('first', {priority: 'low'}, 'read', undefined, {priority: 'high'})).to.throw(
      'Conflicting request',
    )
    const first = store.claimNext()!
    expect(first.run.id).equal('first')
    expect(first.run.priority).equal(undefined)
    expect(store.claimNext()).equal(undefined)
    finish(store, first)
    expect(store.claimNext()!.run.id).equal('second')
    store.close()
  })

  it('preserves old FIFO after approving an earlier normal job', () => {
    const store = new DurableWorkStore(path.join(root, 'approval-order.json'))
    store.enqueue('oldest', {}, 'read', 'Synthetic approval')
    store.enqueue('second', {})
    store.enqueue('third', {})
    const second = store.claimNext()!
    expect(second.run.id).equal('second')
    finish(store, second)
    store.approve('oldest', true)
    expect(store.claimNext()!.run.id).equal('oldest')
    store.close()
  })

  it('selects high before normal/low and never preempts active or unknown work', () => {
    const store = new DurableWorkStore(path.join(root, 'priority.json'))
    store.enqueue('low', {}, 'read', undefined, {priority: 'low'})
    store.enqueue('normal', {})
    store.enqueue('high', {}, 'opaque', undefined, {priority: 'high'})
    const high = store.claimNext()!
    expect(high.run.id).equal('high')
    store.enqueue('later-high', {}, 'read', undefined, {priority: 'high'})
    expect(store.claimNext()).equal(undefined)
    store.cancel(high.run.id)
    expect(store.snapshot().runs[2].status).equal('unknown')
    expect(store.claimNext()).equal(undefined)
    expect(() => store.finish(high.run.id, high.attempt.id, 'succeeded', 'late')).to.throw('Stale attempt')
    store.reconcile(high.run.id, 'Synthetic external quiescence', true)
    const later = store.claimNext()!
    expect(later.run.id).equal('later-high')
    finish(store, later)
    expect(store.claimNext()!.run.id).equal('normal')
    store.close()
  })

  it('persists low-job aging over restart under continuous high arrivals', () => {
    const file = path.join(root, 'fair.json')
    let store = new DurableWorkStore(file)
    store.enqueue('low', {}, 'read', undefined, {priority: 'low'})
    for (let step = 0; step <= 8; step++) {
      store.enqueue(`high-${step}`, {}, 'read', undefined, {priority: 'high'})
      const selected = store.claimNext()!
      expect(selected.run.id).equal(step === 8 ? 'low' : `high-${step}`)
      finish(store, selected)
      store.close()
      store = new DurableWorkStore(file)
    }

    expect(store.snapshot().attempts.filter((attempt) => attempt.runId === 'low')).length(1)
    store.close()
  })

  it('captures timer metadata without changing admission acknowledgement or same-schedule order', () => {
    const file = path.join(root, 'timers.json')
    const store = new DurableWorkStore(file)
    const id = store.schedule({
      effect: 'read',
      interval: 1000,
      next: 1000,
      payload: {priority: 'high'},
      priority: 'low',
    })
    store.materialize(1000)
    store.materialize(2000)
    store.enqueue('other', {}, 'read', undefined, {priority: 'normal'})
    expect(store.snapshot().attempts).length(0)
    expect(
      JSON.parse(fs.readFileSync(file, 'utf8')).deliveries.map((delivery: {status: string}) => delivery.status),
    ).deep.equal(['acknowledged', 'acknowledged'])
    const other = store.claimNext()!
    expect(other.run.id).equal('other')
    finish(store, other)
    const first = store.claimNext()!
    expect(first.run.id).equal(`${id}:1000`)
    expect(first.run.priority).equal('low')
    finish(store, first)
    expect(store.claimNext()!.run.id).equal(`${id}:2000`)
    store.close()
  })

  it('never ages cancelled, paused, deleted or approval-waiting jobs into execution', () => {
    const store = new DurableWorkStore(path.join(root, 'controls.json'))
    for (const action of ['pause', 'remove'] as const) {
      const id = store.schedule({effect: 'read', next: 1000, payload: {}, priority: 'high'})
      store.materialize(1000)
      if (action === 'pause') store.pause(id, true, 1000)
      else store.removeSchedule(id)
    }

    store.enqueue('cancelled', {}, 'read', undefined, {priority: 'high'})
    store.cancel('cancelled')
    store.enqueue('approval', {}, 'opaque', 'Synthetic approval', {priority: 'high'})
    store.enqueue('ready', {}, 'read', undefined, {priority: 'low'})
    const ready = store.claimNext()!
    expect(ready.run.id).equal('ready')
    finish(store, ready)
    expect(store.claimNext()).equal(undefined)
    expect(
      store
        .snapshot()
        .runs.slice(0, 3)
        .every((run) => run.status === 'cancelled'),
    ).equal(true)
    store.close()
  })

  it('keeps fairness and attempts atomic on failed publication', () => {
    const file = path.join(root, 'atomic.json')
    const store = new DurableWorkStore(file)
    store.enqueue('low', {}, 'read', undefined, {priority: 'low'})
    store.enqueue('high', {}, 'read', undefined, {priority: 'high'})
    const bytes = fs.readFileSync(file, 'utf8')
    const failure = stub(fs, 'renameSync').throws(new Error('Synthetic failed claim publication'))
    try {
      expect(() => store.claimNext()).to.throw('Synthetic failed claim publication')
    } finally {
      failure.restore()
      store.close()
    }

    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
    const reopened = new DurableWorkStore(file)
    expect(reopened.snapshot().attempts).length(0)
    expect(reopened.claimNext()!.run.id).equal('high')
    reopened.close()
  })

  it('preserves old data without scheduling metadata and rejects malformed present counters', () => {
    const file = path.join(root, 'legacy.json')
    const store = new DurableWorkStore(file)
    store.enqueue('old', {})
    const legacy = store.snapshot()
    store.close()
    fs.writeFileSync(file, JSON.stringify(legacy))
    const reopened = new DurableWorkStore(file)
    expect(reopened.claimNext()!.run.requestId).equal(legacy.runs[0].requestId)
    reopened.close()
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.jobScheduling = {waiting: [{bypasses: -1, id: 'old'}]}
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new DurableWorkStore(file)).to.throw('Corrupt job scheduling')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
  })

  it('retains fairness credits after a completed urgent claim and process death', () => {
    const file = path.join(root, 'fair-kill.json')
    const module = pathToFileURL(path.resolve('dist/core/execution/scheduled-work.js')).href
    const script = `import {DurableWorkStore} from ${JSON.stringify(module)};
      const store=new DurableWorkStore(${JSON.stringify(file)});
      store.enqueue('low',{},'read',undefined,{priority:'low'});
      store.enqueue('high-0',{},'read',undefined,{priority:'high'});
      const claim=store.claimNext();store.finish(claim.run.id,claim.attempt.id,'succeeded','synthetic');process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).to.be.undefined
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const store = new DurableWorkStore(file)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).jobScheduling.waiting).deep.equal([{bypasses: 1, id: 'low'}])
    for (let step = 1; step <= 8; step++) {
      store.enqueue(`high-${step}`, {}, 'read', undefined, {priority: 'high'})
      const claim = store.claimNext()!
      expect(claim.run.id).equal(step === 8 ? 'low' : `high-${step}`)
      finish(store, claim)
    }

    store.close()
  })

  it('rejects invalid explicit metadata while missing or undefined priority stays normal', () => {
    const file = path.join(root, 'invalid.json')
    const store = new DurableWorkStore(file)
    const input = {effect: 'read' as const, next: 1000, payload: {priority: 'high'}, priority: undefined}
    store.schedule(input)
    expect(() =>
      store.schedule({...input, priority: 'urgent'} as unknown as Omit<WorkSchedule, 'id' | 'paused'>),
    ).to.throw('Invalid job priority')
    expect(() =>
      store.enqueue('invalid', {}, 'read', undefined, {priority: 'urgent'} as unknown as WorkEnqueueOptions),
    ).to.throw('Invalid job priority')
    store.materialize(1000)
    expect(store.snapshot().runs[0].priority).to.be.undefined
    store.close()
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.runs[0].priority = 'urgent'
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new DurableWorkStore(file)).to.throw('Invalid job priority')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
  })

  it('keeps opaque recovery unknown after process death despite urgent metadata', () => {
    const file = path.join(root, 'opaque.json')
    const marker = path.join(root, 'synthetic-effect.txt')
    const module = pathToFileURL(path.resolve('dist/core/execution/scheduled-work.js')).href
    const script = `import fs from 'node:fs';import {DurableWorkStore} from ${JSON.stringify(module)};
      const store=new DurableWorkStore(${JSON.stringify(file)});
      store.enqueue('opaque',{},'opaque',undefined,{priority:'high'}); store.claimNext();fs.writeFileSync(${JSON.stringify(marker)},'one effect'); process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).to.be.undefined
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const store = new DurableWorkStore(file)
    store.enqueue('fresh-high', {}, 'read', undefined, {priority: 'high'})
    expect(store.claimNext()).equal(undefined)
    expect(store.snapshot().runs[0].status).equal('unknown')
    expect(fs.readFileSync(marker, 'utf8')).equal('one effect')
    expect(store.snapshot().attempts).length(1)
    store.close()
  })
})
