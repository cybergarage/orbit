// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {lexicalTerms, weightedRank} from '../../bin/project-memory-df-ranking.mjs'
import {rankCandidates} from '../../bin/project-memory-ingestion-study-core.mjs'

const entry = (id, body, updatedAt = '2026-01-01T00:00:00.000Z') => ({body, id, title: '', updatedAt})
const ids = (ranked) => ranked.map(({entry}) => entry.id)

describe('offline document-frequency-weighted Project memory ranking', () => {
  it('keeps positive matches and promotes rarer Japanese lexical units over a baseline tie', () => {
    const query = '猫 犬'
    const candidates = [
      entry('01', '猫 猫 猫'),
      entry('02', '犬'),
      entry('03', '猫'),
      entry('04', '猫'),
      entry('05', '鳥'),
      entry('06', '鳥'),
    ]
    const rank = rankCandidates(candidates, query)
    assert.deepEqual(ids(rank), ['01', '02', '03', '04', '05', '06'])
    const trial = weightedRank(rank, query)
    assert.deepEqual(ids(trial), ['02', '01', '03', '04', '05', '06'])
    assert.deepEqual(
      trial.map(({overlap}) => overlap),
      [1, 1, 1, 1, 0, 0],
    )
    assert.deepEqual(ids(rank), ['01', '02', '03', '04', '05', '06'])
  })

  it('uses existing normalization and matches fields using runtime overlap as a parity guard', () => {
    assert.deepEqual([...lexicalTerms('ＬＬＭ 東京 かな ＬＬＭ')], ['llm', '東京', '京', 'かな', 'な'])
    const query = 'llm 東京 かな'
    const matching = {...entry('01', 'かな'), automatic: {condition: 'ＬＬＭ', evidence: '東京'}}
    const rank = rankCandidates([matching, entry('02', '犬')], query)
    assert.deepEqual(
      rank.map(({overlap}) => overlap),
      [5, 0],
    )
    assert.deepEqual(ids(weightedRank(rank, query)), ['01', '02'])
    assert.throws(() => weightedRank([{...rank[0], overlap: 6}], query), /disagree with runtime overlap/u)
  })
})
