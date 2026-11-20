// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable camelcase -- Official dataset field names in the judge fixture. */

import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {answerSlots, objectDigest, openCheckpointRun, runSlots} from '../../bin/project-memory-study-checkpoints.mjs'
import {blindedMessages} from '../../bin/project-memory-study-judge.mjs'

const manifest = {code: 'fixture-commit', judgeDigest: 'mock-judge', rubricDigest: 'rubric-v1'}
const slots = answerSlots(['first'])
const result = ({arm, condition}) => ({
  answer: `fixture ${arm} ${condition}`,
  mapping: [],
  trace: {arm, outcome: 'completed', wireRequests: []},
})
const grade = (_caseId, answer) => answer.includes('tool')

function withoutRunIdentity(records) {
  return [...records].map(([key, value]) => {
    const comparison = {...value}
    delete comparison.manifestDigest
    return [key, comparison]
  })
}

async function temp() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-eval-')))
}

describe('Private LongMemEval answer and grade checkpoints', () => {
  it('kills a subprocess after durable answer and before grade, then reuses the answer with equivalent grading', async () => {
    const root = await temp()
    const uninterruptedRoot = await temp()
    try {
      const module = new URL('../../bin/project-memory-study-checkpoints.mjs', import.meta.url).href
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import {openCheckpointRun, runSlots} from ${JSON.stringify(module)}
        const manifest = ${JSON.stringify(manifest)}
        const slots = ${JSON.stringify(slots)}
        const store = await openCheckpointRun(${JSON.stringify(root)}, manifest, slots)
        await runSlots(store, slots, {
          generate: ${result.toString()},
          grade() {throw Error('grade must not run')},
          afterAnswer() {process.exit(73)}
        })`,
        ],
        {encoding: 'utf8', timeout: 15_000},
      )
      assert.equal(child.status, 73, child.stderr)
      const stored = await fs.readFile(path.join(root, 'answer-1-shared-none.json'), 'utf8')
      await assert.rejects(fs.stat(path.join(root, 'grade-1-shared-none.json')))
      const resumed = await openCheckpointRun(root, manifest, slots, {resume: true})
      try {
        const generated = []
        const grades = []
        await runSlots(resumed, slots, {
          generate(slot) {
            generated.push(slot.key)
            return result(slot)
          },
          grade(caseId, answer) {
            grades.push([caseId, answer])
            return grade(caseId, answer)
          },
        })
        assert.deepEqual(
          generated,
          slots.slice(1).map(({key}) => key),
        )
        assert.equal(grades.length, 5)
        assert.equal(grades[0][1], result(slots[0]).answer)
        assert.equal(await fs.readFile(path.join(root, 'answer-1-shared-none.json'), 'utf8'), stored)
        const continuous = await openCheckpointRun(uninterruptedRoot, manifest, slots)
        try {
          await runSlots(continuous, slots, {generate: result, grade})
          assert.deepEqual(withoutRunIdentity(resumed.answers), withoutRunIdentity(continuous.answers))
          assert.deepEqual(withoutRunIdentity(resumed.grades), withoutRunIdentity(continuous.grades))
          await resumed.writeSummary({grades: resumed.grades.size})
          await resumed.writeSummary({grades: resumed.grades.size})
          assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'summary.json'), 'utf8')), {grades: 5})
        } finally {
          continuous.close()
        }
      } finally {
        resumed.close()
      }
    } finally {
      await fs.rm(root, {force: true, recursive: true})
      await fs.rm(uninterruptedRoot, {force: true, recursive: true})
    }
  })

  it('refuses concurrent writers, mismatched manifests and a grade for different hypothesis bytes', async () => {
    const root = await temp()
    try {
      const store = await openCheckpointRun(root, manifest, slots)
      try {
        await assert.rejects(openCheckpointRun(root, manifest, slots, {resume: true}))
        await runSlots(store, slots, {generate: result, grade})
      } finally {
        store.close()
      }

      await assert.rejects(
        openCheckpointRun(root, {...manifest, rubricDigest: 'other'}, slots, {resume: true}),
        /manifest/,
      )
      const file = path.join(root, 'grade-1-shared-none.json')
      const {body} = JSON.parse(await fs.readFile(file, 'utf8'))
      body.answerDigest = 'different'
      await fs.writeFile(file, JSON.stringify({body, digest: objectDigest(body)}))
      await assert.rejects(openCheckpointRun(root, manifest, slots, {resume: true}), /Grade answer changed/)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('leaves an unavailable grade pending, then resumes without overwriting the completed answer', async () => {
    const root = await temp()
    const slot = slots[0]
    try {
      const store = await openCheckpointRun(root, manifest, slots)
      try {
        await runSlots(store, [slot], {generate: result, grade: () => null})
        assert.equal(store.answers.size, 1)
        assert.equal(store.grades.size, 0)
      } finally {
        store.close()
      }

      const resumed = await openCheckpointRun(root, manifest, slots, {resume: true})
      try {
        await runSlots(resumed, [slot], {
          generate() {
            assert.fail('Should not generate')
          },
          grade: () => true,
        })
        assert.equal(resumed.grades.get(slot.key).correct, true)
      } finally {
        resumed.close()
      }
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('plans a single shared control and supplies only a single blinded hypothesis to the rubric', () => {
    assert.equal(answerSlots(['first', 'second']).filter(({arm}) => arm === 'none').length, 2)
    const messages = blindedMessages(
      {
        answer: 'reference',
        condition: 'private condition',
        question: 'question',
        question_id: 'private-id',
        siblings: ['private sibling'],
      },
      'hypothesis',
    )
    const payload = JSON.parse(messages[1].content)
    assert.deepEqual(payload, {answer: 'hypothesis', question: 'question', reference: 'reference', unanswerable: false})
    assert(!JSON.stringify(messages).includes('private'))
  })

  it('uses a real mock Core search in all four search slots and one shared control without inference', async () => {
    const {runCheckpointCase, studySummary} = await import('../../bin/project-memory-ingestion-study.mjs')
    const row = {
      answer: 'cobalt',
      answer_session_ids: ['public'],
      haystack_dates: ['2025-01-01'],
      haystack_session_ids: ['public'],
      haystack_sessions: [[{content: 'The catalog state is cobalt.', has_answer: true, role: 'user'}]],
      question: 'What is the catalog state?',
      question_date: '2026-01-01',
      question_id: 'first',
    }
    const root = await temp()
    try {
      const store = await openCheckpointRun(root, manifest, slots)
      try {
        const result = await runCheckpointCase(row, slots, store, 'mock')
        assert.equal(store.answers.size, 5)
        assert.equal(store.grades.size, 0)
        assert.equal(studySummary([result], 'mock', 30).pairedCompleted, 1)
        for (const policy of ['prefix', 'turn-chunks'])
          assert.deepEqual(
            result[policy].observed.map(({searches}) => searches.length),
            [0, 1, 1],
          )
      } finally {
        store.close()
      }
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('anchors dataset and output paths and refuses absolute paths, aliases and symlink leaves', async function () {
    if (process.platform === 'win32') this.skip()
    const {createStudyOutput, datasetFile} = await import('../../bin/project-memory-ingestion-study.mjs')
    const root = await temp()
    try {
      const parent = path.join(root, 'tmp')
      const fixture = path.join(parent, 'public.json')
      await fs.mkdir(parent)
      const handle = await fs.open(fixture, 'wx', 0o600)
      try {
        await handle.truncate(277_383_467)
      } finally {
        await handle.close()
      }

      assert.equal(await datasetFile('tmp/public.json', root), fixture)
      await assert.rejects(datasetFile(fixture, root), /directly under/)
      await assert.rejects(datasetFile('tmp/.private.json', root), /directly under/)
      await assert.rejects(datasetFile('tmp/nested/private.json', root), /directly under/)
      await fs.symlink(fixture, path.join(parent, 'alias.json'))
      await assert.rejects(datasetFile('tmp/alias.json', root), /pinned public/)
      await fs.symlink(parent, path.join(parent, 'alias'))
      await assert.rejects(createStudyOutput('tmp/alias', root, {resume: true}), /Ambiguous/)
      await assert.rejects(createStudyOutput(path.join(parent, 'absolute'), root), /named direct child/)
      await fs.rename(parent, path.join(root, 'real-tmp'))
      await fs.symlink(path.join(root, 'real-tmp'), parent)
      await assert.rejects(datasetFile('tmp/public.json', root), /must not be a symbolic link/)
      await assert.rejects(createStudyOutput('tmp/new-run', root), /must not be a symbolic link/)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
