// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {sourceFirst, stagePair} from '../../bin/project-memory-source-diversity.mjs'

function candidate(id, originalIndex, overlap, {end = 10, start = 0} = {}) {
  return {
    entry: {id},
    get gold() {
      throw new Error('Selection must not consult gold annotations')
    },
    item: {end, originalIndex, start},
    overlap,
  }
}

describe('offline Project memory source diversity', () => {
  it('prioritizes the first positive entry per source and backfills in the original rank order', () => {
    const ranked = [
      candidate('a1', 1, 8),
      candidate('a2', 1, 7),
      candidate('b1', 2, 6),
      candidate('b2', 2, 5),
      candidate('c1', 3, 1),
      candidate('d0', 4, 0),
      candidate('a0', 1, 0),
    ]
    const result = sourceFirst(Object.freeze(ranked))
    assert.deepEqual(result, [ranked[0], ranked[2], ranked[4], ranked[1], ranked[3], ranked[5], ranked[6]])
    assert.deepEqual(sourceFirst([ranked[0], ranked[2], ranked[4]]), [ranked[0], ranked[2], ranked[4]])
  })

  it('counts swapped annotations separately even when coverage and diversity are unchanged', () => {
    const gold = [
      {end: 7, originalIndex: 1, start: 2},
      {end: 7, originalIndex: 2, start: 2},
    ]
    const before = [candidate('a', 1, 10), candidate('c', 3, 8)]
    const after = [candidate('b', 2, 8), candidate('d', 4, 5)]
    const observation = {full: false, relevantSources: 1, slots: 2, sources: 2, turns: 1}
    assert.deepEqual(stagePair(gold, before, after), {gained: 1, lost: 1, rank: observation, sourceFirst: observation})
  })

  it('requires a complete turn in one entry, but counts a relevant source even with a partial hit', () => {
    const gold = [{end: 8, originalIndex: 1, start: 2}]
    const before = [candidate('partial', 1, 8, {end: 7}), candidate('suffix', 1, 5, {start: 7})]
    const after = [candidate('complete', 1, 8)]
    const match = stagePair(gold, before, after)
    assert.deepEqual(match, {
      gained: 1,
      lost: 0,
      rank: {full: false, relevantSources: 1, slots: 2, sources: 1, turns: 0},
      sourceFirst: {full: true, relevantSources: 1, slots: 1, sources: 1, turns: 1},
    })
    assert.equal(stagePair([], before, after).sourceFirst.full, false)
  })
})
