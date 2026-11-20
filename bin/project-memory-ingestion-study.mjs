// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Isolated ordered evaluation and official dataset field names. */

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
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
  answerLimits,
  answerSettings,
  dataset,
  environment,
  ingest,
  instruction,
  localModelMetadata,
  selectCases,
} from './project-memory-pilot.mjs'
import {answerSlots, openCheckpointRun, runSlots} from './project-memory-study-checkpoints.mjs'
import {judgeOne, judgeSettings, judgeTimeoutMs, rubric} from './project-memory-study-judge.mjs'

const model = 'gemma4:12b'
const modelDigest = '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c'
const pinnedDatasetBytes = 277_383_467
const conditions = ['prefix', 'turn-chunks']
const arms = ['none', 'pre', 'tool']

function errorKind(error) {
  return error instanceof Error ? error.name : 'unknown'
}

async function privateTmp(cwd) {
  const parent = path.join(await fs.realpath(cwd), 'tmp')
  assert.equal(await fs.realpath(parent), parent, 'Evaluation tmp/ must not be a symbolic link')
  return parent
}

export async function createStudyOutput(request, cwd = process.cwd(), {resume = false} = {}) {
  const match = /^tmp\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/u.exec(request)
  assert(match, 'Output must be a named direct child of the ignored tmp/ directory')
  const parent = await privateTmp(cwd)
  const output = path.join(parent, match[1])
  if (resume) assert.equal(await fs.realpath(output), output, 'Ambiguous resume directory')
  else await fs.mkdir(output, {mode: 0o700})
  return output
}

