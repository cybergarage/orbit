// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {LocalScheduler, type TaskExecutor} from '../../../src/apps/gui/local-scheduler.js'
import {DurableWorkStore} from '../../../src/core/execution/scheduled-work.js'

describe('local GUI scheduling host (synthetic only)', () => {
  let root: string
  let host: LocalScheduler | undefined

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-synthetic-')))
  })

  afterEach(async () => {
    await host?.close()
    host = undefined
    await fs.rm(root, {force: true, recursive: true})
  })
  // Each case deliberately uses only synthetic requests and an injected executor.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const input = (workspace: string, interval?: number) => ({
    interval,
    next: 1000,
    operationId: randomUUID(),
    task: {
      instructions: 'Synthetic input; no model or tools',
      name: 'Synthetic task',
      permissions: 'workspace-read',
      version: 1,
      workspace,
    },
  })
  const open = (execute: TaskExecutor = async () => ({result: 'synthetic result', status: 'succeeded'})) => {
    host = new LocalScheduler(new DurableWorkStore(path.join(root, 'work.json')), execute)
    return host
  }

  it('deletes schedules durably while allowing admitted work to settle and retaining files', async () => {
    let release!: () => void
    let admitted!: () => void
    const started = new Promise<void>((resolve) => {
      admitted = resolve
    })
    const done = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = open(async () => {
      admitted()
      await done
      return {result: 'retained result', status: 'succeeded'}
    })
    const sentinel = path.join(root, 'workspace.txt')
    await fs.writeFile(sentinel, 'preserved')
    const id = await scheduler.create(input(root, 1000))
    const ticking = scheduler.tick(1000)
    await started
    scheduler.remove(id)
    scheduler.remove(id)
    expect(scheduler.snapshot().runs[0].status).equal('running')
    release()
    await ticking
    await scheduler.close()
    host = undefined
    const restored = open()
    await restored.tick(9000)
    expect(restored.snapshot().schedules).length(0)
    expect(restored.snapshot().runs[0]).include({result: 'retained result', status: 'succeeded'})
    expect(await fs.readFile(sentinel, 'utf8')).equal('preserved')
  })

  it('rejects expired one-time enable without admitting work', async () => {
    const scheduler = open()
    const id = await scheduler.create(input(root))
    scheduler.pause(id, true)
    expect(() => scheduler.pause(id, false, 1000)).to.throw('expired')
    expect(scheduler.snapshot().schedules[0].paused).equal(true)
  })

  it('persists one-shot history and creation replay across restart', async () => {
    let calls = 0
    const value = input(root)
    const first = open(async () => {
      calls++
      return {result: 'fixture result', status: 'succeeded'}
    })
    const [a, b] = await Promise.all([first.create(value), first.create(value)])
    expect(a).equal(b)
    expect(first.snapshot().enabled).equal(false)
    await first.tick(1000)
    expect(calls).equal(1)
    expect(first.snapshot().runs[0]).include({result: 'fixture result', status: 'succeeded'})
    expect(first.snapshot().schedules[0].paused).equal(true)
    await first.close()
    host = undefined
    const second = open()
    expect(await second.create(value)).equal(a)
    expect(second.snapshot().attempts).length(1)
    await second.tick(2000)
    expect(second.snapshot().runs).length(1)
  })

  it('serializes repeated dispatch requests and refuses to resume a materialized one-shot', async () => {
    let entered!: () => void
    let settle!: () => void
    let calls = 0
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const scheduler = open(async () => {
      calls++
      entered()
      await new Promise<void>((resolve) => {
        settle = resolve
      })
      return {result: 'synthetic', status: 'succeeded'}
    })
    const id = await scheduler.create(input(root))
    const first = scheduler.tick(1000)
    await started
    const repeats = Array.from({length: 20}, () => scheduler.tick(2000))
    expect(calls).equal(1)
    expect(() => scheduler.pause(id, false)).to.throw('already created')
    settle()
    await Promise.all([first, ...repeats])
    await scheduler.tick(5000)
    expect(calls).equal(1)
    expect(scheduler.snapshot().runs).length(1)
  })

  it('replays creation receipts after the workspace disappears without duplicating tasks', async () => {
    const workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    const scheduler = open()
    const value = input(workspace)
    const id = await scheduler.create(value)
    await fs.rmdir(workspace)
    expect(await scheduler.create(value)).equal(id)
    expect(scheduler.snapshot().schedules).length(1)
  })

  it('persists active cancellation before signalling and preserves it through interrupted-read recovery', async () => {
    let entered!: () => void
    let settle!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const scheduler = open(async () => {
      entered()
      await new Promise<void>((resolve) => {
        settle = resolve
      })
      return {result: 'synthetic stopped', status: 'failed'}
    })
    await scheduler.create(input(root))
    const ticking = scheduler.tick(1000)
    await started
    const {id} = scheduler.snapshot().runs[0]
    scheduler.cancel(id)
    const file = path.join(root, 'work.json')
    const interrupted = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(interrupted.data[`cancel:${id}`]).equal(true)
    expect(interrupted.runs[0].status).equal('running')
    settle()
    await ticking
    await scheduler.close()
    host = undefined
    // Restore this synthetic interruption boundary in the same isolated fixture file.
    await fs.writeFile(file, JSON.stringify(interrupted))
    let dispatched = false
    const restarted = open(async () => {
      dispatched = true
      return {result: '', status: 'succeeded'}
    })
    expect(restarted.snapshot().runs[0].status).equal('cancelled')
    await restarted.tick(2000)
    expect(dispatched).equal(false)
  })

  it('rejects saved schedule values outside the GUI timestamp and interval contract', async () => {
    const scheduler = open()
    await scheduler.create(input(root))
    await scheduler.close()
    host = undefined
    const file = path.join(root, 'work.json')
    const state = JSON.parse(await fs.readFile(file, 'utf8'))
    state.schedules[0].next = Number.MAX_SAFE_INTEGER
    await fs.writeFile(file, JSON.stringify(state))
    expect(() => open()).to.throw()
    const store = new DurableWorkStore(file)
    store.close()
  })

  it('rejects conflicting retries and unsafe task schemas', async () => {
    const scheduler = open()
    const value = input(root)
    await scheduler.create(value)
    for (const invalid of [
      {...value, task: {...value.task, name: 'Changed'}},
      {...input(root), interval: 999},
      {...input(root), cron: '* * * * *'},
      {...input(root), task: {...value.task, permissions: 'all'}},
      {...input(root), task: {...value.task, workspace: 'relative'}},
      {...input(root), task: {...value.task, approvals: true}},
    ]) {
      let rejected = false
      try {
        // Serial assertions preserve the one-writer test boundary.
        // eslint-disable-next-line no-await-in-loop
        await scheduler.create(invalid)
      } catch {
        rejected = true
      }

      expect(rejected).equal(true)
    }

    expect(scheduler.snapshot().schedules).length(1)
  })

  it('coalesces missed intervals and pause blocks only future materialization', async () => {
    const scheduler = open()
    const id = await scheduler.create(input(root, 1000))
    scheduler.pause(id, true)
    await scheduler.tick(5000)
    expect(scheduler.snapshot().runs).length(0)
    scheduler.pause(id, false, 4000)
    await scheduler.tick(5000)
    expect(scheduler.snapshot().occurrences[0].due).equal(5000)
    expect(scheduler.snapshot().schedules[0].next).equal(6000)
  })

  it('cooperates with cancellation and keeps the occurrence running until the executor settles', async () => {
    let entered!: () => void
    let finish!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const scheduler = open(async (_task, _id, signal) => {
      entered()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      expect(signal.aborted).equal(true)
      return {result: 'stopped', status: 'failed'}
    })
    const id = await scheduler.create(input(root, 1000))
    const ticking = scheduler.tick(1000)
    await started
    const run = scheduler.snapshot().runs[0]
    scheduler.pause(id, true)
    expect(scheduler.snapshot().runs[0].status).equal('running')
    scheduler.cancel(run.id)
    scheduler.cancel(run.id)
    expect(scheduler.snapshot().cancelling).equal(run.id)
    expect(scheduler.snapshot().runs[0].status).equal('running')
    finish()
    await ticking
    expect(scheduler.snapshot().runs[0].status).equal('cancelled')
    await scheduler.tick(5000)
    expect(scheduler.snapshot().runs).length(1)
  })

  it('does not dispatch a cancelled queued occurrence', async () => {
    const scheduler = open()
    await scheduler.create(input(root))
    // Materialization is synthetic, with no executor invoked.
    await scheduler.close()
    host = undefined
    const store = new DurableWorkStore(path.join(root, 'work.json'))
    store.materialize(1000)
    store.cancel(store.snapshot().runs[0].id)
    store.close()
    const restarted = open(async () => {
      throw new Error('Must not dispatch')
    })
    await restarted.tick(1000)
    expect(restarted.snapshot().runs[0].status).equal('cancelled')
  })

  it('quarantines uncertain outcomes and requires stopped evidence before reconciliation', async () => {
    const scheduler = open(async () => {
      throw new Error('Synthetic uncertain cleanup')
    })
    await scheduler.create(input(root))
    await scheduler.tick(1000)
    const {id} = scheduler.snapshot().runs[0]
    expect(scheduler.snapshot().runs[0].status).equal('unknown')
    expect(() => scheduler.reconcile(id, '', true)).to.throw()
    expect(() => scheduler.reconcile(id, 'checked', false as true)).to.throw()
    scheduler.reconcile(id, 'Synthetic worker confirmed stopped', true)
    expect(scheduler.snapshot().runs[0].status).equal('failed')
  })

  it('fails a missing workspace without invoking execution', async () => {
    const workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    let calls = 0
    const scheduler = open(async () => {
      calls++
      return {result: '', status: 'succeeded'}
    })
    await scheduler.create(input(workspace))
    await fs.rmdir(workspace)
    await scheduler.tick(1000)
    expect(calls).equal(0)
    expect(scheduler.snapshot().runs[0].status).equal('failed')
  })

  it('rejects saved permission expansion and releases ownership after rejection', async () => {
    const store = new DurableWorkStore(path.join(root, 'work.json'))
    store.schedule({effect: 'opaque', next: 1000, payload: input(root).task})
    store.close()
    const rejected = new DurableWorkStore(path.join(root, 'work.json'))
    expect(() => new LocalScheduler(rejected, async () => ({result: '', status: 'succeeded'}))).to.throw()
    const reopened = new DurableWorkStore(path.join(root, 'work.json'))
    reopened.close()
  })
})
