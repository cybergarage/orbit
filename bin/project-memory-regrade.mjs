// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Retry only invalid evaluation outputs, sequentially and once. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'

import {classifyFailure, dataset, gradePilotAnswers, summarize} from './project-memory-pilot.mjs'

// Evaluation only: no generation, ingestion, search or reference injection into an answering Session.
const [input, dataFile, output] = process.argv.slice(2)
assert(input && dataFile && output, 'Use node bin/project-memory-regrade.mjs REPORT DATASET OUTPUT')
const bytes = await fs.readFile(dataFile)
assert.equal(createHash('sha256').update(bytes).digest('hex'), dataset.sha256)
const rows = JSON.parse(bytes)
const report = JSON.parse(await fs.readFile(input, 'utf8'))
assert.equal(report.manifest.kind, 'live-local-pilot')
assert.equal(report.manifest.dataset.sha256, dataset.sha256)
assert.equal(report.records.length, 90, 'Complete all planned generations before evaluation retries')
const missing = [
  ...new Set(report.records.filter((record) => record.judgedCorrect === null).map((record) => record.id)),
]
for (const id of missing) {
  const row = rows.find((item) => item.question_id === id)
  assert(row)
  const records = ['none', 'pre', 'tool'].map((arm) =>
    report.records.find((record) => record.id === id && record.arm === arm),
  )
  assert(records.every(Boolean))
  try {
    const grade = await gradePilotAnswers(
      row,
      records.map((record) => record.answer),
      report.manifest.model,
    )
    report.judgments.push({id, kind: 'syntax-retry', ...grade})
    if (grade.correct)
      for (const [index, record] of records.entries()) {
        record.judgedCorrect = grade.correct[index]
        record.failure = classifyFailure(record)
      }
  } catch (error) {
    report.judgments.push({error: String(error), id, kind: 'syntax-retry'})
  }

  report.summary = summarize(report.records)
  report.manifest.gradingRetries = {
    attemptsPerInvalidCase: 1,
    generatedAnswersUnchanged: true,
    originalErrorsPreserved: true,
    schema: 'exactly-three-booleans',
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2))
  console.log(`Evaluation syntax retry ${id}`)
}

if (missing.length === 0) await fs.writeFile(output, JSON.stringify(report, null, 2))
