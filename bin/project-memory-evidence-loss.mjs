// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {renderProjectMemory} from '../dist/core/projects/memory-context.js'
import {GptTokenizer} from '../dist/core/tokenizer/index.js'
import {historyWithOffsets, ingestionPlan, replayFixture} from './project-memory-ingestion-study-core.mjs'
import {packingReplay, readPinnedCases} from './project-memory-turn-packing.mjs'

const cap = 2048
const stagesInOrder = ['available', 'positive', 'prepared', 'preparedTopSix', 'serialized']
const missingAt = ['ingestion', 'lexical-overlap', 'preparation', 'prepared-result-slots', 'serialization']
const tokenizer = new GptTokenizer()

function covers(item, turn) {
  return item.originalIndex === turn.originalIndex && item.start <= turn.start && item.end >= turn.end
}

/** Count repeated copies of the same occurrence separately from repeated role/content. */
export function repetition(history, candidates) {
  const seen = new Map()
  let duplicateOccurrences = 0
  let distinctOccurrences = 0
  let repeatedText = 0
  let repeatedTextInSameSource = 0
  for (const {originalIndex, text, turns} of history) {
    const items = candidates.filter(({item}) => item.originalIndex === originalIndex)
    for (const span of turns) {
      const copies = items.filter(({item}) => covers(item, {...span, originalIndex})).length
      if (copies === 0) continue
      distinctOccurrences++
      duplicateOccurrences += copies - 1
      const roleAndContent = text.slice(span.start, span.end)
      const sources = seen.get(roleAndContent) ?? new Set()
      repeatedText += Number(sources.size > 0)
      repeatedTextInSameSource += Number(sources.has(originalIndex))
      sources.add(originalIndex)
      seen.set(roleAndContent, sources)
    }
  }

  return {distinctOccurrences, duplicateOccurrences, repeatedText, repeatedTextInSameSource}
}

export function firstLoss(stages, turn) {
  const absent = stagesInOrder.findIndex((stage) => !stages[stage].some(({item}) => covers(item, turn)))
  return absent === -1 ? 'covered' : missingAt[absent]
}

function missDetail(stages, turn, arm, projectId) {
  const rank = stages.positive.findIndex(({item}) => covers(item, turn))
  assert(rank !== -1)
  const alone = stages.positive.some((candidate) => {
    const {entry, item, prefixes} = candidate
    return (arm === 'whole' ? [item] : prefixes).some(
      (span) =>
        covers(span, turn) &&
        tokenizer.encode(renderProjectMemory(projectId, [{...entry, body: span.excerpt}])).length <= cap,
    )
  })
  const range = rank < 6 ? '1-6' : rank < 16 ? '7-16' : '17+'
  return `${range} ${alone ? 'fits alone' : 'cannot fit alone'}`
}

function countInto(target, entries) {
  for (const [key, value] of Object.entries(entries)) target[key] = (target[key] ?? 0) + value
}

function evaluate(rows, condition, arm) {
  const losses = {}
  const preparationMisses = {}
  const repeats = {available: {}, prepared: {}, serialized: {}}
  for (const row of rows) {
    const history = historyWithOffsets(row)
    const {admitted} = ingestionPlan(history, condition)
    const {stages} = packingReplay(
      admitted,
      history,
      `Current date: ${row.question_date}\n${row.question}`.slice(0, 512),
      arm,
    )
    const cohort = row.question_id.endsWith('_abs') ? 'abstention' : 'answerable'
    for (const key of Object.keys(repeats)) {
      repeats[key][cohort] ??= {}
      countInto(repeats[key][cohort], repetition(history, stages[key]))
    }

    if (cohort === 'abstention') continue
    const projectId = replayFixture(admitted).project.id
    for (const {originalIndex, turns} of history) {
      for (const span of turns) {
        if (!row.haystack_sessions[originalIndex][span.turnIndex]?.has_answer) continue
        const turn = {...span, originalIndex}
        const loss = firstLoss(stages, turn)
        countInto(losses, {[loss]: 1})
        if (loss === 'preparation') countInto(preparationMisses, {[missDetail(stages, turn, arm, projectId)]: 1})
      }
    }
  }

  assert.equal(
    Object.values(losses).reduce((a, b) => a + b, 0),
    47,
  )
  return {losses, preparationMisses, repeats}
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node bin/project-memory-evidence-loss.mjs < /path/to/longmemeval_s_cleaned.json',
  )
  const rows = await readPinnedCases(process.stdin)
  const output = {}
  for (const [condition, arm] of [
    ['turn-chunks', 'whole'],
    ['turn-chunks', 'both'],
    ['prefix', 'whole'],
  ]) {
    output[`${condition}/${arm}`] = evaluate(rows, condition, arm)
  }

  console.log(JSON.stringify({output, providerCalls: 0}, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
