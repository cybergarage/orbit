// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {dateIntent, prioritize, sourceTime} from '../../bin/project-memory-chronological-preparation.mjs'
import {historyWithOffsets, ingestionPlan} from '../../bin/project-memory-ingestion-study-core.mjs'
import {packingReplay} from '../../bin/project-memory-turn-packing.mjs'

/* eslint-disable camelcase -- Synthetic fixture uses upstream field names. */
const dated = (timestamp, overlap = 1) => ({entry: {title: `History ${timestamp}`}, overlap})

describe('offline chronological preparation', () => {
  it('activates only explicit time intent, and rejects malformed calendar dates', () => {
    assert(dateIntent('What is my current option?'))
    assert(dateIntent('When did I last compete?'))
    assert(!dateIntent('Which option was suggested?'))
    assert.equal(sourceTime('2024/02/30 (Fri) 10:00'), null)
    assert.equal(sourceTime('2024/02/29 (Thu) 10:00'), Date.UTC(2024, 1, 29, 10))
  })

  it('promotes one eligible past hit, not a future entry, zero overlap, or rank 13', () => {
    const original = [
      dated('2024/02/25 (Sun) 10:00'),
      dated('2024/03/01 (Fri) 09:00'),
      dated('2024/02/28 (Wed) 09:00', 0),
      ...Array.from({length: 8}, () => dated('2024/02/22 (Thu) 10:00')),
      dated('2024/02/28 (Wed) 08:00'),
      dated('2024/02/28 (Wed) 08:00'),
      dated('2024/02/29 (Thu) 07:00'),
    ]
    const question = 'What is my latest update?'
    const now = '2024/02/29 (Thu) 08:00'
    const prepped = prioritize(original, question, now)
    assert(prepped.promoted)
    assert.equal(prepped.candidates[0], original[11])
    assert.deepEqual(
      prepped.candidates.slice(1),
      original.filter((_, index) => index !== 11),
    )
    assert.equal(prioritize(original, 'What happened?', now).candidates, original)
    assert.equal(prioritize(original, question, 'unknown').candidates, original)
  })

  it('restores original rank before serialization even if admission is reordered', () => {
    const row = {
      haystack_dates: ['2024/02/25 (Sun) 09:00', '2024/02/28 (Wed) 09:00'],
      haystack_session_ids: ['fiction-1', 'fiction-2'],
      haystack_sessions: [[{content: 'bike bike', role: 'user'}], [{content: 'bike repair', role: 'user'}]],
    }
    const history = historyWithOffsets(row)
    const {admitted} = ingestionPlan(history, 'turn-chunks')
    const baseline = packingReplay(admitted, history, 'bike', 'whole')
    let invoked = false
    const trial = packingReplay(admitted, history, 'bike', 'whole', {
      prepare(ranked) {
        invoked = true
        return [...ranked].reverse()
      },
      rank: (ranked) => ranked,
    })
    assert(invoked)
    assert.equal(trial.wire, baseline.wire)
    assert.deepEqual(trial.stages.rankedTopSix, baseline.stages.rankedTopSix)
  })
})
