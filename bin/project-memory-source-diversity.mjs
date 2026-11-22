// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {historyWithOffsets, ingestionPlan} from './project-memory-ingestion-study-core.mjs'
import {packingReplay, readPinnedCases} from './project-memory-turn-packing.mjs'

/** Diversify only within the positive-overlap tier; keep source and backfill order stable. */
export function sourceFirst(ranked) {
  const seen = new Set()
  const head = []
  const tail = []
  const unscored = []
  for (const candidate of ranked) {
    const source = candidate.item.originalIndex
    if (candidate.overlap <= 0) unscored.push(candidate)
    else if (seen.has(source)) tail.push(candidate)
    else {
      seen.add(source)
      head.push(candidate)
    }
  }

  return [...head, ...tail, ...unscored]
}

function annotations(row, history) {
  if (row.question_id.endsWith('_abs')) return []
  return history.flatMap(({originalIndex, turns}) =>
    turns
      .filter(({turnIndex}) => row.haystack_sessions[originalIndex][turnIndex]?.has_answer)
      .map((turn) => ({...turn, originalIndex})),
  )
}

export function stagePair(annotations, baseline, diversified) {
  const relevant = new Set(annotations.map(({originalIndex}) => originalIndex))
  function observe(candidates) {
    const items = candidates.map(({item}) => item)
    const sources = new Set(items.map(({originalIndex}) => originalIndex))
    const covered = annotations.map((turn) =>
      items.some(
        ({end, originalIndex, start}) => originalIndex === turn.originalIndex && end >= turn.end && start <= turn.start,
      ),
    )
    return {
      covered,
      full: covered.length > 0 && covered.every(Boolean),
      relevantSources: [...sources].filter((source) => relevant.has(source)).length,
      slots: items.length,
      sources: sources.size,
      turns: covered.filter(Boolean).length,
    }
  }

  const {covered: before, ...rank} = observe(baseline)
  const {covered: after, ...sourceFirst} = observe(diversified)
  return {
    gained: after.filter((present, i) => present && !before[i]).length,
    lost: before.filter((present, i) => present && !after[i]).length,
    rank,
    sourceFirst,
  }
}

const comparedStages = ['rankedTopSix', 'prepared', 'preparedTopSix', 'serialized']

function compareCase(row, condition, arm) {
  const history = historyWithOffsets(row)
  const {admitted} = ingestionPlan(history, condition)
  const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
  const rank = packingReplay(admitted, history, query, arm)
  const diverse = packingReplay(admitted, history, query, arm, sourceFirst)
  assert.equal(rank.stages.available.length, diverse.stages.available.length)
  const scores = new Map(rank.stages.available.map(({entry, overlap}) => [entry.id, overlap]))
  assert(diverse.stages.available.every(({entry, overlap}) => scores.get(entry.id) === overlap))
  for (const trial of [rank, diverse]) {
    assert(trial.costs.preparation <= 2048 && trial.costs.serialization <= 2048)
    assert(trial.stages.prepared.length <= 16 && trial.stages.serialized.length <= 6)
  }

  // Gold annotations cannot be read until both selections have finished.
  const gold = annotations(row, history)
  const abstention = row.question_id.endsWith('_abs')
  assert(abstention || gold.length > 0)
  return {
    abstention,
    annotatedTurns: gold.length,
    costs: {rank: rank.costs, sourceFirst: diverse.costs},
    stages: Object.fromEntries(
      comparedStages.map((key) => [key, stagePair(gold, rank.stages[key], diverse.stages[key])]),
    ),
  }
}

const sum = (values) => values.reduce((a, b) => a + b, 0)

function summarize(rows) {
  const perStage = comparedStages.map((stage) => {
    const pairs = rows.map((row) => row.stages[stage])
    const metricTotals = (arm) =>
      Object.fromEntries(
        ['turns', 'sources', 'relevantSources', 'slots', 'full'].map((key) => [
          key,
          sum(pairs.map((pair) => Number(pair[arm][key]))),
        ]),
      )
    return [
      stage,
      {
        fromFull: pairs.filter(({rank, sourceFirst}) => rank.full && !sourceFirst.full).length,
        netDown: pairs.filter(({gained, lost}) => gained < lost).length,
        netUp: pairs.filter(({gained, lost}) => gained > lost).length,
        rank: metricTotals('rank'),
        sameCountChangedEvidence: pairs.filter(({gained, lost}) => gained > 0 && gained === lost).length,
        sourceFirst: metricTotals('sourceFirst'),
        toFull: pairs.filter(({rank, sourceFirst}) => !rank.full && sourceFirst.full).length,
        turnGains: sum(pairs.map((pair) => pair.gained)),
        turnLosses: sum(pairs.map((pair) => pair.lost)),
      },
    ]
  })
  const tokenTotals = (arm) =>
    Object.fromEntries(
      ['preparation', 'serialization'].map((key) => [key, sum(rows.map(({costs}) => costs[arm][key]))]),
    )
  return {
    annotatedTurns: sum(rows.map((row) => row.annotatedTurns)),
    cases: rows.length,
    stages: Object.fromEntries(perStage),
    tokens: {rank: tokenTotals('rank'), sourceFirst: tokenTotals('sourceFirst')},
  }
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node bin/project-memory-source-diversity.mjs < /path/to/longmemeval_s_cleaned.json',
  )
  const rows = await readPinnedCases(process.stdin)
  const output = {}
  for (const [condition, arm] of [
    ['turn-chunks', 'whole'],
    ['prefix', 'whole'],
    ['turn-chunks', 'both'],
  ]) {
    const compared = rows.map((row, index) => ({ordinal: index + 1, ...compareCase(row, condition, arm)}))
    const answerable = summarize(compared.filter((row) => !row.abstention))
    const abstention = summarize(compared.filter((row) => row.abstention))
    assert.equal(answerable.cases, 26)
    assert.equal(answerable.annotatedTurns, 47)
    assert.equal(abstention.cases, 4)
    output[`${condition}/${arm}`] = {abstention, answerable, perQuestion: compared}
  }

  console.log(JSON.stringify({output, providerCalls: 0}, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
