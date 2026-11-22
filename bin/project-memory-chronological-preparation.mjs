// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {weightedRank} from './project-memory-df-ranking.mjs'
import {selectHoldout} from './project-memory-heldout-ranking.mjs'
import {historyWithOffsets, ingestionPlan} from './project-memory-ingestion-study-core.mjs'
import {digest} from './project-memory-ingestion-study-trace.mjs'
import {dataset, selectCases} from './project-memory-pilot.mjs'
import {stagePair} from './project-memory-source-diversity.mjs'
import {packingReplay, readPinnedDataset} from './project-memory-turn-packing.mjs'

const orderedPin = 'b4b8487e4a591df633857167ab92d40ece3f5129c9e7549b7cf9d63d0a92368f'
const namespace = 'orbit-chronological-preparation-v1'
const compare = (a, b) => (a < b ? -1 : Number(a > b))
const hash = (row) => digest(`${namespace}:${row.question_id}`)
const abstains = (row) => row.question_id.endsWith('_abs')

export function freshCohort(input) {
  const pilot = selectCases(input)
  const holdout = selectHoldout(input, new Set(pilot.map((row) => row.question_id)))
  const excluded = new Set([...pilot, ...holdout].map((row) => row.question_id))
  assert.equal(excluded.size, 130)
  assert.equal(sampleDigest(pilot), 'b72fedf8e7b2d95eaf8d991a0057d9c642dc80ce01096c98d3a18486b8a33690')
  assert.equal(sampleDigest(holdout), 'f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b')
  const types = [...new Set(input.map((row) => row.question_type))].sort(compare)
  assert.equal(types.length, 6)
  const groups = types.map((type) => {
    const pool = input
      .filter((row) => row.question_type === type && !excluded.has(row.question_id))
      .sort((a, b) => compare(hash(a), hash(b)))
    const abstentions = pool.filter((row) => abstains(row)).slice(0, 2)
    const answerable = pool.filter((row) => !abstains(row)).slice(0, 12 - abstentions.length)
    const selected = [...abstentions, ...answerable]
    assert(selected.length >= 8 && selected.length <= 12)
    return {abstentions: abstentions.length, answerable: answerable.length, selected, type}
  })
  const rows = groups.flatMap(({selected}) => selected)
  assert.equal(new Set(rows.map((row) => row.question_id)).size, rows.length)
  assert(!rows.some((row) => excluded.has(row.question_id)))
  return {counts: groups.map(({selected: _, ...counts}) => counts), excluded: excluded.size, rows}
}

function sampleDigest(rows) {
  return digest(JSON.stringify(rows.map((row) => row.question_id)))
}

export function dateIntent(question) {
  return /\b(?:currently|current|latest|most recent|right now|as of now|last time|last occasion|when did i last|when was the last)\b/iu.test(
    question,
  )
}

