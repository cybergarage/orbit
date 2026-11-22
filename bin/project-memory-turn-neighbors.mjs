// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {projectMemoryOverlap} from '../dist/core/projects/memory-context.js'
import {manifest, selectHoldout} from './project-memory-heldout-ranking.mjs'
import {historyWithOffsets, ingestionPlan} from './project-memory-ingestion-study-core.mjs'
import {selectCases} from './project-memory-pilot.mjs'
import {stagePair} from './project-memory-source-diversity.mjs'
import {packingReplay, readPinnedDataset} from './project-memory-turn-packing.mjs'

/** A fixed single anchor per admitted chunk, determined solely by body overlap. */
export function anchorPlan(admitted, history, query) {
  const bySource = new Map(history.map((row) => [row.originalIndex, row]))
  return admitted.map((item, index) => {
    const {text, turns} = bySource.get(item.originalIndex)
    const complete = turns.filter(({end, start}) => start >= item.start && end <= item.end)
    assert(complete.length > 0, 'Turn-chunk inputs must contain a complete turn')
    const scored = complete.map(({end, start}) =>
      projectMemoryOverlap(query, {body: text.slice(start, end), title: ''}),
    )
    const overlap = Math.max(...scored)
    const anchor = scored.indexOf(overlap)
    const itemAt = (first, last) => {
      const {start} = complete[first]
      const {end} = complete[last]
      return {...item, end, excerpt: text.slice(start, end), start}
    }

    return {
      anchorOnly: itemAt(anchor, anchor),
      index,
      neighbors: itemAt(Math.max(0, anchor - 1), Math.min(complete.length - 1, anchor + 1)),
      overlap,
    }
  })
}

function replayWindows(plan, history, query, field) {
  const admitted = plan.map((row) => row[field])
  const scores = new Map(admitted.map((item, index) => [item, plan[index]]))
  return packingReplay(admitted, history, query, 'whole', (ranked) =>
    ranked
      .map((candidate) => ({...candidate, overlap: scores.get(candidate.item).overlap}))
      .sort((a, b) => b.overlap - a.overlap || scores.get(b.item).index - scores.get(a.item).index),
  )
}

function pair(gold, before, after) {
  const {gained, lost, rank, sourceFirst} = stagePair(gold, before, after)
  return {after: sourceFirst, before: rank, gained, lost}
}

function trial(row) {
  const history = historyWithOffsets(row)
  const {admitted} = ingestionPlan(history, 'turn-chunks')
  const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
  const baseline = packingReplay(admitted, history, query, 'whole')
  const plan = anchorPlan(admitted, history, query)
  const anchorOnly = replayWindows(plan, history, query, 'anchorOnly')
  const neighbors = replayWindows(plan, history, query, 'neighbors')
  assert.deepEqual(
    anchorOnly.stages.available.map(({entry, overlap}) => [entry.id, overlap]),
    neighbors.stages.available.map(({entry, overlap}) => [entry.id, overlap]),
  )
  for (const arm of [baseline, anchorOnly, neighbors]) {
    assert(arm.costs.preparation <= 2048 && arm.costs.serialization <= 2048)
    assert(arm.stages.prepared.length <= 16 && arm.stages.serialized.length <= 6)
  }

  const abstention = row.question_id.endsWith('_abs')
  const gold = abstention
    ? []
    : history.flatMap(({originalIndex, turns}) =>
        turns
          .filter(({turnIndex}) => row.haystack_sessions[originalIndex][turnIndex]?.has_answer)
          .map((turn) => ({...turn, originalIndex})),
      )
  return {
    abstention,
    anchorVsBase: pair(gold, baseline.stages.serialized, anchorOnly.stages.serialized),
    annotated: gold.length,
    neighborVsAnchor: pair(gold, anchorOnly.stages.serialized, neighbors.stages.serialized),
    neighborVsBase: pair(gold, baseline.stages.serialized, neighbors.stages.serialized),
    tokenCosts: {anchorOnly: anchorOnly.costs, baseline: baseline.costs, neighbors: neighbors.costs},
    type: row.question_type,
  }
}

const total = (rows, select) => rows.reduce((sum, row) => sum + Number(select(row)), 0)
const comparisons = ['anchorVsBase', 'neighborVsAnchor', 'neighborVsBase']

function summary(rows) {
  const measures = ['full', 'turns', 'slots', 'sources', 'relevantSources']
  const arms = ['baseline', 'anchorOnly', 'neighbors']
  const changes = Object.fromEntries(
    comparisons.map((comparison) => {
      const pairs = rows.map((row) => row[comparison])
      const totals = (side) => Object.fromEntries(measures.map((key) => [key, total(pairs, (row) => row[side][key])]))
      return [
        comparison,
        {
          after: totals('after'),
          before: totals('before'),
          fromFull: total(pairs, ({after, before}) => before.full && !after.full),
          gained: total(pairs, (row) => row.gained),
          lost: total(pairs, (row) => row.lost),
          toFull: total(pairs, ({after, before}) => !before.full && after.full),
        },
      ]
    }),
  )
  const tokens = Object.fromEntries(
    arms.map((arm) => [
      arm,
      {
        preparation: total(rows, (row) => row.tokenCosts[arm].preparation),
        serialization: total(rows, (row) => row.tokenCosts[arm].serialization),
      },
    ]),
  )
  return {annotated: total(rows, (row) => row.annotated), cases: rows.length, changes, tokens}
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node bin/project-memory-turn-neighbors.mjs < /path/to/longmemeval_s_cleaned.json',
  )
  const input = JSON.parse(await readPinnedDataset(process.stdin))
  const pilot = selectCases(input)
  const holdout = selectHoldout(input, new Set(pilot.map((row) => row.question_id)))
  const frozen = manifest(holdout, pilot)
  assert.equal(frozen.orderedHoldoutSha256, 'f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b')
  assert.equal(frozen.orderedPilotSha256, 'b72fedf8e7b2d95eaf8d991a0057d9c642dc80ce01096c98d3a18486b8a33690')
  const paired = holdout.map((row, index) => ({ordinal: index + 1, ...trial(row)}))
  const aggregate = {
    abstention: summary(paired.filter((row) => row.abstention)),
    answerable: summary(paired.filter((row) => !row.abstention)),
    byType: Object.fromEntries(
      Object.keys(frozen.counts).map((type) => [
        type,
        {
          abstention: summary(paired.filter((row) => row.type === type && row.abstention)),
          answerable: summary(paired.filter((row) => row.type === type && !row.abstention)),
        },
      ]),
    ),
  }
  assert.equal(aggregate.abstention.cases, 8)
  assert.equal(aggregate.answerable.cases, 92)
  assert.equal(aggregate.answerable.annotated, 162)
  console.log(JSON.stringify({aggregate, manifest: frozen, paired, providerCalls: 0}, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
