// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {renderProjectMemory} from '../dist/core/projects/memory-context.js'
import {GptTokenizer} from '../dist/core/tokenizer/index.js'
import {
  annotationCoverage,
  historyWithOffsets,
  ingestionPlan,
  rankCandidates,
  replayFixture,
  replaySelection,
} from './project-memory-ingestion-study-core.mjs'
import {digest} from './project-memory-ingestion-study-trace.mjs'
import {dataset, selectCases} from './project-memory-pilot.mjs'

const queryDigest = 'b72fedf8e7b2d95eaf8d991a0057d9c642dc80ce01096c98d3a18486b8a33690'
const bytesPinned = 277_383_467
const budget = 2048
const arms = ['whole', 'prepare', 'serialize', 'both']

/** Metadata and slot identity stay fixed. Only complete leading turns may survive. */
export function completePrefixes(item, history) {
  const source = history.get(item.originalIndex)
  if (!source) return []
  const turns = source.turns.filter(({end, start}) => start >= item.start && end <= item.end)
  if (turns[0]?.start !== item.start) return []
  return turns.map(({end}) => ({...item, end, excerpt: source.text.slice(item.start, end)})).reverse()
}

export function admit(candidates, {cap, limit, measure, mode, stopOnMiss = false}) {
  const included = []
  for (const candidate of candidates) {
    if (included.length === limit) break
    const variants = mode === 'pack' ? candidate.prefixes : [candidate.item]
    const chosen = variants.find(
      (item) => measure([...included, {...candidate, entry: {...candidate.entry, body: item.excerpt}, item}]) <= cap,
    )
    if (chosen) included.push({...candidate, entry: {...candidate.entry, body: chosen.excerpt}, item: chosen})
    else if (stopOnMiss) break
  }

  return included
}

export function serializeEvidence(project, items) {
  return JSON.stringify({
    generation: project.memoryGeneration,
    projectId: project.id,
    results: items.map((item) => item.entry),
    truncated: false,
    trust: 'untrusted-memory-evidence',
  })
}

export function packingReplay(admitted, baselineHistory, query, arm, order = (ranked) => ranked) {
  const tokenizer = new GptTokenizer()
  assert(arms.includes(arm), 'Unknown packing arm')
  const catalog = replayFixture(admitted)
  const index = new Map(catalog.entries.map((entry, i) => [entry.id, admitted[i]]))
  const history = new Map(baselineHistory.map(({originalIndex, text, turns}) => [originalIndex, {text, turns}]))
  const ranked = rankCandidates(catalog.entries, query).map(({entry, overlap}) => {
    const item = index.get(entry.id)
    return {entry, item, overlap, prefixes: completePrefixes(item, history)}
  })
  const candidates = order(ranked)
  const prepTokens = (items) =>
    tokenizer.encode(
      renderProjectMemory(
        catalog.project.id,
        items.map((x) => x.entry),
      ),
    ).length
  const wireTokens = (items) => tokenizer.encode(serializeEvidence(catalog.project, items)).length
  const prepared = admit(candidates, {
    cap: budget,
    limit: 16,
    measure: prepTokens,
    mode: arm === 'prepare' || arm === 'both' ? 'pack' : 'whole',
  })
  const preparedTopSix = prepared.filter((v) => v.overlap > 0).slice(0, 6)
  // Do not recover turns omitted by preparation or replace a lost slot with rank seven.
  const resultCandidates = preparedTopSix.map((v) => ({
    ...v,
    prefixes: v.prefixes.filter(({end}) => end <= v.item.end),
  }))
  const serialized = admit(resultCandidates, {
    cap: budget,
    limit: 6,
    measure: wireTokens,
    mode: arm === 'serialize' || arm === 'both' ? 'pack' : 'whole',
    stopOnMiss: true,
  })
  return {
    costs: {preparation: prepTokens(prepared), serialization: wireTokens(serialized)},
    stages: {
      available: candidates,
      positive: candidates.filter((x) => x.overlap > 0),
      prepared,
      preparedTopSix,
      rankedTopSix: candidates.filter((x) => x.overlap > 0).slice(0, 6),
      serialized,
    },
    wire: serializeEvidence(catalog.project, serialized),
  }
}

const stageCounters = () => ({
  annotated: 0,
  answerable: 0,
  answersWithAll: 0,
  answersWithAny: 0,
  complete: 0,
  entries: 0,
  sourceSessions: 0,
})
function addStage(out, row, history, candidates) {
  const spans = candidates.map((x) => x.item)
  const {annotated, complete} = annotationCoverage(row, history, spans)
  out.annotated += annotated
  out.complete += complete
  out.answerable += Number(annotated > 0)
  out.answersWithAny += Number(complete > 0)
  out.answersWithAll += Number(annotated > 0 && complete === annotated)
  out.entries += spans.length
  out.sourceSessions += new Set(spans.map((item) => item.originalIndex)).size
}

export async function readPinnedDataset(stream) {
  const chunks = []
  let count = 0
  for await (const chunk of stream) {
    assert(Buffer.isBuffer(chunk), 'Expected binary streaming input')
    count += chunk.byteLength
    assert(count <= bytesPinned, 'Dataset size mismatch')
    chunks.push(chunk)
  }

  assert.equal(count, bytesPinned, 'Dataset size mismatch')
  const bytes = Buffer.concat(chunks, count)
  assert.equal(digest(bytes), dataset.sha256, 'Dataset checksum mismatch')
  return bytes
}

const entryIds = (cs) => cs.map((r) => r.entry.id)

export async function readPinnedCases(stream) {
  const rows = selectCases(JSON.parse(await readPinnedDataset(stream)))
  assert.equal(rows.length, 30)
  assert.equal(digest(JSON.stringify(rows.map((r) => r.question_id))), queryDigest)
  return rows
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node bin/project-memory-turn-packing.mjs < /path/to/longmemeval_s_cleaned.json',
  )
  const rows = await readPinnedCases(process.stdin)
  const outputs = {}
  for (const condition of ['prefix', 'turn-chunks']) {
    const measures = Object.fromEntries(
      arms.map((arm) => [arm, {cases: 0, stages: {}, tokenTotals: {preparation: 0, serialization: 0}}]),
    )
    for (const row of rows) {
      const history = historyWithOffsets(row)
      const {admitted} = ingestionPlan(history, condition)
      const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
      let rankIds
      for (const arm of arms) {
        const {costs, stages} = packingReplay(admitted, history, query, arm)
        if (arm === 'whole') {
          const baseline = replaySelection(admitted, query)
          assert.deepEqual(entryIds(stages.prepared), baseline.preparedIds)
          assert.deepEqual(entryIds(stages.serialized), baseline.returnedIds)
          assert.deepEqual(entryIds(stages.rankedTopSix), baseline.topSixIds)
          rankIds = entryIds(stages.available)
        } else assert.deepEqual(entryIds(stages.available), rankIds)
        assert(costs.preparation <= budget && costs.serialization <= budget)
        const out = measures[arm]
        out.cases++
        for (const [key, cost] of Object.entries(costs)) out.tokenTotals[key] += cost
        for (const [k, candidates] of Object.entries(stages)) {
          out.stages[k] ??= stageCounters()
          addStage(out.stages[k], row, history, candidates)
        }
      }
    }

    outputs[condition] = measures
  }

  console.log(JSON.stringify({budget, dataset, outputs, providerCalls: 0, sampleDigest: queryDigest}, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