export function sourceTime(label) {
  const match = /^(?:History )?(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/u.exec(label)
  if (!match) return null
  const [, y, m, d, h, min] = match.map(Number)
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null
  const date = new Date(Date.UTC(y, m - 1, d, h, min))
  return date.getUTCDate() === d ? date.valueOf() : null
}

/** Move a single slot for admission only. Same positive rank pool and fixed top-12 gate. */
export function prioritize(ranked, question, date) {
  const cutoff = sourceTime(date)
  if (!dateIntent(question) || cutoff === null) return {candidates: ranked, promoted: false}
  const eligible = ranked.filter(({overlap}) => overlap > 0).slice(0, 12)
  let best
  let latest = -Infinity
  for (const candidate of eligible) {
    const time = sourceTime(candidate.entry.title)
    if (time === null || time > cutoff || time <= latest) continue
    latest = time
    best = candidate
  }

  if (!best || ranked[0] === best) return {candidates: ranked, promoted: false}
  return {candidates: [best, ...ranked.filter((candidate) => candidate !== best)], promoted: true}
}

const compared = ['available', 'positive', 'prepared', 'preparedTopSix', 'serialized']
function runCase(row) {
  const history = historyWithOffsets(row)
  const {admitted} = ingestionPlan(history, 'turn-chunks')
  const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
  const weights = (ranked) => weightedRank(ranked, query)
  const base = packingReplay(admitted, history, query, 'whole', weights)
  let promoted = false
  const trial = packingReplay(admitted, history, query, 'whole', {
    prepare(ranked) {
      const selection = prioritize(ranked, row.question, row.question_date)
      promoted = selection.promoted
      return selection.candidates
    },
    rank: weights,
  })
  assert.deepEqual(trial.stages.available, base.stages.available)
  assert.deepEqual(trial.stages.positive, base.stages.positive)
  assert(trial.costs.preparation <= 2048 && trial.costs.serialization <= 2048)
  assert(trial.stages.prepared.length <= 16 && trial.stages.serialized.length <= 6)
  if (!promoted) {
    assert.equal(trial.wire, base.wire, 'Unpromoted control changed its serialization')
    assert.deepEqual(trial.costs, base.costs)
  }

  const abstention = abstains(row)
  const gold = abstention
    ? []
    : history.flatMap(({originalIndex, turns}) =>
        turns
          .filter(({turnIndex}) => row.haystack_sessions[originalIndex][turnIndex]?.has_answer)
          .map((turn) => ({...turn, originalIndex})),
      )
  const cutoff = sourceTime(row.question_date)
  const wireFuture = (items) =>
    new Set(
      items
        .filter(({entry}) => {
          const time = sourceTime(entry.title)
          return time !== null && cutoff !== null && time > cutoff
        })
        .map(({entry}) => entry.id),
    )
  const baseFuture = wireFuture(base.stages.serialized)
  const trialFuture = wireFuture(trial.stages.serialized)
  const newFuture = [...trialFuture].filter((id) => !baseFuture.has(id)).length
  return {
    abstention,
    annotated: gold.length,
    costs: {baseline: base.costs, recent: trial.costs},
    future: {baseline: baseFuture.size, recent: trialFuture.size},
    intent: dateIntent(row.question),
    newFuture,
    promoted,
    stages: Object.fromEntries(
      compared.map((key) => {
        const {gained, lost, rank, sourceFirst} = stagePair(gold, base.stages[key], trial.stages[key])
        return [key, {baseline: rank, gained, lost, recent: sourceFirst}]
      }),
    ),
    type: row.question_type,
  }
}

const sum = (rows, fn) => rows.reduce((total, row) => total + Number(fn(row)), 0)
function summary(rows) {
  const totals = Object.fromEntries(
    compared.map((key) => {
      const values = rows.map((row) => row.stages[key])
      const arm = (name) => ({
        full: sum(values, (v) => v[name].full),
        slots: sum(values, (v) => v[name].slots),
        turns: sum(values, (v) => v[name].turns),
      })
      return [
        key,
        {
          baseline: arm('baseline'),
          fromFull: sum(values, ({baseline, recent}) => baseline.full && !recent.full),
          gained: sum(values, (v) => v.gained),
          lost: sum(values, (v) => v.lost),
          recent: arm('recent'),
          toFull: sum(values, ({baseline, recent}) => !baseline.full && recent.full),
        },
      ]
    }),
  )
  const spent = (arm) => ({
    futureWire: sum(rows, (row) => row.future[arm]),
    preparation: sum(rows, (row) => row.costs[arm].preparation),
    serialization: sum(rows, (row) => row.costs[arm].serialization),
  })
  return {
    annotated: sum(rows, (r) => r.annotated),
    baseline: spent('baseline'),
    cases: rows.length,
    intent: sum(rows, (r) => r.intent),
    newFuture: sum(rows, (r) => r.newFuture),
    promoted: sum(rows, (r) => r.promoted),
    recent: spent('recent'),
    stages: totals,
  }
}

async function main() {
  const args = process.argv.slice(2)
  assert(args.length === 0 || (args.length === 1 && args[0] === '--manifest'))
  const {counts, excluded, rows} = freshCohort(JSON.parse(await readPinnedDataset(process.stdin)))
  const orderedSha = sampleDigest(rows)
  assert.equal(orderedSha, orderedPin)
  const frozen = {counts, dataset, excluded, namespace, orderedSha}
  if (args[0] === '--manifest') {
    console.log(JSON.stringify(frozen, null, 2))
    return
  }

  const pairs = rows.map((row, index) => ({ordinal: index + 1, ...runCase(row)}))
  const answerable = pairs.filter((row) => !row.abstention)
  const targets = summary(answerable.filter(({type}) => ['knowledge-update', 'temporal-reasoning'].includes(type)))
  const wire = targets.stages.serialized
  const allAnswerable = summary(answerable)
  const abstention = summary(pairs.filter((row) => row.abstention))
  const go =
    wire.toFull >= 2 &&
    wire.toFull > wire.fromFull &&
    allAnswerable.newFuture === 0 &&
    abstention.newFuture === 0 &&
    abstention.recent.futureWire <= abstention.baseline.futureWire
  console.log(
    JSON.stringify(
      {
        abstention,
        answerable: allAnswerable,
        byType: Object.fromEntries(
          counts.map(({type}) => [type, summary(answerable.filter((row) => row.type === type))]),
        ),
        frozen,
        go,
        pairs,
        providerCalls: 0,
        targets,
        untreated: summary(pairs.filter((row) => !row.intent)),
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
