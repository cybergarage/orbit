// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {
  answerMessages,
  evidenceContexts,
  oracleSpans,
  randomizedSlots,
} from '../../bin/project-memory-answer-oracle.mjs'
import {historyWithOffsets, ingestionPlan} from '../../bin/project-memory-ingestion-study-core.mjs'
import {packingReplay} from '../../bin/project-memory-turn-packing.mjs'

/* eslint-disable camelcase -- This fictional fixture uses the public benchmark field names. */
const row = {
  answer: 'REFERENCE_NOT_FOR_GENERATION',
  haystack_dates: ['2024/02/02 (Fri) 09:00', '2024/02/01 (Thu) 10:00'],
  haystack_session_ids: ['ground-truth-secret', 'another-secret'],
  haystack_sessions: [
    [{content: 'blue bicycle', has_answer: true, role: 'user'}],
    [
      {content: 'paid with cash', has_answer: true, role: 'user'},
      {content: 'also a helmet', has_answer: true, role: 'assistant'},
      {content: 'unannotated distraction', role: 'user'},
      {content: 'on a Thursday', has_answer: true, role: 'assistant'},
    ],
  ],
  question: 'What did they pay for the blue bicycle?',
  question_date: '2024/02/03 (Sat) 10:00',
  question_id: 'synthetic',
  question_type: 'multi-session',
}

describe('offline construction for the local answer oracle diagnostic', () => {
  it('uses only complete gold turns, sometimes grouped, in original date and turn order', () => {
    const spans = oracleSpans(row, historyWithOffsets(row))
    assert.deepEqual(
      spans.map(({excerpt}) => excerpt),
      ['user: paid with cash\nassistant: also a helmet', 'assistant: on a Thursday', 'user: blue bicycle'],
    )
    assert.deepEqual(
      spans.map(({originalIndex}) => originalIndex),
      [1, 1, 0],
    )
    assert.deepEqual(
      spans.map(({title}) => title),
      ['History 2024/02/01 (Thu) 10:00', 'History 2024/02/01 (Thu) 10:00', 'History 2024/02/02 (Fri) 09:00'],
    )
  })

  it('uses exact baseline wire and no inline answer, gold marker, or arm cue', () => {
    const contexts = evidenceContexts(row)
    const history = historyWithOffsets(row)
    const {admitted} = ingestionPlan(history, 'turn-chunks')
    assert.equal(
      contexts.baseline.wire,
      packingReplay(admitted, history, `Current date: ${row.question_date}\n${row.question}`, 'whole').wire,
    )
    assert.deepEqual(contexts.oracle.coverage, {annotated: 4, complete: 4})
    for (const context of Object.values(contexts)) {
      assert(context.costs.preparation <= 2048 && context.costs.serialization <= 2048)
      assert(context.slots <= 6)
      const messages = JSON.stringify(answerMessages(row, context.wire))
      assert(!/REFERENCE_NOT_FOR_GENERATION|has_answer|ground-truth-secret|diagnostic-oracle|weighted/u.test(messages))
    }
  })

  it('uses ordinary retrieval for abstention without an oracle slot and fixes the randomized plan', () => {
    const abstention = {...row, question_id: 'synthetic_abs'}
    const arms = evidenceContexts(abstention)
    assert.deepEqual(Object.keys(arms), ['baseline', 'weighted'])
    assert.equal(arms.baseline.wire, evidenceContexts(row).baseline.wire)
    const slots = randomizedSlots([row, abstention])
    assert.deepEqual(slots, randomizedSlots([row, abstention]))
    assert.deepEqual(
      slots
        .filter(({caseId}) => caseId === abstention.question_id)
        .map(({arm}) => arm)
        .sort(),
      ['baseline', 'weighted'],
    )
  })
})
