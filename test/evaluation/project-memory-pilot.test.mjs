// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official dataset field names are exercised verbatim. */

import assert from 'node:assert/strict'
import {test as nodeTest} from 'node:test'

import {
  classifyFailure,
  evidenceCoverage,
  historyOnly,
  parseJudgment,
  selectCases,
  summarize,
} from '../../bin/project-memory-pilot.mjs'

nodeTest('history ingestion discards all QA, evidence annotations and revealing dataset IDs', () => {
  const row = {
    answer: 'SECRET ANSWER',
    answer_session_ids: ['answer_secret'],
    haystack_dates: ['2025/02/01', '2025/01/01'],
    haystack_session_ids: ['answer_secret', 'other'],
    haystack_sessions: [
      [{content: 'Later fact', has_answer: true, role: 'user'}],
      [{content: 'Earlier fact', has_answer: false, role: 'assistant'}],
    ],
    question: 'SECRET QUESTION',
  }
  const actual = historyOnly(row)
  assert.deepEqual(
    actual.map((x) => x.text),
    ['assistant: Earlier fact', 'user: Later fact'],
  )
  assert.equal(JSON.stringify(actual).includes('SECRET'), false)
  assert.equal(JSON.stringify(actual).includes('answer_secret'), false)
  assert.equal(JSON.stringify(actual).includes('has_answer'), false)
  assert.deepEqual(
    historyOnly({
      ...row,
      answer: 'changed',
      answer_session_ids: [],
      haystack_sessions: row.haystack_sessions.map((s) => s.map((m) => ({...m, has_answer: !m.has_answer}))),
      question: 'changed',
    }),
    actual,
  )
})

nodeTest('selects thirty cases reproducibly with six strata and abstentions independently of answers', () => {
  const rows = Array.from({length: 6}, (_, category) =>
    Array.from({length: 8}, (_, index) => ({
      answer: 'private label',
      question_id: `${category}-${index}${index === 0 ? '_abs' : ''}`,
      question_type: `type-${category}`,
    })),
  ).flat()
  const selected = selectCases(rows)
  assert.equal(selected.length, 30)
  assert.equal(selected.filter((row) => row.question_id.endsWith('_abs')).length, 6)
  assert.deepEqual(selectCases([...rows].reverse()), selected)
  assert.deepEqual(
    selectCases(rows.map((row) => ({...row, answer: 'different'}))).map((r) => r.question_id),
    selected.map((r) => r.question_id),
  )
})

nodeTest('scores source-session evidence without promoting missing judgments to measured accuracy', () => {
  const row = {answer_session_ids: ['a', 'b'], haystack_session_ids: ['a', 'b', 'c']}
  assert.deepEqual(
    evidenceCoverage(
      row,
      [
        {entryId: '1', originalIndex: 0},
        {entryId: '2', originalIndex: 1},
      ],
      ['1'],
    ),
    {denominator: 2, ingested: 2, retrieved: 1},
  )
  const record = {
    abstained: false,
    arm: 'tool',
    category: 'multi-session',
    dispatches: 1,
    evidence: {denominator: 2, retrieved: 1},
    failure: null,
    inputTokens: 10,
    judgedCorrect: null,
    latencyMs: 20,
    outputTokens: 5,
    proxyCorrect: false,
    unanswerable: false,
  }
  const summary = summarize([record])['tool/all']
  assert.equal(summary.accuracy, null)
  assert.equal(summary.gradedN, 0)
  assert.equal(summary.evidenceRecall, 0.5)
  assert.equal(summary.dispatchRate, 1)
})

nodeTest('rejects malformed judge output rather than converting it into a score', () => {
  assert.deepEqual(parseJudgment('{"correct":[true,false,true]}'), [true, false, true])
  for (const text of ['not JSON', '{"correct":[true]}', '{"correct":[1,0,1]}']) {
    assert.throws(() => parseJudgment(text))
  }
})

nodeTest('distinguishes ingestion, retrieval, answer and execution failures', () => {
  const row = {
    evidence: {denominator: 1, retrieved: 0},
    judgedCorrect: false,
    outcome: 'completed',
    retainedEvidence: true,
    unanswerable: false,
  }
  assert.equal(classifyFailure(row), 'retrieval')
  assert.equal(classifyFailure({...row, retainedEvidence: false}), 'ingestion')
  assert.equal(classifyFailure({...row, evidence: {denominator: 1, retrieved: 1}}), 'answer')
  assert.equal(classifyFailure({...row, unanswerable: true}), 'answer')
  assert.equal(classifyFailure({...row, judgedCorrect: null}), null)
  assert.equal(classifyFailure({...row, outcome: 'failed'}), 'provider')
})
