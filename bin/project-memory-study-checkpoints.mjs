// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Durable operations are intentionally ordered. */

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {WriterClaim} from '../dist/core/session/coordination.js'
import {SessionRepository} from '../dist/core/session/repository.js'
import {digest} from './project-memory-ingestion-study-trace.mjs'

const writerId = 'evaluation-writer'
const maxBytes = 2 * 1024 * 1024
const ownerOnly = (stat) => process.platform === 'win32' || stat.mode % 0o100 === 0
export const objectDigest = (value) => digest(JSON.stringify(value))

async function read(file) {
  let stat
  try {
    stat = await fs.lstat(file)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  assert(stat.isFile() && ownerOnly(stat) && stat.size <= maxBytes, 'Invalid private checkpoint file')
  let envelope
  try {
    envelope = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    throw new Error('Invalid checkpoint JSON')
  }

  assert(envelope?.body && envelope.digest === objectDigest(envelope.body), 'Invalid checkpoint integrity')
  return envelope.body
}

async function syncDirectory(root) {
  if (process.platform === 'win32') return
  const directory = await fs.open(root, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function publish(root, file, body, {claim, replace = false}) {
  claim.assertLive()
  assert(
    /^(?:manifest|summary|(?:answer|grade)-(?:[1-9]\d?|100)-(?:shared-none|(?:prefix|turn-chunks)-(?:pre|tool)|diagnostic-(?:baseline|weighted|oracle)))\.json$/u.test(
      file,
    ),
    'Invalid checkpoint artifact name',
  )
  const text = JSON.stringify(replace ? body : {body, digest: objectDigest(body)}) + '\n'
  assert(Buffer.byteLength(text) <= maxBytes, 'Checkpoint exceeds its bound')
  const temporary = path.join(root, `.pending-${randomUUID()}`)
  const handle = await fs.open(temporary, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(text)
      await handle.sync()
    } finally {
      await handle.close()
    }

    claim.assertLive()
    // Same-directory hard link publishes complete bytes and never replaces a committed record.
    await (replace ? fs.rename(temporary, path.join(root, file)) : fs.link(temporary, path.join(root, file)))
    await syncDirectory(root)
  } finally {
    await fs.rm(temporary, {force: true})
  }
}

export function answerSlots(questionIds) {
  return questionIds.flatMap((caseId, index) => {
    const variants = index % 2 === 0 ? ['prefix', 'turn-chunks'] : ['turn-chunks', 'prefix']
    const slots = [
      {arm: 'none', condition: 'shared'},
      ...variants.flatMap((condition) => ['pre', 'tool'].map((arm) => ({arm, condition}))),
    ]
    return slots.map((slot) => ({...slot, caseId, key: `${index + 1}-${slot.condition}-${slot.arm}`}))
  })
}

function assertAnswer(record, slot, manifestDigest) {
  assert(objectDigest(record.slot) === objectDigest(slot), 'Checkpoint slot changed')
  assert.equal(record.manifestDigest, manifestDigest, 'Checkpoint manifest changed')
  assert.equal(typeof record.answer, 'string', 'Missing exact hypothesis')
  assert.equal(record.answerDigest, digest(record.answer), 'Answer digest changed')
  assert.equal(record.trace?.arm, slot.arm, 'Trace arm changed')
  assert(typeof record.trace.outcome === 'string' && Array.isArray(record.trace.wireRequests), 'Invalid answer trace')
}

function assertGrade(record, answer, manifest) {
  assert(answer?.answer && answer.trace.outcome === 'completed', 'Grade has no completed answer')
  assert.equal(record.slotKey, answer.slot.key, 'Grade slot changed')
  assert.equal(record.answerDigest, answer.answerDigest, 'Grade answer changed')
  assert.equal(record.manifestDigest, answer.manifestDigest, 'Grade manifest changed')
  assert.equal(record.rubricDigest, manifest.rubricDigest, 'Grade rubric changed')
  assert.equal(record.judgeDigest, manifest.judgeDigest, 'Grade judge changed')
  assert.equal(typeof record.correct, 'boolean', 'Invalid grade')
}

/** Open a fresh, or explicitly resumed, private run. Full preflight precedes model work. */
export async function openCheckpointRun(root, manifest, slots, {resume = false} = {}) {
  assert((await fs.realpath(root)) === root, 'Ambiguous checkpoint directory')
  const stat = await fs.lstat(root)
  assert(stat.isDirectory() && ownerOnly(stat), 'Checkpoint directory must be private')
  const repository = new SessionRepository({
    journalRoot: path.join(root, '.ownership-journal'),
    rootDir: path.join(root, '.ownership-sessions'),
  })
  if (!resume)
    repository.initializeStorage({
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    })

  const claim = WriterClaim.acquire(repository.scope(writerId), () => {})
  try {
    const identity = resume ? await read(path.join(root, 'manifest.json')) : {protocol: manifest, runId: randomUUID()}
    if (resume) {
      assert(/^[a-f0-9-]{36}$/u.test(identity?.runId ?? ''), 'Missing run identity')
      assert(objectDigest(identity.protocol) === objectDigest(manifest), 'Run manifest does not match')
    } else {
      await syncDirectory(path.dirname(root))
      await publish(root, 'manifest.json', identity, {claim})
    }

    const manifestDigest = objectDigest(identity)
    const answers = new Map()
    const grades = new Map()
    assert.equal(new Set(slots.map(({key}) => key)).size, slots.length, 'Duplicate planned checkpoint slot')
    const planned = new Set(slots.flatMap(({key}) => [`answer-${key}.json`, `grade-${key}.json`]))
    for (const name of await fs.readdir(root)) {
      if (/^(?:answer|grade)-/.test(name)) assert(planned.has(name), 'Unexpected checkpoint slot')
    }

    for (const slot of slots) {
      const answer = await read(path.join(root, `answer-${slot.key}.json`))
      const grade = await read(path.join(root, `grade-${slot.key}.json`))
      if (answer) {
        assertAnswer(answer, slot, manifestDigest)
        answers.set(slot.key, answer)
      }

      if (grade) {
        assertGrade(grade, answer, manifest)
        grades.set(slot.key, grade)
      }
    }

    return {
      async acceptAnswer(slot, result) {
        assert(planned.has(`answer-${slot.key}.json`), 'Unknown answer slot')
        const answer = {...result, answerDigest: digest(result.answer), manifestDigest, slot}
        assertAnswer(answer, slot, manifestDigest)
        await publish(root, `answer-${slot.key}.json`, answer, {claim})
        answers.set(slot.key, answer)
        return answer
      },
      async acceptGrade(answer, correct) {
        assert.equal(answers.get(answer.slot.key), answer, 'Grade requires the committed in-memory answer')
        const grade = {
          answerDigest: answer.answerDigest,
          correct,
          judgeDigest: manifest.judgeDigest,
          manifestDigest,
          rubricDigest: manifest.rubricDigest,
          slotKey: answer.slot.key,
        }
        assertGrade(grade, answer, manifest)
        await publish(root, `grade-${answer.slot.key}.json`, grade, {claim})
        grades.set(answer.slot.key, grade)
      },
      answers,
      close() {
        claim.release()
      },
      grades,
      async writeSummary(summary) {
        await publish(root, 'summary.json', summary, {claim, replace: true})
      },
    }
  } catch (error) {
    claim.release()
    throw error
  }
}

export async function runSlots(store, slots, {afterAnswer, generate, grade}) {
  for (const slot of slots) {
    let answer = store.answers.get(slot.key)
    if (!answer) {
      answer = await store.acceptAnswer(slot, await generate(slot))
      await afterAnswer?.(slot)
    }

    if (!grade || store.grades.has(slot.key) || answer.trace.outcome !== 'completed' || !answer.answer) continue
    // No slot, trace, sibling answer or ingestion metadata is passed to the judge.
    const correct = await grade(slot.caseId, answer.answer)
    if (typeof correct === 'boolean') await store.acceptGrade(answer, correct)
  }
}
