// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {manifest, selectHoldout} from '../../bin/project-memory-heldout-ranking.mjs'

/* eslint-disable camelcase -- Synthetic rows mirror upstream benchmark field names. */
const row = (question_type, question_id) => ({question_id, question_type})
const synthetic = ['alpha', 'beta'].flatMap((type) =>
  ['a', 'b', 'c', 'd', 'e', 'f', 'g_abs', 'h_abs', 'i_abs'].map((suffix) => row(type, `${type}-${suffix}`)),
)

describe('offline held-out LongMemEval cohort', () => {
  it('excludes a disjoint pilot, reserves bounded abstentions and balances unequal type quotas', () => {
    const excluded = new Set(['alpha-a', 'beta-g_abs'])
    const selected = selectHoldout(synthetic, excluded, 9)
    const stats = manifest(
      selected,
      synthetic.filter(({question_id: id}) => excluded.has(id)),
    )
    assert(selected.every(({question_id: id}) => !excluded.has(id)))
    assert.equal(new Set(selected.map(({question_id: id}) => id)).size, 9)
    assert.deepEqual(stats.counts, {
      alpha: {abstention: 2, answerable: 3},
      beta: {abstention: 2, answerable: 2},
    })
    assert.deepEqual(selectHoldout(synthetic.toReversed(), excluded, 9), selected)
    assert(!JSON.stringify(stats).includes('alpha-a'))
  })

  it('reports a deficient stratum rather than silently substituting pilot cases', () => {
    assert.throws(() => selectHoldout([row('alpha', 'a')], new Set(['a']), 1), /Unexpected quota shortfall/u)
  })
})
