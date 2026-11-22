// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {firstLoss, repetition} from '../../bin/project-memory-evidence-loss.mjs'

const item = (originalIndex, start, end) => ({item: {end, originalIndex, start}})

describe('offline Project memory evidence loss', () => {
  it('distinguishes a copy of one turn from a repeated statement at another offset', () => {
    const history = [
      {
        originalIndex: 1,
        text: 'user: again\nuser: again',
        turns: [
          {end: 11, start: 0},
          {end: 23, start: 12},
        ],
      },
    ]
    assert.deepEqual(repetition(history, [item(1, 0, 23), item(1, 0, 11), item(1, 12, 22)]), {
      distinctOccurrences: 2,
      duplicateOccurrences: 1,
      repeatedText: 1,
      repeatedTextInSameSource: 1,
    })
  })

  it('assigns the first missing boundary without joining partial fragments', () => {
    const full = item(1, 0, 23)
    const trial = {
      available: [full],
      positive: [full],
      prepared: [full],
      preparedTopSix: [full],
      serialized: [item(1, 0, 10), item(1, 10, 23)],
    }
    assert.equal(firstLoss(trial, {end: 12, originalIndex: 1, start: 2}), 'serialization')
    assert.equal(firstLoss({...trial, positive: []}, {end: 12, originalIndex: 1, start: 2}), 'lexical-overlap')
    assert.equal(firstLoss(trial, {end: 8, originalIndex: 1, start: 2}), 'covered')
    assert.equal(firstLoss(trial, {end: 8, originalIndex: 2, start: 2}), 'ingestion')
  })
})
