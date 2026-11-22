// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {anchorPlan} from '../../bin/project-memory-turn-neighbors.mjs'

describe('offline turn-anchor neighbor windows', () => {
  const history = [
    {
      originalIndex: 0,
      text: 'unrelated\nhello\nneedle\nworld\ntail',
      turns: [
        {end: 9, start: 0},
        {end: 15, start: 10},
        {end: 22, start: 16},
        {end: 28, start: 23},
        {end: 33, start: 29},
      ],
    },
  ]

  it('uses precisely one complete neighbor on each side within an admitted chunk', () => {
    const [row] = anchorPlan([{end: 28, originalIndex: 0, start: 10}], history, 'needle')
    assert.equal(row.overlap, 1)
    assert.equal(row.anchorOnly.excerpt, 'needle')
    assert.equal(row.neighbors.excerpt, 'hello\nneedle\nworld')
    assert.equal(row.neighbors.start, 10)
    assert.equal(row.neighbors.end, 28)
  })

  it('does not cross a chunk boundary, and resolves equal scores by the earliest turn', () => {
    const [row] = anchorPlan([{end: 22, originalIndex: 0, start: 10}], history, 'hello needle')
    assert.equal(row.anchorOnly.excerpt, 'hello')
    assert.equal(row.neighbors.excerpt, 'hello\nneedle')
    assert.equal(row.overlap, 1)
    assert.equal(anchorPlan([{end: 22, originalIndex: 0, start: 10}], history, 'tail')[0].overlap, 0)
  })
})
