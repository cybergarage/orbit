// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {randomizedSlots} from '../../bin/project-memory-answer-oracle.mjs'
import {openCheckpointRun} from '../../bin/project-memory-study-checkpoints.mjs'

/* eslint-disable camelcase -- Benchmark fixture field names. */
describe('offline checks for the full local answer comparison', () => {
  const rows = Array.from({length: 100}, (_, n) => ({question_id: `fiction-${n + 1}${n % 10 === 0 ? '_abs' : ''}`}))
  const manifest = {judgeDigest: 'mock-model-pin', rubricDigest: 'mock-rubric-pin'}

  it('uses two ordinary slots on every case, including answerable case 100', () => {
    const slots = randomizedSlots(rows, {includeOracle: false})
    assert.equal(slots.length, 200)
    assert.equal(new Set(slots.map(({key}) => key)).size, 200)
    assert.equal(slots.filter(({arm}) => arm === 'oracle').length, 0)
    assert(slots.some(({key}) => key === '100-diagnostic-weighted'))
    assert.deepEqual(slots, randomizedSlots(rows, {includeOracle: false}))
  })

  it('durably resumes the last case using the exact committed answer and grade', async () => {
    const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'orbit-full-synthetic-'))
    const slots = randomizedSlots(rows, {includeOracle: false})
    const slot = slots.find(({key}) => key === '100-diagnostic-weighted')
    try {
      const store = await openCheckpointRun(root, manifest, slots)
      try {
        const answer = await store.acceptAnswer(slot, {
          answer: 'Synthetic answer',
          trace: {arm: slot.arm, contextDigest: 'fixed', outcome: 'completed', promptDigest: 'fixed', wireRequests: []},
        })
        await store.acceptGrade(answer, true)
      } finally {
        store.close()
      }

      const resumed = await openCheckpointRun(root, manifest, slots, {resume: true})
      try {
        assert.equal(resumed.answers.get(slot.key).answer, 'Synthetic answer')
        assert.equal(resumed.grades.get(slot.key).correct, true)
      } finally {
        resumed.close()
      }
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
