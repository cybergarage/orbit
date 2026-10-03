// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {DurableWorkStore} from '../../../src/core/execution/scheduled-work.js'

describe('Durable scheduled work', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-work-'))
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
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
    const script = `import {DurableWorkStore} from ${JSON.stringify(`file://${module}`)}; const s=new DurableWorkStore(${JSON.stringify(file)});s.schedule({next:1000,effect:'read',payload:{safe:true}});s.materialize(1000);const r=s.snapshot().runs[0];s.claim(r.id);s.enqueue('write',{},'opaque');s.claim('write');s.enqueue('approval',{},'opaque','preview');process.kill(process.pid,'SIGKILL');`
    expect(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal).to.equal('SIGKILL')
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
