// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official dataset field names are exercised verbatim. */

import {describe, it} from 'mocha'
import assert from 'node:assert/strict'

import {
  classifyFailure,
  evaluatePilotRecord,
  evidenceCoverage,
  historyOnly,
  parseJudgment,
  pilotCommit,
  selectCases,
  summarize,
} from '../../bin/project-memory-pilot.mjs'

describe('Project memory pilot integrity', () => {
  it('history ingestion discards all QA, evidence annotations and revealing dataset IDs', () => {
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

  it('selects thirty cases reproducibly with six strata and abstentions independently of answers', () => {
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

  it('scores source-session evidence without promoting missing judgments to measured accuracy', () => {
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

  it('rejects malformed judge output rather than converting it into a score', () => {
    assert.deepEqual(parseJudgment('{"correct":[true,false,true]}'), [true, false, true])
    for (const text of ['not JSON', '{"correct":[true]}', '{"correct":[1,0,1]}']) {
      assert.throws(() => parseJudgment(text))
    }
  })

  it('distinguishes ingestion, retrieval, answer and execution failures', () => {
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

  it('validates explicit commit provenance without launching PATH executables', () => {
    assert.equal(pilotCommit([]), null)
    assert.equal(pilotCommit(['--commit', 'a'.repeat(40)]), 'a'.repeat(40))
    for (const value of [undefined, 'HEAD', '$(private-command)', '../git', 'A'.repeat(40)]) {
      assert.throws(() => pilotCommit(['--commit', value]))
    }
  })

  it('preserves summary denominators, abstention and failure classifications', () => {
    const base = {
      abstained: true,
      arm: 'none',
      category: 'preference',
      dispatches: 0,
      evidence: {denominator: 2, retrieved: 1},
      failure: 'answer',
      inputTokens: 2,
      judgedCorrect: true,
      latencyMs: 5,
      outputTokens: 3,
      proxyCorrect: true,
      unanswerable: true,
    }
    const groups = summarize([
      base,
      {...base, dispatches: 2, failure: 'retrieval', judgedCorrect: false, unanswerable: false},
      {...base, abstained: false, failure: 'provider', judgedCorrect: null, unanswerable: false},
    ])
    const group = groups['none/all']
    assert.deepEqual(group, groups['none/preference'])
    assert.equal(group.n, 3)
    assert.equal(group.gradedN, 2)
    assert.equal(group.accuracy, 0.5)
    assert.equal(group.evidenceDenominator, 4)
    assert.equal(group.evidenceRecall, 0.5)
    assert.equal(group.abstentionAccuracy, 1)
    assert.equal(group.dispatchRate, 1 / 3)
    assert.deepEqual(group.failures, {answer: 1, ingestion: 0, provider: 1, retrieval: 1})
    assert.equal(group.meanLatencyMs, 5)
    assert.equal(group.inputTokens, 6)
    assert.equal(group.outputTokens, 9)
  })

  it('keeps record labels and source annotations evaluation-only after extraction', () => {
    const row = {
      answer: 'cobalt',
      answer_session_ids: ['a'],
      haystack_session_ids: ['a'],
      haystack_sessions: [[{content: 'Use cobalt', has_answer: true}]],
      question_id: 'case',
      question_type: 'preference',
    }
    const ingested = [{entryId: 'entry', excerpt: 'user: Use cobalt', originalIndex: 0}]
    const result = {answer: 'cobalt', outcome: 'completed', retrieved: ['entry']}
    const record = evaluatePilotRecord(row, ingested, result, true)
    assert.equal(record.retainedEvidence, true)
    assert.equal(record.failure, null)
    assert.equal(record.proxyCorrect, true)
    assert.equal(record.judgedCorrect, true)
    assert.deepEqual(record.evidence, {denominator: 1, ingested: 1, retrieved: 1})
  })
})
