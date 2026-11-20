// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Isolated ordered evaluation and official dataset field names. */

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'

import {Message, MessageType} from '../dist/core/index.js'
import {
  annotationCoverage,
  compactOffsets,
  historyWithOffsets,
  ingestionPlan,
  limits,
  replaySelection,
} from './project-memory-ingestion-study-core.mjs'
import {deliveredIds, digest, traceArm} from './project-memory-ingestion-study-trace.mjs'
import {
  answer,
  dataset,
  environment,
  gradePilotAnswers,
  ingest,
  localModelMetadata,
  selectCases,
} from './project-memory-pilot.mjs'

const model = 'gemma4:12b'
const modelDigest = '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c'
const conditions = ['prefix', 'turn-chunks']
const arms = ['none', 'pre', 'tool']

function errorKind(error) {
  return error instanceof Error ? error.name : 'unknown'
}

export async function createStudyOutput(request, cwd = process.cwd()) {
  const root = await fs.realpath(cwd)
  const parent = path.join(root, 'tmp')
  const output = path.resolve(root, request)
  assert.equal(path.dirname(output), parent, 'Output must be a new direct child of the ignored tmp/ directory')
  assert.equal(await fs.realpath(parent), parent, 'Output parent must not be a symbolic link')
  await fs.mkdir(output, {mode: 0o700})
  return output
}

async function write(output, file, value) {
  await fs.writeFile(path.join(output, file), JSON.stringify(value) + '\n', {flag: 'wx', mode: 0o600})
}

async function saveTurnChunks(env, history, items) {
  const mapping = []
  for (const source of history) {
    const chunks = items.filter((item) => item.originalIndex === source.originalIndex)
    if (chunks.length === 0) continue
    const session = await env.projects.createSession(env.project.id, randomUUID(), async () => ({formatVersion: 3}))
    let sourceMessageId
    const sourceSessionId = session.getId()
    try {
      const [message] = session.appendMessages([new Message(MessageType.User, {content: source.text})])
      sourceMessageId = message.id
      await session.synchronize('file-sync')
    } finally {
      await session.close()
    }

    for (const item of chunks) {
      const entry = await env.memory.saveExcerpt(env.project.id, {
        excerpt: item.excerpt,
        messageId: sourceMessageId,
        operationId: randomUUID(),
        sessionId: sourceSessionId,
        title: item.title,
      })
      mapping.push({...compactOffsets({...item, entryId: entry.id}), sourceMessageId, sourceSessionId})
    }
  }

  return mapping
}

async function saveCondition(env, history, planned, condition) {
  if (condition === 'turn-chunks') return saveTurnChunks(env, history, planned)
  // Historical experiment uses this exact Core-backed routine, unchanged.
  const saved = await ingest(env, history)
  assert.equal(saved.length, planned.length)
  return saved.map(({entryId, excerpt, sourceMessageId, sourceSessionId}, index) => {
    assert.equal(excerpt, planned[index].excerpt)
    return {...compactOffsets({...planned[index], entryId}), sourceMessageId, sourceSessionId}
  })
}

async function observedArm(env, question, arm, mock) {
  const observer = traceArm(env, arm)
  try {
    const result = await answer(env, question, arm, {mock, modelName: model, trace: observer})
    return {answer: result.answer, observed: {arm, outcome: result.outcome, ...observer.result}}
  } catch (error) {
    return {answer: '', observed: {arm, failure: errorKind(error), outcome: 'provider-error', ...observer.result}}
  } finally {
    observer.close()
  }
}

function attachedCoverage(row, history, mapping, trace) {
  const byId = new Set(deliveredIds(trace))
  return annotationCoverage(
    row,
    history,
    mapping.filter((chunk) => byId.has(chunk.entryId)),
  )
}

