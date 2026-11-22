// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Bounded private checkpoint audit is intentionally serial. */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

import {answerMessages, evidenceContexts, randomizedSlots} from './project-memory-answer-oracle.mjs'
import {weightedRank} from './project-memory-df-ranking.mjs'
import {manifest, selectHoldout} from './project-memory-heldout-ranking.mjs'
import {historyWithOffsets, ingestionPlan} from './project-memory-ingestion-study-core.mjs'
import {digest} from './project-memory-ingestion-study-trace.mjs'
import {createStudyOutput} from './project-memory-ingestion-study.mjs'
import {selectCases} from './project-memory-pilot.mjs'
import {packingReplay, readPinnedDataset} from './project-memory-turn-packing.mjs'

const pinnedHoldout = 'f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b'

const full = ({annotated, complete}) => annotated > 0 && complete === annotated

export function transition(baseline, weighted) {
  if (!baseline.correct && weighted.correct) {
    const before = baseline.coverage.complete
    const after = weighted.coverage.complete
    return after > before ? 'winMore' : after < before ? 'winFewer' : 'winSame'
  }

  return baseline.correct && !weighted.correct ? 'loss' : 'sameGrade'
}

export function latestAnnotatedStage(row, history, stages) {
  const latest = history
    .flatMap(({originalIndex, turns}) =>
      turns
        .filter(({turnIndex}) => row.haystack_sessions[originalIndex][turnIndex]?.has_answer)
        .map((turn) => ({...turn, originalIndex})),
    )
    .at(-1)
  assert(latest, 'Expected an annotated turn')
  const inStage = (name) =>
    stages[name].some(
      ({item}) => item.originalIndex === latest.originalIndex && item.start <= latest.start && item.end >= latest.end,
    )
  return {
    admitted: inStage('available'),
    eligible: inStage('positive'),
    prepared: inStage('prepared'),
    serialized: inStage('serialized'),
    sourceInWire: stages.serialized.some(({item}) => item.originalIndex === latest.originalIndex),
  }
}

async function readCheckpoint(dir, name, unwrapped = false) {
  assert(/^(?:manifest|summary|(?:answer|grade)-(?:[1-9]\d?|100)-diagnostic-(?:baseline|weighted))\.json$/u.test(name))
  const file = `${dir}/${name}`
  const info = await fs.lstat(file)
  assert(info.isFile() && (process.platform === 'win32' || info.mode % 0o100 === 0) && info.size <= 2_097_152)
  const envelope = JSON.parse(await fs.readFile(file, 'utf8'))
  if (unwrapped) return envelope
  assert.equal(envelope.digest, digest(JSON.stringify(envelope.body)), 'Checkpoint integrity mismatch')
  return envelope.body
}

async function groundedPair(dir, row, slots, identity) {
  const runProtocol = identity.protocol
  const evidence = evidenceContexts(row, {includeOracle: false})
  const paired = {}
  for (const slot of slots) {
    const {arm, key} = slot
    const answer = await readCheckpoint(dir, `answer-${key}.json`)
    const grade = await readCheckpoint(dir, `grade-${key}.json`)
    assert.deepEqual(answer.slot, slot)
    assert.equal(answer.trace.outcome, 'completed')
    assert.equal(answer.answerDigest, digest(answer.answer))
    assert.equal(grade.answerDigest, answer.answerDigest)
    assert.equal(grade.slotKey, key)
    assert.equal(answer.manifestDigest, digest(JSON.stringify(identity)))
    assert.equal(grade.manifestDigest, answer.manifestDigest)
    assert.equal(grade.judgeDigest, runProtocol.judgeDigest)
    assert.equal(grade.rubricDigest, runProtocol.rubricDigest)
    assert.equal(typeof grade.correct, 'boolean')
    const {coverage, wire} = evidence[arm]
    assert.deepEqual(answer.trace.coverage, coverage)
    assert.equal(answer.trace.contextDigest, digest(wire))
    assert.equal(answer.trace.promptDigest, digest(JSON.stringify(answerMessages(row, wire))))
    paired[arm] = {
      correct: grade.correct,
      coverage,
      insufficientLanguage:
        /\b(?:not enough|does not (?:state|specify|mention)|cannot determine|no (?:information|evidence))\b/iu.test(
          answer.answer,
        ),
    }
  }

  return paired
}

function latestForLoss(row) {
  const history = historyWithOffsets(row)
  const {admitted} = ingestionPlan(history, 'turn-chunks')
  const query = `Current date: ${row.question_date}\n${row.question}`.slice(0, 512)
  const baseline = packingReplay(admitted, history, query, 'whole')
  const weighted = packingReplay(admitted, history, query, 'whole', (ranked) => weightedRank(ranked, query))
  return {
    baseline: latestAnnotatedStage(row, history, baseline.stages),
    weighted: latestAnnotatedStage(row, history, weighted.stages),
  }
}

async function main() {
  assert.equal(process.argv.length, 4, 'Use --run-dir tmp/ingestion-study-ID; provide pinned data on stdin')
  assert.equal(process.argv[2], '--run-dir')
  const dir = await createStudyOutput(process.argv[3], process.cwd(), {resume: true})
  const input = JSON.parse(await readPinnedDataset(process.stdin))
  const pilot = selectCases(input)
  const rows = selectHoldout(input, new Set(pilot.map((row) => row.question_id)))
  const frozen = manifest(rows, pilot)
  assert.equal(frozen.orderedHoldoutSha256, pinnedHoldout)
  const identity = await readCheckpoint(dir, 'manifest.json')
  const {protocol} = identity
  assert.equal(protocol.selectedSha, pinnedHoldout)
  assert.equal(protocol.includeOracle, false)
  const summary = await readCheckpoint(dir, 'summary.json', true)
  assert.equal(summary.plannedSlots, 200)
  assert.equal(summary.answers, 200)
  assert.equal(summary.grades, 200)
  assert.equal(summary.records.length, rows.length)
  const slots = randomizedSlots(rows, {includeOracle: false})
  const counts = {loss: 0, winFewer: 0, winMore: 0, winSame: 0}
  const evidenceLoss = []
  const answerLoss = []
  for (const [index, row] of rows.entries()) {
    const record = summary.records[index]
    assert.equal(record.ordinal, index + 1)
    assert.equal(record.type, row.question_type)
    const {baseline, weighted} = record.arms
    if (full(baseline.coverage) && !full(weighted.coverage)) {
      const checked = evidenceContexts(row, {includeOracle: false})
      assert.deepEqual(baseline.coverage, checked.baseline.coverage)
      assert.deepEqual(weighted.coverage, checked.weighted.coverage)
      evidenceLoss.push({
        answerLoss: baseline.correct && !weighted.correct,
        bothGradedWrong: !baseline.correct && !weighted.correct,
        type: record.type,
      })
    }

    const classification = transition(baseline, weighted)
    if (classification === 'sameGrade') continue
    const checked = await groundedPair(
      dir,
      row,
      slots.filter((slot) => slot.caseId === row.question_id),
      identity,
    )
    assert.equal(transition(checked.baseline, checked.weighted), classification)
    counts[classification]++
    if (classification === 'loss') {
      answerLoss.push({
        coverage: {baseline: checked.baseline.coverage, weighted: checked.weighted.coverage},
        latest: latestForLoss(row),
        type: record.type,
        weightedInsufficientLanguage: checked.weighted.insufficientLanguage,
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        answerLoss,
        checkedDiscordantPairs: Object.values(counts).reduce((a, b) => a + b, 0),
        counts,
        evidenceLoss,
        providerCalls: 0,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
