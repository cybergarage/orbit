// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official dataset field names. */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  annotationCoverage,
  historyWithOffsets,
  ingestionPlan,
  limits,
  replaySelection,
} from '../../bin/project-memory-ingestion-study-core.mjs'
import {deliveredIds} from '../../bin/project-memory-ingestion-study-trace.mjs'
import {createStudyOutput, evaluateStudyCase, studySummary} from '../../bin/project-memory-ingestion-study.mjs'

function fixture(sessions) {
  return {
    answer: 'Private reference sentinel',
    answer_session_ids: ['answer_sentinel'],
    haystack_dates: sessions.map((_, n) => `2025-01-${String(n + 1).padStart(3, '0')}`),
    haystack_session_ids: sessions.map(() => 'answer_sentinel'),
    haystack_sessions: sessions,
    question: 'What is the catalog status?',
    question_date: '2026-01-01',
    question_id: 'fixture',
  }
}

function turn(content, hasAnswer = false) {
  return {content, has_answer: hasAnswer, role: 'user'}
}

const mockArm = (judgedCorrect) => ({
  arm: 'tool',
  coverage: {complete: 0},
  judgedCorrect,
  outcome: 'completed',
  outcomes: {terminal: {outcome: 'completed'}},
  searches: [],
  wireRequests: [],
})

const mockCondition = (a) => ({
  admitted: {annotated: 1, complete: 1},
  observed: [mockArm(a)],
  omissions: {},
  state: 'completed',
})