async function runCondition(row, history, plan, {condition, mode}) {
  const question = `Current date: ${row.question_date}\n${row.question}`
  const query = question.slice(0, 512)
  if (mode === 'replay') {
    const {offsets, ...replay} = replaySelection(plan.admitted, query)
    const cover = (ids) => {
      const selected = new Set(ids)
      return annotationCoverage(
        row,
        history,
        offsets.filter((chunk) => selected.has(chunk.entryId)),
      )
    }

    return {
      mapping: offsets,
      replay: {...replay, coverage: cover(replay.returnedIds), query, topSixCoverage: cover(replay.topSixIds)},
    }
  }

  const env = await environment()
  try {
    const mapping = await saveCondition(env, history, plan.admitted, condition)
    const results = []
    for (const arm of arms) results.push(await observedArm(env, question, arm, mode === 'mock'))
    let grading
    let gradeFailure
    if (mode === 'live') {
      try {
        grading = await gradePilotAnswers(
          row,
          results.map((result) => result.answer),
          model,
        )
      } catch (error) {
        gradeFailure = errorKind(error)
      }
    }

    return {
      gradeFailure,
      mapping,
      observed: results.map(({answer: hypothesis, observed}, index) => ({
        ...observed,
        answerHash: digest(hypothesis),
        coverage: attachedCoverage(row, history, mapping, observed),
        judgedCorrect: observed.outcome === 'completed' && hypothesis ? (grading?.correct?.[index] ?? null) : null,
      })),
    }
  } finally {
    await env.close()
  }
}

function omissionCounts(row, history, omitted) {
  return Object.fromEntries(
    ['oversize-turn', 'project-entry-cap', 'project-byte-cap'].map((reason) => {
      const spans = omitted.filter((item) => item.reason === reason)
      return [reason, {annotatedTurns: annotationCoverage(row, history, spans).complete, spans: spans.length}]
    }),
  )
}

export async function evaluateStudyCase(row, index, mode) {
  assert(['live', 'mock', 'replay'].includes(mode), 'Unknown evaluation mode')
  const history = historyWithOffsets(row)
  const output = {}
  const order = index % 2 === 0 ? conditions : [...conditions].reverse()
  for (const condition of order) {
    try {
      const plan = ingestionPlan(history, condition)
      const result = await runCondition(row, history, plan, {condition, mode})
      output[condition] = {
        ...result,
        admitted: annotationCoverage(row, history, result.mapping),
        omissions: omissionCounts(row, history, plan.omitted),
        omittedOffsets: plan.omitted,
        state: 'completed',
      }
    } catch (error) {
      output[condition] = {failure: errorKind(error), state: 'failed'}
    }
  }

  return output
}

function accumulateArm(target, arm) {
  target.completed += Number(arm.outcome === 'completed')
  target.graded += Number(arm.judgedCorrect !== null)
  target.correct += Number(arm.judgedCorrect === true)
  target.withSearch += Number(arm.searches.length > 0)
  target.withDeliveredEvidence += Number(deliveredIds(arm).length > 0)
  target.annotatedTurnsDelivered += arm.coverage.complete
  target.withRejectedRequest += Number(arm.wireRequests.some(({replyReturned}) => replyReturned === false))
  target.withContextOverflow += Number(
    arm.outcomes.providerFailures?.some(({kind}) => kind === 'ContextOverflowError') ?? false,
  )
  const stop = arm.outcomes.terminal?.stopRequest ?? arm.outcomes.terminal?.outcome ?? 'unknown'
  target.outcomes[stop] = (target.outcomes[stop] ?? 0) + 1
}

function emptyArm() {
  return {
    annotatedTurnsDelivered: 0,
    completed: 0,
    correct: 0,
    graded: 0,
    outcomes: {},
    withContextOverflow: 0,
    withDeliveredEvidence: 0,
    withRejectedRequest: 0,
    withSearch: 0,
  }
}

function accumulateCondition(counts, row) {
  counts.completed++
  counts.annotatedTurns += row.admitted.annotated
  counts.admittedAnnotatedTurns += row.admitted.complete
  counts.answerableQuestionsWithAnnotations += Number(row.admitted.annotated > 0)
  counts.allAnnotatedQuestionsAdmitted += Number(
    row.admitted.annotated > 0 && row.admitted.annotated === row.admitted.complete,
  )
  counts.topSixAnnotatedTurnsInReplay += row.replay?.topSixCoverage.complete ?? 0
  counts.allAnnotatedQuestionsInTopSixReplay += Number(
    row.admitted.annotated > 0 && row.replay?.topSixCoverage.complete === row.admitted.annotated,
  )
  counts.returnedAnnotatedTurnsInReplay += row.replay?.coverage.complete ?? 0
  counts.allAnnotatedQuestionsReturnedInReplay += Number(
    row.admitted.annotated > 0 && row.replay?.coverage.complete === row.admitted.annotated,
  )
  for (const [reason, loss] of Object.entries(row.omissions)) {
    counts.omitted[reason] ??= {annotatedTurns: 0, cases: 0, spans: 0}
    const aggregate = counts.omitted[reason]
    aggregate.annotatedTurns += loss.annotatedTurns
    aggregate.cases += Number(loss.spans > 0)
    aggregate.spans += loss.spans
  }

  for (const arm of row.observed ?? []) accumulateArm(counts.arms[arm.arm], arm)
}

