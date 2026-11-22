// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {Readable} from 'node:stream'

import {historyWithOffsets, ingestionPlan, replaySelection} from '../../bin/project-memory-ingestion-study-core.mjs'
import {admit, completePrefixes, packingReplay, readPinnedDataset} from '../../bin/project-memory-turn-packing.mjs'

/* eslint-disable camelcase -- The fixture uses upstream dataset field names. */

const candidate = (id, body, prefix = body) => ({
  entry: {body, id, source: 'fixed'},
  item: {excerpt: body},
  prefixes: [{excerpt: body}, {excerpt: prefix}],
})
const ids = (values) => values.map((v) => v.entry.id)

describe('offline Project memory turn packing', () => {
  it('rejects truncated or non-binary stdin before parsing any records', async () => {
    await assert.rejects(readPinnedDataset(Readable.from([Buffer.from('[]')])), /Dataset size mismatch/u)
    await assert.rejects(readPinnedDataset(Readable.from(['[]'])), /Expected binary streaming input/u)
  })

  it('retains only complete prefix turns, excluding any final partial turn', () => {
    const history = new Map([
      [
        0,
        {
          text: 'a😀\nsecond\nthird',
          turns: [
            {end: 3, start: 0, turnIndex: 0},
            {end: 10, start: 4, turnIndex: 1},
            {end: 16, start: 11, turnIndex: 2},
          ],
        },
      ],
    ])
    const entry = {end: 13, originalIndex: 0, start: 0}
    assert.deepEqual(
      completePrefixes(entry, history).map(({excerpt}) => excerpt),
      ['a😀\nsecond', 'a😀'],
    )
    assert.deepEqual(completePrefixes({...entry, start: 1}, history), [])
    assert.deepEqual(completePrefixes({...entry, end: 2}, history), [])
  })

  it('keeps metadata and order, and applies independent skip vs stop policies', () => {
    const entries = [candidate('1', 'long', 'x'), candidate('2', 'zzzzz'), candidate('3', 'y')]
    const options = {cap: 2, limit: 2, measure: (values) => values.map(({entry}) => entry.body).join('').length}
    assert.deepEqual(
      admit(entries, {...options, mode: 'whole'}).map((v) => v.entry.id),
      ['3'],
    )
    assert.deepEqual(
      admit(entries, {...options, mode: 'pack'}).map((v) => v.entry),
      [
        {body: 'x', id: '1', source: 'fixed'},
        {body: 'y', id: '3', source: 'fixed'},
      ],
    )
    assert.deepEqual(
      admit(entries, {...options, mode: 'pack', stopOnMiss: true}).map((v) => v.entry.id),
      ['1'],
    )
  })

  it('reproduces reference whole-entry selection and holds rank across variants', () => {
    const row = {
      haystack_dates: ['2026/10/10 (Sat) 10:00', '2026/10/11 (Sun) 10:00'],
      haystack_session_ids: ['fiction-1', 'fiction-2'],
      haystack_sessions: [
        [
          {content: 'orange', has_answer: false, role: 'user'},
          {content: 'orange pear', has_answer: true, role: 'assistant'},
        ],
        [{content: 'orange weather', has_answer: false, role: 'user'}],
      ],
      question: 'orange?',
      question_date: '2026/10/12 (Mon) 10:00',
      question_id: 'synthetic',
      question_type: 'single-session-user',
    }
    const history = historyWithOffsets(row)
    assert(history.length > 0)
    const {admitted} = ingestionPlan(history, 'turn-chunks')
    const query = 'orange'
    const baseline = replaySelection(admitted, query)
    const whole = packingReplay(admitted, history, query, 'whole')
    assert.deepEqual(ids(whole.stages.prepared), baseline.preparedIds)
    assert.deepEqual(ids(whole.stages.serialized), baseline.returnedIds)
    for (const arm of ['prepare', 'serialize', 'both']) {
      const trial = packingReplay(admitted, history, query, arm)
      assert.deepEqual(ids(trial.stages.rankedTopSix), baseline.topSixIds)
      assert(trial.costs.preparation <= 2048)
      assert(trial.costs.serialization <= 2048)
    }
  })
})
