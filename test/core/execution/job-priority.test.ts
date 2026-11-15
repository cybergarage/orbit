// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {
  JOB_AGING_INTERVAL,
  type JobSchedulingState,
  type ReadyJobCandidate,
  resolveJobPriority,
  selectReadyJob,
} from '../../../src/index.js'

const candidate = (
  id: string,
  sequence: number,
  priority?: ReadyJobCandidate['priority'],
  key = id,
): ReadyJobCandidate => ({id, key, ready: true, sequence, ...(priority === undefined ? {} : {priority})})

describe('Ready-job priority and fairness', () => {
  it('preserves default FIFO independently of array layout and ignores payload hints', () => {
    const jobs = [candidate('second', 2), {...candidate('first', 1), payload: {priority: 'low'}}]
    const state: JobSchedulingState = {waiting: []}
    expect(selectReadyJob(jobs, state)).equal('first')
    expect(jobs.map((job) => job.id)).deep.equal(['second', 'first'])
    expect(resolveJobPriority()).equal('normal')
    expect(() => resolveJobPriority(null)).to.throw('Invalid job priority')
    expect(() => resolveJobPriority('urgent')).to.throw('Invalid job priority')
  })

  it('retains default FIFO when an older blocked job becomes ready', () => {
    const oldest = {...candidate('oldest', 1), ready: false}
    const state: JobSchedulingState = {waiting: []}
    for (let index = 0; index < 12; index++) {
      const first = candidate(`peer-${index}`, index + 2)
      const later = candidate('later', 100)
      expect(selectReadyJob([oldest, first, later], state)).equal(first.id)
      expect(state.waiting).deep.equal([])
    }

    oldest.ready = true
    expect(selectReadyJob([oldest, candidate('later', 100)], state)).equal('oldest')
  })

  it('compares only independent ready heads and never overtakes an older same-key job', () => {
    const jobs = [
      candidate('old-low', 1, 'low', 'same'),
      candidate('later-high', 2, 'high', 'same'),
      candidate('independent', 3),
    ]
    const state: JobSchedulingState = {waiting: []}
    expect(selectReadyJob(jobs, state)).equal('independent')
    jobs.pop()
    expect(selectReadyJob(jobs, state)).equal('old-low')
    jobs.shift()
    expect(selectReadyJob(jobs, state)).equal('later-high')
  })

  it('blocks successors behind an unready head without aging ineligible work', () => {
    const jobs = [
      {...candidate('blocked', 1, 'low', 'same'), ready: false},
      candidate('later-high', 2, 'high', 'same'),
      candidate('other', 3, 'low'),
    ]
    const state: JobSchedulingState = {waiting: [{bypasses: 2, id: 'later-high'}]}
    expect(selectReadyJob(jobs, state)).equal('other')
    expect(state.waiting).deep.equal([{bypasses: 2, id: 'later-high'}])
    expect(selectReadyJob(jobs.slice(0, 2), state)).equal(undefined)
    expect(state.waiting).deep.equal([{bypasses: 2, id: 'later-high'}])
  })

  for (const [priority, bypasses] of [
    ['low', 2 * JOB_AGING_INTERVAL],
    ['normal', JOB_AGING_INTERVAL],
  ] as const)
    it(`admits ${priority} work despite continuous high arrivals after ${bypasses} bypasses`, () => {
      let state: JobSchedulingState = {waiting: []}
      const waiting = candidate('waiting', 1, priority)
      for (let step = 0; step <= bypasses; step++) {
        // Restore serialized state at every step; no clock or elapsed time affects fairness.
        const serialized = JSON.stringify(state)
        state = JSON.parse(serialized)
        const urgent = candidate(`high-${step}`, step + 2, 'high')
        const selected = selectReadyJob([urgent, waiting], state)
        expect(selected).equal(step === bypasses ? waiting.id : urgent.id)
      }
    })

  it('keeps fairness for every member of a finite low backlog under high arrivals', () => {
    const jobs = Array.from({length: 6}, (_, index) => candidate(`low-${index}`, index + 1, 'low'))
    const state: JobSchedulingState = {waiting: []}
    const selectedLow = new Set<string>()
    for (let step = 0; step < 40 && jobs.length > 0; step++) {
      const high = candidate(`high-${step}`, step + 100, 'high')
      const id = selectReadyJob([...jobs, high], state)!
      if (id.startsWith('low-')) {
        selectedLow.add(id)
        jobs.splice(
          jobs.findIndex((job) => job.id === id),
          1,
        )
      }
    }

    expect([...selectedLow]).deep.equal(['low-0', 'low-1', 'low-2', 'low-3', 'low-4', 'low-5'])
  })

  it('handles arbitrary legacy identities without object-key collisions', () => {
    const state: JobSchedulingState = {waiting: []}
    expect(selectReadyJob([candidate('__proto__', 1, 'low'), candidate('constructor', 2, 'high')], state)).equal(
      'constructor',
    )
    expect(state.waiting).deep.equal([{bypasses: 1, id: '__proto__'}])
  })

  it('rejects invalid priorities, duplicate order and corrupt counters before mutation', () => {
    const jobs = [candidate('one', 1)]
    const state: JobSchedulingState = {waiting: [{bypasses: 2, id: 'one'}]}
    const original = structuredClone(state)
    expect(() => selectReadyJob([{...jobs[0], priority: 'urgent'} as unknown as ReadyJobCandidate], state)).to.throw(
      'Invalid job priority',
    )
    expect(() => selectReadyJob([...jobs, candidate('two', 1)], state)).to.throw('Invalid job candidate')
    expect(state).deep.equal(original)
    expect(() => selectReadyJob(jobs, {waiting: [{bypasses: 9, id: 'one'}]})).to.throw('Corrupt job scheduling')
  })
})
