// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official LongMemEval JSON field names must be preserved. */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  exportPredictions,
  main,
  officialEvaluation,
  parseJsonl,
  validateResults,
  writePredictions,
} from '../../bin/project-memory-official-input.mjs'

function fixture() {
  const selected = Array.from({length: 30}, (_, i) => `synthetic-${i}`)
  const references = selected.map((question_id) => ({question_id}))
  const report = {
    manifest: {kind: 'live-local-pilot', selected},
    records: ['none', 'pre', 'tool'].flatMap((arm) =>
      selected.map((id) => ({answer: `  Synthetic ${id}\n"quoted" 日本語 😀\n`, arm, id, outcome: 'completed'})),
    ),
  }
  return {references, report}
}

function results(predictions) {
  return predictions.map((row) => ({...row, autoeval_label: {label: true, model: officialEvaluation.judge}}))
}

describe('offline official Project memory evaluation input', () => {
  it('exports identical planned IDs and exact strings with only the official keys', () => {
    const {references, report} = fixture()
    const exported = exportPredictions(report, references)
    for (const arm of ['none', 'pre', 'tool']) {
      assert.deepEqual(
        exported[arm].map((r) => r.question_id),
        report.manifest.selected,
      )
      assert.equal(exported[arm][0].hypothesis, report.records.find((r) => r.arm === arm).answer)
      assert.deepEqual(Object.keys(exported[arm][0]).sort(), ['hypothesis', 'question_id'])
    }

    assert.equal(report.records[0].outcome, 'completed')
  })

  for (const [name, mutate] of [
    [
      'duplicate record',
      (r) => {
        r.records[1] = r.records[0]
      },
    ],
    [
      'missing record',
      (r) => {
        r.records.pop()
      },
    ],
    [
      'unknown record',
      (r) => {
        r.records[0].id = 'unknown'
      },
    ],
    [
      'unknown arm',
      (r) => {
        r.records[0].arm = 'other'
      },
    ],
    [
      'duplicate planned ID',
      (r) => {
        r.manifest.selected[1] = r.manifest.selected[0]
      },
    ],
    [
      'unknown planned ID',
      (r) => {
        r.manifest.selected[0] = 'unknown'
      },
    ],
    [
      'noncompleted run',
      (r) => {
        r.records[0].outcome = 'failed'
      },
    ],
    [
      'execution error',
      (r) => {
        r.records[0].error = 'Synthetic failure'
      },
    ],
    [
      'empty answer',
      (r) => {
        r.records[0].answer = '  '
      },
    ],
    [
      'nonstring answer',
      (r) => {
        r.records[0].answer = null
      },
    ],
  ])
    it(`rejects ${name}`, () => {
      const {references, report} = fixture()
      mutate(report)
      assert.throws(() => exportPredictions(report, references))
    })

  it('validates official results independently of row order', () => {
    const {references, report} = fixture()
    const p = exportPredictions(report, references).none
    validateResults(results(p).reverse(), p)
  })

  for (const [name, mutate] of [
    [
      'missing result',
      (r) => {
        r.pop()
      },
    ],
    [
      'duplicate result',
      (r) => {
        r[1] = r[0]
      },
    ],
    [
      'unknown result',
      (r) => {
        r[0].question_id = 'unknown'
      },
    ],
    [
      'changed hypothesis',
      (r) => {
        r[0].hypothesis += 'changed'
      },
    ],
    [
      'wrong judge',
      (r) => {
        r[0].autoeval_label.model = 'gpt-4o'
      },
    ],
    [
      'string label',
      (r) => {
        r[0].autoeval_label.label = 'yes'
      },
    ],
    [
      'numeric label',
      (r) => {
        r[0].autoeval_label.label = 1
      },
    ],
    [
      'missing label',
      (r) => {
        delete r[0].autoeval_label
      },
    ],
  ])
    it(`rejects ${name}`, () => {
      const {references, report} = fixture()
      const p = exportPredictions(report, references).none
      const r = results(p)
      mutate(r)
      assert.throws(() => validateResults(r, p))
    })

  it('roundtrips multiline Unicode and refuses existing output without changing it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-official-test-'))
    try {
      const {references, report} = fixture()
      const p = exportPredictions(report, references)
      const output = path.join(dir, 'fresh')
      await writePredictions(output, p)
      const original = await fs.readFile(path.join(output, 'none.jsonl'), 'utf8')
      assert.deepEqual(parseJsonl(original), p.none)
      await assert.rejects(writePredictions(output, p), {code: 'EEXIST'})
      assert.equal(await fs.readFile(path.join(output, 'none.jsonl'), 'utf8'), original)
      const changed = structuredClone(p)
      changed.tool[0].question_id = 'other'
      await assert.rejects(writePredictions(path.join(dir, 'invalid'), changed))
      await assert.rejects(fs.stat(path.join(dir, 'invalid')), {code: 'ENOENT'})
    } finally {
      await fs.rm(dir, {force: true, recursive: true})
    }
  })

  it('runs result validation offline and rejects wrong dataset provenance before output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-official-cli-test-'))
    try {
      const {references, report} = fixture()
      const p = exportPredictions(report, references).tool
      const hyp = path.join(dir, 'hyp.jsonl')
      const grades = path.join(dir, 'grades.jsonl')
      const reportFile = path.join(dir, 'report.json')
      const dataFile = path.join(dir, 'data.json')
      await fs.writeFile(hyp, p.map((row) => JSON.stringify(row)).join('\n'))
      await fs.writeFile(
        grades,
        results(p)
          .map((row) => JSON.stringify(row))
          .join('\n'),
      )
      await main(['validate', hyp, grades])
      await fs.writeFile(reportFile, JSON.stringify(report))
      await fs.writeFile(dataFile, JSON.stringify(references))
      const output = path.join(dir, 'blocked')
      await assert.rejects(main(['export', reportFile, dataFile, output]), /Wrong dataset checksum/)
      await assert.rejects(fs.stat(output), {code: 'ENOENT'})
      assert.deepEqual(JSON.parse(await fs.readFile(reportFile, 'utf8')), report)
    } finally {
      await fs.rm(dir, {force: true, recursive: true})
    }
  })

  it('rejects blank or malformed JSONL rows and unknown commands', async () => {
    assert.throws(() => parseJsonl(''))
    assert.throws(() => parseJsonl('{}\n\n{}\n'))
    assert.throws(() => parseJsonl('not json'))
    await assert.rejects(main(['unknown']))
  })
})
