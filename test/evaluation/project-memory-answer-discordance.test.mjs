// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {latestAnnotatedStage, transition} from '../../bin/project-memory-answer-discordance.mjs'

/* eslint-disable camelcase -- Synthetic data uses the public benchmark field names. */
const outcome = (correct, complete) => ({correct, coverage: {annotated: 2, complete}})

describe('offline audit of answer and evidence transitions', () => {
  it('distinguishes better grades from retaining more annotated turns', () => {
    assert.equal(transition(outcome(false, 0), outcome(true, 1)), 'winMore')
    assert.equal(transition(outcome(false, 0), outcome(true, 0)), 'winSame')
    assert.equal(transition(outcome(false, 2), outcome(true, 1)), 'winFewer')
    assert.equal(transition(outcome(true, 0), outcome(false, 0)), 'loss')
    assert.equal(transition(outcome(false, 2), outcome(false, 0)), 'sameGrade')
  })

  it('tracks the last annotated turn separately from other turns in its source', () => {
    const row = {haystack_sessions: [[{has_answer: true}], [{has_answer: false}, {has_answer: true}]]}
    const history = [
      {originalIndex: 0, turns: [{end: 3, start: 0, turnIndex: 0}]},
      {
        originalIndex: 1,
        turns: [
          {end: 3, start: 0, turnIndex: 0},
          {end: 7, start: 4, turnIndex: 1},
        ],
      },
    ]
    const candidate = {item: {end: 7, originalIndex: 1, start: 0}}
    const partial = {item: {end: 5, originalIndex: 1, start: 0}}
    assert.deepEqual(
      latestAnnotatedStage(row, history, {
        available: [candidate],
        positive: [candidate],
        prepared: [partial],
        serialized: [partial],
      }),
      {admitted: true, eligible: true, prepared: false, serialized: false, sourceInWire: true},
    )
  })
})