export async function datasetFile(request, cwd = process.cwd()) {
  const match = /^tmp\/([A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.json)$/u.exec(request)
  assert(match, 'Dataset must be a named JSON file directly under the ignored tmp/ directory')
  const file = path.join(await privateTmp(cwd), match[1])
  const stat = await fs.lstat(file)
  assert(
    stat.isFile() && stat.size === pinnedDatasetBytes && (await fs.realpath(file)) === file,
    'Expected the pinned public dataset file',
  )
  return file
}

async function readDataset(request) {
  const file = await datasetFile(request)
  // Open once, do not follow a swapped symlink, and confirm the opened file is still the validated leaf.
  const handle = await fs.open(file, constants.O_RDONLY + (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const leaf = await fs.lstat(file)
    assert(
      opened.isFile() &&
        leaf.isFile() &&
        opened.dev === leaf.dev &&
        opened.ino === leaf.ino &&
        opened.size === pinnedDatasetBytes &&
        (await fs.realpath(file)) === file,
      'Dataset changed before reading',
    )
    const bytes = await handle.readFile()
    assert.equal(digest(bytes), dataset.sha256, 'Dataset checksum mismatch')
    return bytes
  } finally {
    await handle.close()
  }
}

async function write(output, file, value) {
  assert(/^(?:manifest|summary|case-(?:0[1-9]|[12][0-9]|30))\.json$/u.test(file), 'Invalid replay artifact name')
  assert.equal(await fs.realpath(output), output, 'Ambiguous replay directory')
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
    return {
      mapping,
      observed: results.map(({answer: hypothesis, observed}) => ({
        ...observed,
        answerHash: digest(hypothesis),
        coverage: attachedCoverage(row, history, mapping, observed),
        judgedCorrect: null,
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
  assert(['mock', 'replay'].includes(mode), 'Live evaluation requires resumable checkpoints')
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
  counts.completed += Number(row.state === 'completed')
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
      if (row.state !== 'completed') counts.failed++
      if (!row.admitted) continue
      accumulateCondition(counts, row)
    }
  }

  for (const record of cases) {
    const [a, b] = conditions.map((condition) => record[condition])
    if (a.state === 'completed' && b.state === 'completed') summary.pairedCompleted++
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

async function verifyCode() {
  const files = [
    'bin/project-memory-ingestion-study.mjs',
    'bin/project-memory-ingestion-study-core.mjs',
    'bin/project-memory-ingestion-study-trace.mjs',
    'bin/project-memory-study-checkpoints.mjs',
    'bin/project-memory-study-judge.mjs',
    'bin/project-memory-pilot.mjs',
    'package-lock.json',
  ]
  async function compiled(dir) {
    const entries = await fs.readdir(new URL(`../${dir}`, import.meta.url), {withFileTypes: true})
    for (const entry of entries) {
      const relative = dir + entry.name
      if (entry.isDirectory()) await compiled(relative + '/')
      else if (entry.isFile() && relative.endsWith('.js')) files.push(relative)
    }
  }

  await compiled('dist/core/')
  const fingerprints = []
  for (const file of files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    fingerprints.push([file, digest(await fs.readFile(new URL(`../${file}`, import.meta.url)))])
  }

  const sdk = JSON.parse(await fs.readFile(new URL('../node_modules/ollama/package.json', import.meta.url), 'utf8'))
  return {codeDigest: digest(JSON.stringify(fingerprints)), node: process.version, ollamaSdk: sdk.version}
}

export async function runCheckpointCase(row, slots, store, mode) {
  assert(['live', 'mock'].includes(mode), 'Checkpoint generation mode must be live or mock')
  const history = historyWithOffsets(row)
  const plans = Object.fromEntries(conditions.map((condition) => [condition, ingestionPlan(history, condition)]))
  const environments = new Map()
  const generate = async ({arm, condition}) => {
    let source = environments.get(condition)
    if (!source) {
      const env = await environment()
      source = {env, mapping: []}
      environments.set(condition, source)
      if (condition !== 'shared')
        source.mapping = await saveCondition(env, history, plans[condition].admitted, condition)
    }

    const question = `Current date: ${row.question_date}\n${row.question}`
    const {answer: hypothesis, observed} = await observedArm(source.env, question, arm, mode === 'mock')
    return {
      answer: hypothesis,
      mapping: source.mapping,
      trace: {...observed, coverage: attachedCoverage(row, history, source.mapping, observed)},
    }
  }

  try {
    await runSlots(store, slots, {
      generate,
      grade: mode === 'live' ? (_caseId, hypothesis) => judgeOne(row, hypothesis, model) : undefined,
    })
  } finally {
    for (const source of environments.values()) await source.env.close()
  }

  return Object.fromEntries(
    conditions.map((condition) => {
      const plan = plans[condition]
      const observed = slots
        .filter((slot) => slot.condition === condition || slot.condition === 'shared')
        .map((slot) => {
          const answer = store.answers.get(slot.key)
          return {...answer.trace, judgedCorrect: store.grades.get(slot.key)?.correct ?? null}
        })
      return [
        condition,
        {
          admitted: annotationCoverage(row, history, plan.admitted),
          observed,
          omissions: omissionCounts(row, history, plan.omitted),
          state: observed.every(({outcome}) => outcome === 'completed') ? 'completed' : 'incomplete',
        },
      ]
    }),
  )
}

async function checkpointStudy(output, manifest, selected, resume) {
  const slots = answerSlots(manifest.questionIds)
  const store = await openCheckpointRun(output, manifest, slots, {resume})
  try {
    const cases = []
    for (const [index, row] of selected.entries()) {
      const perCase = slots.filter((slot) => slot.caseId === row.question_id)
      cases.push(await runCheckpointCase(row, perCase, store, manifest.mode))
      console.log(`${manifest.mode}: ${index + 1}/30 visited`)
    }

    const publicManifest = {...manifest}
    delete publicManifest.questionIds
    const summary = {
      ...studySummary(cases, manifest.mode, 30),
      checkpointedAnswers: store.answers.size,
      completedGrades: store.grades.size,
      plannedUniqueAnswers: slots.length,
      provenance: publicManifest,
    }
    await store.writeSummary(summary)
    if (summary.pairedCompleted !== 30 || (manifest.mode === 'live' && store.grades.size !== slots.length))
      process.exitCode = 1
  } finally {
    store.close()
  }
}

async function main() {
  const {values} = parseArgs({
    options: {
      commit: {type: 'string'},
      dataset: {type: 'string'},
      mode: {default: 'replay', type: 'string'},
      'output-dir': {type: 'string'},
      resume: {type: 'boolean'},
    },
  })
  const {commit, mode, resume} = values
  assert(
    values.dataset && values['output-dir'],
    'Use --dataset tmp/NAME.json --output-dir tmp/NAME [--mode replay|mock|live] [--resume] --commit FULL_SHA',
  )
  assert(['live', 'mock', 'replay'].includes(mode), 'Unknown evaluation mode')
  assert(/^[a-f0-9]{40}$/u.test(commit ?? ''), 'Supply the exact evaluation commit as --commit FULL_SHA')
  const bytes = await readDataset(values.dataset)
  const selected = selectCases(JSON.parse(bytes))
  assert.equal(selected.length, 30)
  assert.equal(new Set(selected.map((row) => row.question_id)).size, 30)
  if (mode === 'live') {
    const metadata = await localModelMetadata(model)
    assert.equal(metadata.modelDigest, modelDigest, 'The installed Gemma model must match the historical digest')
  }

  assert(!resume || mode !== 'replay', 'Resume is for live or mock checkpoints; replay uses a new directory')
  const output = await createStudyOutput(values['output-dir'], process.cwd(), {resume})
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
  if (mode !== 'replay') {
    return checkpointStudy(
      output,
      {
        ...manifest,
        ...(await verifyCode()),
        answerLimits,
        answerPromptDigest: digest(instruction),
        answerSettings,
        format: 2,
        gradingProtocol: 'independent-single-answer-v1',
        judgeDigest: mode === 'live' ? modelDigest : 'none',
        judgeSettings,
        judgeTimeoutMs,
        questionIds: selected.map((row) => row.question_id),
        rubricDigest: digest(rubric),
        searchPolicy: {limit: 6, maxQueryUnits: 512, prepareTokens: 2048, resultTokens: 2048},
      },
      selected,
      resume,
    )
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