export function studySummary(cases, mode, planned) {
  const summary = {
    conditions: {},
    mode,
    pairedCompleted: 0,
    pairedEligibleByArm: Object.fromEntries(
      arms.map((arm) => [arm, {bothCorrect: 0, bothWrong: 0, eligible: 0, prefixOnly: 0, turnChunksOnly: 0}]),
    ),
    planned,
    recorded: cases.length,
  }
  for (const condition of conditions) {
    const counts = {
      admittedAnnotatedTurns: 0,
      allAnnotatedQuestionsAdmitted: 0,
      allAnnotatedQuestionsInTopSixReplay: 0,
      allAnnotatedQuestionsReturnedInReplay: 0,
      annotatedTurns: 0,
      answerableQuestionsWithAnnotations: 0,
      arms: Object.fromEntries(arms.map((arm) => [arm, emptyArm()])),
      completed: 0,
      failed: 0,
      omitted: {},
      returnedAnnotatedTurnsInReplay: 0,
      topSixAnnotatedTurnsInReplay: 0,
    }
    summary.conditions[condition] = counts
    for (const record of cases) {
      const row = record[condition]
      if (row.state !== 'completed') {
        counts.failed++
        continue
      }

      accumulateCondition(counts, row)
    }
  }

  for (const record of cases) {
    const [a, b] = conditions.map((condition) => record[condition])
    if (a.state !== 'completed' || b.state !== 'completed') continue
    summary.pairedCompleted++
    for (const arm of arms) {
      const x = a.observed?.find((r) => r.arm === arm)?.judgedCorrect
      const y = b.observed?.find((r) => r.arm === arm)?.judgedCorrect
      if (typeof x !== 'boolean' || typeof y !== 'boolean') continue
      const aggregate = summary.pairedEligibleByArm[arm]
      aggregate.eligible++
      const key = x ? (y ? 'bothCorrect' : 'prefixOnly') : y ? 'turnChunksOnly' : 'bothWrong'
      aggregate[key]++
    }
  }

  return summary
}

async function main() {
  const {values} = parseArgs({
    options: {
      commit: {type: 'string'},
      dataset: {type: 'string'},
      mode: {default: 'replay', type: 'string'},
      'output-dir': {type: 'string'},
    },
  })
  const {commit, mode} = values
  assert(
    values.dataset && values['output-dir'],
    'Use --dataset PATH --output-dir tmp/NAME [--mode replay|mock|live] --commit FULL_SHA',
  )
  assert(['live', 'mock', 'replay'].includes(mode), 'Unknown evaluation mode')
  assert(/^[a-f0-9]{40}$/u.test(commit ?? ''), 'Supply the exact evaluation commit as --commit FULL_SHA')
  const bytes = await fs.readFile(values.dataset)
  assert.equal(digest(bytes), dataset.sha256, 'Dataset checksum mismatch')
  const selected = selectCases(JSON.parse(bytes))
  assert.equal(selected.length, 30)
  assert.equal(new Set(selected.map((row) => row.question_id)).size, 30)
  if (mode === 'live') {
    const metadata = await localModelMetadata(model)
    assert.equal(metadata.modelDigest, modelDigest, 'The installed Gemma model must match the historical digest')
  }

  const output = await createStudyOutput(values['output-dir'])
  const manifest = {
    commit,
    dataset,
    mode,
    planned: 30,
    policies: limits,
    selectedCaseDigest: digest(JSON.stringify(selected.map((row) => row.question_id))),
    ...(mode === 'live'
      ? {judge: 'local same-model, not official', model, modelDigest, providerChargeUSD: 0}
      : {judge: 'not run'}),
  }
  await write(output, 'manifest.json', manifest)
  const cases = []
  for (const [index, row] of selected.entries()) {
    const result = await evaluateStudyCase(row, index, mode)
    cases.push(result)
    await write(output, `case-${String(index + 1).padStart(2, '0')}.json`, {id: row.question_id, result})
    console.log(`${mode}: ${index + 1}/30`)
  }

  const report = {...studySummary(cases, mode, 30), provenance: manifest}
  await write(output, 'summary.json', report)
  if (report.pairedCompleted !== 30) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