describe('Evaluation-only paired LongMemEval ingestion study', () => {
  it('preserves the exact historical UTF-16 prefix, and aligns repeated or late text with its actual turn', () => {
    const row = fixture([[turn('cobalt catalog'), turn('🙂'.repeat(601)), turn('cobalt catalog', true)]])
    const h = historyWithOffsets(row)
    assert.deepEqual(
      historyWithOffsets({...row, answer: 'other', haystack_session_ids: ['other'], question: 'other'}),
      h,
    )
    const scrubbed = {
      ...row,
      haystack_sessions: row.haystack_sessions.map((s) => s.map((t) => ({...t, has_answer: !t.has_answer}))),
    }
    assert.deepEqual(historyWithOffsets(scrubbed), h)
    assert.ok(!JSON.stringify(h).includes('answer_sentinel'))
    assert.ok(!JSON.stringify(h).includes('has_answer'))
    const a = ingestionPlan(h, 'prefix')
    const b = ingestionPlan(h, 'turn-chunks')
    assert.equal(a.admitted[0].excerpt, h[0].text.slice(0, 1200))
    assert.equal(a.admitted[0].end, 1200)
    assert.deepEqual(annotationCoverage(row, h, a.admitted), {annotated: 1, complete: 0})
    assert.deepEqual(annotationCoverage(row, h, b.admitted), {annotated: 1, complete: 1})
    for (const item of b.admitted) assert.equal(item.excerpt, h[item.originalIndex].text.slice(item.start, item.end))
  })

  it('uses intact within-session turns, evenly admits first chunks under the Core cap, and reports oversized turns', () => {
    const row = fixture(Array.from({length: 65}, () => [turn('a'.repeat(3000)), turn('b'.repeat(3000), true)]))
    row.haystack_sessions[0].push(turn('🙂'.repeat(2100), true))
    const h = historyWithOffsets(row)
    const {admitted, omitted} = ingestionPlan(h, 'turn-chunks')
    assert.equal(admitted.length, limits.entries)
    assert.equal(admitted.filter((item) => item.turns.includes(0)).length, 65)
    assert.equal(omitted.filter((item) => item.reason === 'project-entry-cap').length, 2)
    assert.equal(omitted.filter((item) => item.reason === 'oversize-turn').length, 1)
    assert.ok(admitted.every((i) => Buffer.byteLength(i.excerpt) <= limits.bodyBytes))
    assert.ok(admitted.reduce((n, i) => n + Buffer.byteLength(i.excerpt), 0) <= limits.projectBytes)
  })

  it('replays canonical preparation and serialized limits without delivering results or inventing grades', async () => {
    const row = fixture([[turn('catalog status cobalt', true)], [turn('different topic')]])
    const h = historyWithOffsets(row)
    const plan = ingestionPlan(h, 'prefix')
    const selected = replaySelection(plan.admitted, 'catalog status')
    assert.deepEqual(replaySelection(plan.admitted, 'catalog status'), selected)
    assert.equal(selected.ranked.length, 2)
    assert.equal(selected.topSixIds.length, 1)
    assert.deepEqual(selected.returnedIds, selected.topSixIds)
    const caseA = await evaluateStudyCase(row, 0, 'replay')
    const caseB = await evaluateStudyCase(row, 0, 'replay')
    assert.deepEqual(caseA, caseB)
    const summary = studySummary([caseA], 'replay', 30)
    assert.equal(summary.pairedCompleted, 1)
    assert.equal(summary.pairedEligibleByArm.tool.eligible, 0)
    assert.equal(summary.conditions.prefix.answerableQuestionsWithAnnotations, 1)
    assert.equal(summary.conditions.prefix.returnedAnnotatedTurnsInReplay, 1)
    const abs = {...row, question_id: 'fixture_abs'}
    assert.deepEqual(annotationCoverage(abs, h, plan.admitted), {annotated: 0, complete: 0})
  })

  it('observes canonical search and the exact mapped mock request without claiming provider delivery', async () => {
    const result = await evaluateStudyCase(fixture([[turn('catalog status cobalt', true)]]), 0, 'mock')
    for (const condition of ['prefix', 'turn-chunks']) {
      assert.equal(result[condition].state, 'completed')
      for (const name of ['pre', 'tool']) {
        const arm = result[condition].observed.find((item) => item.arm === name)
        assert.equal(arm.outcome, 'completed')
        assert.equal(arm.searches.length, 1)
        const [search] = arm.searches
        assert.equal(search.ranked.length, 1)
        assert.equal(search.returnedIds.length, 1)
        assert.deepEqual(search.returnedIds, search.preparedIds)
        assert.equal(search.returnedIds[0], result[condition].mapping[0].entryId)
        assert.ok(
          arm.wireRequests.some((wire) =>
            wire.evidence.some((item) => item.idMatch && item.returnedIds[0] === search.returnedIds[0]),
          ),
        )
        assert.deepEqual(deliveredIds(arm), [])
        assert.equal(arm.judgedCorrect, null)
        assert.equal(arm.outcomes.terminal.outcome, 'completed')
      }
    }
  })

  it('does not count a submitted but rejected request or unmatched result as delivered', () => {
    const evidence = [
      {idMatch: true, returnedIds: ['matched']},
      {idMatch: false, returnedIds: ['unmatched']},
    ]
    const trace = {
      wireRequests: [
        {evidence, replyReturned: false, route: 'ollama'},
        {evidence, replyReturned: null, route: 'mock'},
      ],
    }
    assert.deepEqual(deliveredIds(trace), [])
    trace.wireRequests.push({evidence, replyReturned: true, route: 'ollama'})
    assert.deepEqual(deliveredIds(trace), ['matched'])
  })

  it('counts only paired completed judgments in each arm and leaves failed or missing cases visible', () => {
    const summary = studySummary(
      [
        {prefix: mockCondition(false), 'turn-chunks': mockCondition(true)},
        {prefix: mockCondition(null), 'turn-chunks': mockCondition(true)},
        {prefix: {state: 'failed'}, 'turn-chunks': mockCondition(false)},
      ],
      'live',
      30,
    )
    assert.equal(summary.planned, 30)
    assert.equal(summary.recorded, 3)
    assert.equal(summary.pairedCompleted, 2)
    assert.equal(summary.conditions.prefix.failed, 1)
    assert.deepEqual(summary.pairedEligibleByArm.tool, {
      bothCorrect: 0,
      bothWrong: 0,
      eligible: 1,
      prefixOnly: 0,
      turnChunksOnly: 1,
    })
  })

  it('creates a fresh private trace directory only beneath the ignored workspace location', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-ingestion-study-fixture-'))
    try {
      await fs.mkdir(path.join(root, 'tmp'))
      const out = await createStudyOutput('tmp/traces', root)
      assert.equal(await fs.realpath(out), path.join(await fs.realpath(root), 'tmp', 'traces'))
      if (process.platform !== 'win32') assert.equal((await fs.stat(out)).mode % 0o100, 0)
      await assert.rejects(() => createStudyOutput('tmp/traces', root))
      await assert.rejects(() => createStudyOutput('../public', root))
      await assert.rejects(() => createStudyOutput('tmp/traces/nested', root))
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
