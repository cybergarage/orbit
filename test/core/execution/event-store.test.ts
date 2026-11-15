// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {stub} from 'sinon'

import {
  EventStore,
  type EventStoreState,
  type JobSchedulingState,
  type ReadyJobCandidate,
  selectReadyJob,
} from '../../../src/index.js'

const fact = {id: 'first', key: 'entity', payload: {value: 1}, source: 'synthetic', type: 'input'}

describe('Task-independent durable event store', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-events-'))
  })

  afterEach(() => {
    fs.rmSync(root, {force: true, recursive: true})
  })

  it('keeps owner-defined priority claims and aging in the same durable transaction', () => {
    interface QueueState extends EventStoreState {
      jobs: ReadyJobCandidate[]
      scheduling: JobSchedulingState
    }
    const file = path.join(root, 'priority.json')
    const store = new EventStore<QueueState>(file, {
      initialState: {
        data: {},
        deliveries: [],
        events: [],
        jobs: [],
        scheduling: {waiting: []},
        version: 1,
      },
    })
    store.accept(fact, 'worker')
    store.admit('worker', (event, state) => {
      state.jobs.push({id: event.id, key: 'low', priority: 'low', ready: true, sequence: 1}, {id: 'high', key: 'high', priority: 'high', ready: true, sequence: 2})
      return event.id
    })
    expect(() =>
      store.transact((state) => {
        selectReadyJob(state.jobs, state.scheduling)
        throw new Error('Rejected synthetic claim')
      }),
    ).to.throw('Rejected synthetic claim')
    expect(store.snapshot().scheduling.waiting).deep.equal([])
    const id = store.transact((state) => {
      const selected = selectReadyJob(state.jobs, state.scheduling)!
      state.jobs.find((job) => job.id === selected)!.ready = false
      return selected
    })
    expect(id).equal('high')
    store.close()
    const reopened = new EventStore<QueueState>(file)
    expect(reopened.snapshot().scheduling.waiting).deep.equal([{bypasses: 1, id: 'first'}])
    expect(reopened.snapshot().jobs[1].ready).equal(false)
    expect(reopened.snapshot().deliveries[0].status).equal('acknowledged')
    reopened.close()
  })

  it('persists facts, independent consumers and atomic job admission without task APIs', () => {
    const file = path.join(root, 'events.json')
    let store = new EventStore(file)
    store.accept(fact, 'one', (state) => {
      state.data.cursor = 1
    })
    store.accept(fact, 'one', () => {
      throw new Error('duplicate intake mutation')
    })
    store.accept(fact, 'two')
    expect(() => new EventStore(file)).to.throw('already owned')
    store.close()
    store = new EventStore(file)
    expect(store.snapshot().data.cursor).equal(1)
    expect(store.snapshot().events).length(1)
    expect(store.snapshot().deliveries).length(2)
    expect(() =>
      store.admit('one', (event, state) => {
        state.data.job = {event: event.id, status: 'queued'}
        throw new Error('reject transaction')
      }),
    ).to.throw('reject transaction')
    expect(store.snapshot().data.job).equal(undefined)
    expect(store.snapshot().deliveries[0].status).equal('pending')
    expect(
      store.admit('one', (event, state) => {
        state.data.job = {event: event.id, status: 'queued'}
        return `job:${event.id}`
      }),
    ).deep.equal([{eventId: 'first', jobId: 'job:first'}])
    store.close()
    store = new EventStore(file)
    expect(
      store.admit('one', () => {
        throw new Error('replayed')
      }),
    ).deep.equal([])
    expect(store.snapshot().data.job).deep.equal({event: 'first', status: 'queued'})
    expect(store.snapshot().deliveries[1].status).equal('pending')
    store.cancel('first', 'two')
    store.accept(fact, 'two')
    expect(store.admit('two', () => 'unexpected')).deep.equal([])
    store.close()
  })

  it('rejects late older consumer registration after advancing its key-local sequence', () => {
    const file = path.join(root, 'ordered.json')
    const store = new EventStore(file)
    store.accept(fact, 'archive')
    store.accept({...fact, id: 'second'}, 'late')
    expect(store.admit('late', (event) => event.id).map((receipt) => receipt.eventId)).deep.equal(['second'])
    store.close()
    const reopened = new EventStore(file)
    expect(() => reopened.accept(fact, 'late')).to.throw('sequence already advanced')
    expect(() =>
      reopened.transact((state) => {
        state.deliveries.push({consumer: 'late', eventId: 'first', jobId: 'old-job', status: 'acknowledged'})
      }),
    ).to.throw('sequence already advanced')
    expect(reopened.snapshot().deliveries.filter((delivery) => delivery.consumer === 'late')).length(1)
    // A separate consumer can register history before admission, even in reverse order.
    reopened.accept({...fact, id: 'second'}, 'backfill')
    reopened.accept(fact, 'backfill')
    expect(reopened.admit('backfill', (event) => event.id).map((receipt) => receipt.eventId)).deep.equal([
      'first',
      'second',
    ])
    reopened.close()
  })

  it('rejects mutation of facts and terminal deliveries and detaches transaction references', () => {
    const store = new EventStore(path.join(root, 'immutable.json'))
    store.accept(fact, 'worker')
    let draft: EventStoreState | undefined
    store.transact((state) => {
      draft = state
      state.data.value = 1
    })
    draft!.data.value = 2
    expect(store.snapshot().data.value).equal(1)
    expect(() =>
      store.transact((state) => {
        state.events[0].type = 'changed'
      }),
    ).to.throw('Immutable event')
    store.admit('worker', () => 'job')
    expect(() =>
      store.transact((state) => {
        state.deliveries[0].status = 'pending'
        delete state.deliveries[0].jobId
      }),
    ).to.throw('Terminal delivery')
    store.close()
  })

  it('rejects reentrant writes and premature ownership release from callbacks', () => {
    const file = path.join(root, 'nested.json')
    const store = new EventStore(file)
    expect(() => store.accept(fact, 'worker', () => store.accept({...fact, id: 'nested'}, 'worker'))).to.throw(
      'Nested event transaction',
    )
    expect(() => store.transact(() => store.close())).to.throw('Cannot close during')
    expect(store.snapshot().events).length(0)
    expect(() => new EventStore(file)).to.throw('already owned')
    store.accept(fact, 'worker')
    store.close()
  })

  it('rejects asynchronous updates without committing their early or late mutations', async () => {
    const store = new EventStore(path.join(root, 'async.json'))
    expect(() =>
      store.accept(fact, 'worker', async (state) => {
        state.data.early = true
        await Promise.resolve()
        state.data.late = true
      }),
    ).to.throw('must be synchronous')
    expect(() =>
      store.transact(async (state) => {
        state.data.other = true
        throw new Error('observed asynchronous failure')
      }),
    ).to.throw('must be synchronous')
    await Promise.resolve()
    expect(store.snapshot().events).length(0)
    expect(store.snapshot().data).deep.equal({})
    store.close()
  })

  it('keeps admission and app state atomic across ambiguous successful rename', () => {
    const file = path.join(root, 'ambiguous.json')
    const store = new EventStore(file)
    store.accept(fact, 'worker')
    const rename = fs.renameSync
    const fault = stub(fs, 'renameSync').callsFake((from, to) => {
      rename(from, to)
      throw new Error('lost acknowledgement')
    })
    try {
      expect(() =>
        store.admit('worker', (event, state) => {
          state.data.job = event.id
          return 'job'
        }),
      ).to.throw('lost acknowledgement')
      expect(() => store.accept({...fact, id: 'next'}, 'worker')).to.throw('persistence uncertain')
    } finally {
      fault.restore()
      store.close()
    }

    const reopened = new EventStore(file)
    expect(reopened.snapshot().data.job).equal('first')
    expect(reopened.snapshot().deliveries[0].status).equal('acknowledged')
    expect(
      reopened.admit('worker', () => {
        throw new Error('duplicate')
      }),
    ).deep.equal([])
    reopened.close()
  })

  it('retains failed-close ownership and retries release without reopening writes', () => {
    const file = path.join(root, 'release.json')
    const store = new EventStore(file)
    const unlink = fs.unlinkSync
    const failure = stub(fs, 'unlinkSync').callsFake((target) => {
      if (target === `${file}.lock`) throw new Error('release failed')
      unlink(target)
    })
    try {
      expect(() => store.close()).to.throw('release failed')
      expect(() => store.accept(fact, 'worker')).to.throw('closed')
      expect(() => new EventStore(file)).to.throw('already owned')
    } finally {
      failure.restore()
    }

    store.close()
    const reopened = new EventStore(file)
    reopened.close()
  })

  it('does not unlink a replacement owner after lost close acknowledgement', () => {
    const file = path.join(root, 'release-ack.json')
    const store = new EventStore(file)
    const unlink = fs.unlinkSync
    const failure = stub(fs, 'unlinkSync').callsFake((target) => {
      unlink(target)
      if (target === `${file}.lock`) throw new Error('lost release acknowledgement')
    })
    try {
      expect(() => store.close()).to.throw('lost release acknowledgement')
    } finally {
      failure.restore()
    }

    const replacement = new EventStore(file)
    store.close()
    expect(() => new EventStore(file)).to.throw('already owned')
    replacement.close()
  })

  it('validates required event evidence despite a recognized format identifier', () => {
    const file = path.join(root, 'missing-payload.json')
    const store = new EventStore(file)
    store.accept(fact, 'worker')
    const state = store.snapshot()
    store.close()
    Reflect.deleteProperty(state.events[0], 'payload')
    const bytes = JSON.stringify(state)
    fs.writeFileSync(file, bytes)
    expect(() => new EventStore(file)).to.throw('Corrupt event identity')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
  })

  it('refuses invalid default application state before publication and preserves extensions', () => {
    const file = path.join(root, 'structure.json')
    const store = new EventStore(file)
    store.transact((state) => {
      Object.assign(state, {extension: {retained: true}})
    })
    const bytes = fs.readFileSync(file, 'utf8')
    expect(() =>
      store.transact((state) => {
        Object.assign(state, {data: []})
      }),
    ).to.throw('corrupt event state')
    expect(() =>
      store.transact((state) => {
        Object.assign(state, {version: 2})
      }),
    ).to.throw('corrupt event state')
    expect(fs.readFileSync(file, 'utf8')).equal(bytes)
    store.close()
    const reopened = new EventStore(file)
    expect(reopened.snapshot()).to.have.deep.property('extension', {retained: true})
    reopened.close()
  })

  it('recovers pending delivery after process death without task state', () => {
    const file = path.join(root, 'killed.json')
    const module = pathToFileURL(path.resolve('dist/core/execution/event-store.js')).href
    const script = `import {EventStore} from ${JSON.stringify(module)};
      const store = new EventStore(${JSON.stringify(file)});
      store.accept(${JSON.stringify(fact)},'worker',(state)=>{state.data.cursor=1});
      process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).equal(undefined)
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const store = new EventStore(file)
    expect(store.snapshot().data.cursor).equal(1)
    expect(store.snapshot().deliveries[0].status).equal('pending')
    expect(Object.keys(store.snapshot()).sort()).deep.equal(['data', 'deliveries', 'events', 'version'])
    expect(store.admit('worker', (event) => event.id)).deep.equal([{eventId: 'first', jobId: 'first'}])
    store.close()
  })

  it('does not redispatch an admitted job after an external effect and process death', () => {
    const file = path.join(root, 'opaque.json')
    const marker = path.join(root, 'synthetic-effect.txt')
    const module = pathToFileURL(path.resolve('dist/core/execution/event-store.js')).href
    const script = `import fs from 'node:fs'; import {EventStore} from ${JSON.stringify(module)};
      const store = new EventStore(${JSON.stringify(file)});
      store.accept(${JSON.stringify(fact)},'worker');
      store.admit('worker',(event,state)=>{state.data.job={id:event.id,status:'running'};return event.id});
      fs.writeFileSync(${JSON.stringify(marker)},'one effect'); process.kill(process.pid,'SIGKILL');`
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(killed.error).equal(undefined)
    if (process.platform === 'win32') expect(killed.status).equal(1)
    else expect(killed.signal).equal('SIGKILL')
    const initialState: EventStoreState = {data: {}, deliveries: [], events: [], version: 1}
    const store = new EventStore(file, {
      initialState,
      recover(state) {
        // Owner-defined business recovery, not an automatic execution replay policy.
        const job = state.data.job as {status: string}
        if (job.status === 'running') job.status = 'unknown'
      },
    })
    expect(store.snapshot().data.job).deep.equal({id: 'first', status: 'unknown'})
    expect(
      store.admit('worker', () => {
        throw new Error('unsafe replay')
      }),
    ).deep.equal([])
    expect(fs.readFileSync(marker, 'utf8')).equal('one effect')
    store.close()
  })
})
