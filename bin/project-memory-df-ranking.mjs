// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {historyWithOffsets, ingestionPlan} from './project-memory-ingestion-study-core.mjs'
import {stagePair} from './project-memory-source-diversity.mjs'
import {packingReplay, readPinnedCases} from './project-memory-turn-packing.mjs'

// Match the runtime lexical units, including the final CJK character; do not extend the runtime API.
export function lexicalTerms(text) {
  const tokens =
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[a-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []
  return new Set(
    tokens.flatMap((token) => {
      if (/^[a-z0-9_]+$/u.test(token)) return [token]
      const chars = [...token]
      return chars.map((char, i) => char + (chars[i + 1] ?? ''))
    }),
  )
}

export function weightedRank(ranked, query) {
  const terms = lexicalTerms(query)
  const documentFrequency = new Map()
  const matched = ranked.map(({entry, overlap}) => {
    const words = lexicalTerms(
      `${entry.title} ${entry.body} ${entry.automatic?.condition ?? ''} ${entry.automatic?.evidence ?? ''}`,
    )
    const matches = [...terms].filter((word) => words.has(word))
    assert.equal(matches.length, overlap, 'Evaluation lexical terms disagree with runtime overlap')
    for (const term of matches) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    return matches
  })

  const weights = new Map(
    [...documentFrequency].map(([term, count]) => [term, 1 + Math.log((ranked.length + 1) / (count + 1))]),
  )
  // The original rank is the stable tie-break, including all zero-overlap entries.
  return ranked
    .map((candidate, i) => ({candidate, score: matched[i].reduce((sum, term) => sum + weights.get(term), 0)}))
    .sort((a, b) => b.score - a.score)
    .map(({candidate}) => candidate)
}

const stages = ['rankedTopSix', 'prepared', 'preparedTopSix', 'serialized']

function pairStage(gold, before, after) {
  const {gained, lost, rank, sourceFirst: weighted} = stagePair(gold, before, after)
  return {gained, lost, rank, weighted}
}

function compareCase(row, condition, mode) {
  const history = historyWithOffsets(row)
  const {admitted} = ingestionPlan(history, condition)
  const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
  const rank = packingReplay(admitted, history, query, mode)
  const weighted = packingReplay(admitted, history, query, mode, (ranked) => weightedRank(ranked, query))
  for (const trial of [rank, weighted]) {
    assert(trial.costs.preparation <= 2048 && trial.costs.serialization <= 2048)
    assert(trial.stages.prepared.length <= 16 && trial.stages.serialized.length <= 6)
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
    annotated: gold.length,
    costs: {rank: rank.costs, weighted: weighted.costs},
    stages: Object.fromEntries(
      stages.map((stage) => [stage, pairStage(gold, rank.stages[stage], weighted.stages[stage])]),
    ),
  }
}

const sum = (rows, pick) => rows.reduce((total, row) => total + Number(pick(row)), 0)
function summarizeStage(pairs) {
  const totals = (arm) =>
    Object.fromEntries(
      ['turns', 'full', 'sources', 'relevantSources', 'slots'].map((key) => [key, sum(pairs, (r) => r[arm][key])]),
    )
  return {
    fromFull: sum(pairs, ({rank, weighted}) => rank.full && !weighted.full),
    gained: sum(pairs, (r) => r.gained),
    lost: sum(pairs, (r) => r.lost),
    netDown: sum(pairs, ({gained, lost}) => gained < lost),
    netUp: sum(pairs, ({gained, lost}) => gained > lost),
    rank: totals('rank'),
    swappedAtSameCount: sum(pairs, ({gained, lost}) => gained > 0 && gained === lost),
    toFull: sum(pairs, ({rank, weighted}) => !rank.full && weighted.full),
    weighted: totals('weighted'),
  }
}

function summarize(rows) {
  const costs = (arm) =>
    Object.fromEntries(['preparation', 'serialization'].map((key) => [key, sum(rows, (r) => r.costs[arm][key])]))
  return {
    annotated: sum(rows, (r) => r.annotated),
    cases: rows.length,
    costs: {rank: costs('rank'), weighted: costs('weighted')},
    stages: Object.fromEntries(stages.map((stage) => [stage, summarizeStage(rows.map((r) => r.stages[stage]))])),
  }
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node bin/project-memory-df-ranking.mjs < /path/to/longmemeval_s_cleaned.json',
  )
  const rows = await readPinnedCases(process.stdin)
  const output = {}
  for (const [condition, mode] of [
    ['turn-chunks', 'whole'],
    ['turn-chunks', 'both'],
    ['prefix', 'whole'],
  ]) {
    const pairs = rows.map((row, index) => ({ordinal: index + 1, ...compareCase(row, condition, mode)}))
    const answerable = summarize(pairs.filter(({abstention}) => !abstention))
    const abstention = summarize(pairs.filter(({abstention}) => abstention))
    assert.equal(answerable.annotated, 47)
    assert.equal(answerable.cases, 26)
    assert.equal(abstention.cases, 4)
    output[`${condition}/${mode}`] = {abstention, answerable, perQuestion: pairs}
  }

  console.log(JSON.stringify({output, providerCalls: 0}, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
