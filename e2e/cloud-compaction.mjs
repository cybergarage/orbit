// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {FileExecutionJournal} from '../dist/core/execution/journal.js'
import {RunSupervisor} from '../dist/core/execution/run.js'
import {estimateJSONRequest, prepareSessionContext} from '../dist/core/session/context-policy.js'
import {DiagnosticEventBus, Message, SessionContextBuilder, SessionRepository} from '../dist/index.js'
import {compactionMetrics, experimentPolicy} from './compaction-config.mjs'
import {createEvaluationModel} from './evaluation-model.mjs'
import {sourceFingerprint} from './source-fingerprint.mjs'

// Model selection is part of the experiment, never a provider default or an environment fallback.
const selections = [
  {model: 'gpt-4o-2024-08-06', provider: 'openai'},
  {model: 'claude-opus-4-6', provider: 'anthropic'},
]
const live = process.argv.includes('--run')
if (process.argv.slice(2).some((arg) => !['--prepare-only', '--run'].includes(arg)))
  throw new Error('Use --run or --prepare-only')
const root = path.resolve('tmp/e2e/cloud-compaction', new Date().toISOString().replaceAll(':', '-'))
await fs.mkdir(root, {recursive: true})
const fixture = [
  new Message('user', {
    content:
      'Continue the parser repair. Preserve the branch, compatibility marker and pending check. When asked to continue, report these three values and say that the pending check has not been executed.',
  }),
  new Message('assistant', {
    content:
      'Active branch: repair-parser. Compatibility marker: PARSER-COMPAT-7821.\n' +
      Array.from(
        {length: 1000},
        (_, i) => `Inspection ${i}: unchanged lookup tables need no edits; routine diagnostic noise.`,
      ).join('\n') +
      '\nPending check: tests/test_parser_compat.py. It has not been executed.',
  }),
  new Message('user', {
    content:
      'Continue from the recorded state by reporting the branch, marker, pending check and its execution status. Do not execute any tools.',
  }),
]
const source = fixture.map((message) => ({content: message.content, id: message.id, type: message.type}))
const manifest = {
  kind: 'synthetic-eocc-save-resume-continuation',
  live,
  rows: [],
  runnerSha256: createHash('sha256')
    .update(await fs.readFile(new URL(import.meta.url)))
    .digest('hex'),
  selections,
  sourceFingerprint: await sourceFingerprint(path.resolve('.')),
  sourceSha256: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
}
await fs.writeFile(path.join(root, 'source.json'), JSON.stringify(source, null, 2))
const writeManifest = () => fs.writeFile(path.join(root, 'results.json'), JSON.stringify(manifest, null, 2))
await writeManifest()

