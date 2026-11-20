// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official LongMemEval JSON field names must be preserved. */

// Offline evaluation boundary. Never imports a provider, reads credentials or invokes a grader.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export const officialEvaluation = Object.freeze({
  datasetRevision: '98d7416c24c778c2fee6e6f3006e7a073259d48f',
  datasetSha256: 'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442',
  judge: 'gpt-4o-2024-08-06',
  upstreamCommit: '9e0b455f4ef0e2ab8f2e582289761153549043fc',
})
const arms = ['none', 'pre', 'tool']

function sortedStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function exactIds(rows, expected) {
  assert(Array.isArray(rows), 'Expected an array of rows')
  const ids = rows.map((row) => row?.question_id)
  assert.equal(ids.length, expected.length, 'Missing or extra rows')
  assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs')
  assert.deepEqual(sortedStrings(ids), sortedStrings(expected), 'Missing or unknown IDs')
}

export function validatePredictions(rows, expected) {
  exactIds(rows, expected)
  for (const row of rows) {
    assert.deepEqual(sortedStrings(Object.keys(row)), ['hypothesis', 'question_id'], 'Unexpected prediction fields')
    assert(typeof row.hypothesis === 'string' && row.hypothesis.trim(), 'Expected a nonempty string hypothesis')
  }
}

export function exportPredictions(report, references) {
  assert.equal(report?.manifest?.kind, 'live-local-pilot', 'Expected a live pilot report')
  const {selected} = report.manifest
  assert(Array.isArray(selected) && selected.length === 30, 'Expected 30 planned IDs')
  assert(
    selected.every((id) => typeof id === 'string' && id),
    'Invalid planned ID',
  )
  assert.equal(new Set(selected).size, 30, 'Duplicate planned IDs')
  assert(Array.isArray(references), 'Expected reference rows')
  const referenceIds = references.map((row) => row.question_id)
  assert.equal(new Set(referenceIds).size, referenceIds.length, 'Duplicate reference IDs')
  const known = new Set(referenceIds)
  assert(
    selected.every((id) => known.has(id)),
    'Unknown planned ID',
  )
  assert(Array.isArray(report.records) && report.records.length === 90, 'Expected 90 completed records')
  const byArm = new Map(arms.map((arm) => [arm, new Map()]))
  for (const record of report.records) {
    assert(record && selected.includes(record.id) && byArm.has(record.arm), 'Unknown record ID or arm')
    assert.equal(record.outcome, 'completed', 'Generation execution error')
    assert(!record.error && !record.executionError, 'Generation execution error')
    const group = byArm.get(record.arm)
    assert(!group.has(record.id), 'Duplicate record ID within arm')
    group.set(record.id, record)
  }

  return Object.fromEntries(
    arms.map((arm) => {
      const rows = selected.map((id) => {
        const record = byArm.get(arm).get(id)
        assert(record, 'Missing arm record')
        return {hypothesis: record.answer, question_id: id}
      })
      validatePredictions(rows, selected)
      return [arm, rows]
    }),
  )
}

export function validateResults(results, predictions) {
  assert.equal(predictions.length, 30, 'Expected 30 predictions')
  const expected = predictions.map((row) => row.question_id)
  validatePredictions(predictions, expected)
  exactIds(results, expected)
  const answers = new Map(predictions.map((row) => [row.question_id, row.hypothesis]))
  for (const row of results) {
    assert.equal(row.hypothesis, answers.get(row.question_id), 'Changed hypothesis')
    assert.equal(row.autoeval_label?.model, officialEvaluation.judge, 'Wrong judge snapshot')
    assert.equal(typeof row.autoeval_label?.label, 'boolean', 'Expected a boolean grade')
  }
}

export function parseJsonl(text) {
  const lines = text.trimEnd().split('\n')
  assert(lines.length > 0 && lines.every((line) => line.trim()), 'Empty JSONL row')
  return lines.map((line) => JSON.parse(line))
}

export async function writePredictions(output, predictions) {
  // Validate all arms before creating anything; require a fresh directory, including for symlinks.
  const expected = predictions.none?.map((row) => row.question_id)
  assert(expected?.length === 30, 'Expected 30 planned IDs')
  assert.deepEqual(sortedStrings(Object.keys(predictions)), sortedStrings(arms), 'Expected exactly three arms')
  for (const arm of arms) validatePredictions(predictions[arm], expected)
  await fs.mkdir(output, {mode: 0o700})
  await Promise.all(
    arms.map(async (arm) => {
      const bytes = `${predictions[arm].map((row) => JSON.stringify(row)).join('\n')}\n`
      const file = resolve(output, `${arm}.jsonl`)
      await fs.writeFile(file, bytes, {flag: 'wx', mode: 0o600})
      assert.deepEqual(parseJsonl(await fs.readFile(file, 'utf8')), predictions[arm], 'Changed export content')
    }),
  )
}

export async function main(args) {
  const [command, first, second, output, ...extra] = args
  assert.equal(extra.length, 0, 'Unexpected arguments')
  if (command === 'export') {
    assert(first && second && output, 'Use: export REPORT DATASET NEW_OUTPUT_DIRECTORY')
    const [reportText, datasetBytes] = await Promise.all([fs.readFile(first, 'utf8'), fs.readFile(second)])
    assert.equal(
      createHash('sha256').update(datasetBytes).digest('hex'),
      officialEvaluation.datasetSha256,
      'Wrong dataset checksum',
    )
    const report = JSON.parse(reportText)
    assert.equal(report.manifest?.dataset?.revision, officialEvaluation.datasetRevision, 'Wrong dataset revision')
    assert.equal(report.manifest?.dataset?.sha256, officialEvaluation.datasetSha256, 'Wrong report dataset checksum')
    const predictions = exportPredictions(report, JSON.parse(datasetBytes))
    await writePredictions(output, predictions)
    console.log('Exported 30 unchanged predictions per arm; no grading API was called.')
  } else if (command === 'validate') {
    assert(first && second && !output, 'Use: validate HYPOTHESES OFFICIAL_RESULTS')
    const [predictions, results] = await Promise.all(
      [first, second].map(async (file) => parseJsonl(await fs.readFile(file, 'utf8'))),
    )
    validateResults(results, predictions)
    console.log('Validated 30 result IDs, unchanged hypotheses, boolean labels and judge snapshot.')
  } else {
    throw new Error('Use: export REPORT DATASET NEW_OUTPUT_DIRECTORY | validate HYPOTHESES OFFICIAL_RESULTS')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2))
  } catch {
    // Do not print data, paths, provider errors or nested assertions containing answer text.
    console.error('Offline evaluation validation failed. Check inputs, IDs, execution status and output freshness.')
    process.exitCode = 1
  }
}