async function evaluate(selection, arm) {
  const directory = path.join(root, selection.provider, arm)
  await fs.mkdir(directory, {recursive: true})
  const policy = experimentPolicy({
    ...selection,
    arm,
    outputReserve: 4096,
    target: 8192,
    trigger: 12_288,
    window: 32_768,
  })
  const row = {...selection, arm, checks: {}, policy, status: live ? 'failed' : 'prepared'}
  const events = []
  const diagnostics = new DiagnosticEventBus({capture: 'full', fullCaptureDurationMs: 300_000, maxEvents: 20_000})
  diagnostics.subscribe((event) => events.push(event))
  let session
  let selected
  const supervisor = new RunSupervisor()
  try {
    // Offline mode validates the request through real serializers without resolving credentials.
    selected = createEvaluationModel(
      selection,
      live ? process.env : {[`ORBIT_TEST_${selection.provider.toUpperCase()}_API_KEY`]: 'offline-placeholder'},
    )
    const {model} = selected
    row.beforeEstimate = estimateJSONRequest(model.prepare(fixture).request, policy.profile).tokens
    assert.ok(
      row.beforeEstimate > policy.profile.trigger &&
        row.beforeEstimate < policy.profile.window - policy.profile.summaryOutput - 2048,
    )
    if (!live) return
    const repository = new SessionRepository({rootDir: path.join(directory, 'sessions')})
    repository.initializeStorage({
      allWritersStopped: true,
      automaticRestartersDisabled: true,
      exclusiveStorageControl: true,
    })
    session = repository.create({...selection, formatVersion: 2, originator: 'cloud-compaction-diagnostic'})
    session.appendMessages(fixture)
    const file = session.getFile()
    const runPhase = async (continueModel) => {
      let phaseJournal
      try {
        const handle = await supervisor.startRun({
          configuration: {...selection, arm, phase: continueModel ? 'continue' : 'compact'},
          async execute(run) {
            await run.ready([])
            const prepared = await prepareSessionContext({
              actionMode: 'single',
              model,
              modelOptions: {diagnostics, signal: run.signal, tools: []},
              policy,
              prefix: [],
              run,
              session,
            })
            if (!continueModel) return prepared.request
            run.consume('modelCalls')
            const response = await run.wait('model', prepared.invoke())
            session.appendMessages([response])
            return {
              request: prepared.request,
              response: {content: response.content, metadata: response.payload.response},
            }
          },
          input: {},
          async journal() {
            const journal = await FileExecutionJournal.open(session.getId(), {
              lease: session.acquireWriterLease(),
              root: repository.journalRoot,
            })
            phaseJournal = journal
            await session.synchronize(journal.level)
            return journal
          },
          limits: {elapsedMs: 180_000, modelCalls: 6},
          requestId: `${selection.provider}-${arm}-${continueModel}`,
          sessionId: session.getId(),
        })
        const runtime = await handle.finished
        row[continueModel ? 'continuationRuntime' : 'compactionRuntime'] = runtime
        assert.equal(runtime.outcome, 'completed')
        return handle.value()
      } finally {
        await phaseJournal?.close()
      }
    }

    const preparedRequest = await runPhase(false)
    const checkpoint = session.getCompaction()
    assert.ok(checkpoint, 'Compaction must commit before continuation')
    row.checks.compacted = true
    row.checkpoint = checkpoint
    assert.ok(checkpoint.afterTokens < checkpoint.beforeTokens)
    row.checks.reduced = true
    const projection = new SessionContextBuilder().build(session)
    assert.ok(!JSON.stringify(projection).includes('Inspection 999:'), 'Raw history must be omitted')
    row.checks.rawHistoryOmitted = true
    await session.close()
    session = repository.open(file)
    assert.deepEqual(session.getCompaction(), checkpoint)
    assert.deepEqual(new SessionContextBuilder().build(session), projection)
    row.checks.savedAndReopened = true
    const continuation = await runPhase(true)
    assert.deepEqual(continuation.request, preparedRequest, 'Resume must reconstruct the same provider request')
    row.checks.requestReconstructed = true
    row.continuation = continuation.response
    const answer = continuation.response.content
    assert.ok(
      answer.includes('repair-parser') &&
        answer.includes('PARSER-COMPAT-7821') &&
        answer.includes('tests/test_parser_compat.py'),
    )
    assert.match(answer, /not (?:been )?(?:executed|run)/i)
    row.checks.continuedWithRetainedFacts = true
    await session.close()
    session = repository.open(file)
    assert.equal(session.getConversationMessages().at(-1).content, answer)
    row.checks.continuationSaved = true
    assert.equal(events.filter((event) => event.type === 'context.compaction.completed').length, 1)
    row.checks.noRecompactionOnResume = true
    row.status = 'passed'
  } catch (error) {
    row.status = 'failed'
    // Redact credential values before recording a diagnostic failure.
    let message = String(error.message)
    for (const [key, value] of Object.entries(process.env)) {
      if (/KEY|TOKEN|SECRET/.test(key) && value) message = message.split(value).join('[REDACTED]')
    }

    row.error = {code: error.code ?? null, message, name: error.name, status: error.status ?? null}
  } finally {
    await session?.close()
    await supervisor.close()
    selected?.close()
    row.metrics = compactionMetrics(events)
    await fs.writeFile(path.join(directory, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n'))
    manifest.rows.push(row)
    await writeManifest()
    console.log(
      JSON.stringify({
        arm,
        checks: row.checks,
        error: row.error,
        model: row.model,
        provider: row.provider,
        status: row.status,
      }),
    )
  }
}

// Serial execution keeps each provider call and its evidence attributable to one arm.
for (const selection of selections) {
  for (const arm of ['eocc-structured', 'eocc']) {
    await evaluate(selection, arm)
  }
}

console.log(`Evidence: ${root}`)
if (manifest.rows.some((row) => row.status === 'failed')) process.exitCode = 1
