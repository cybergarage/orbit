// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {Ollama} from 'ollama'

import {MemoryExecutionJournal} from '../../dist/core/execution/journal.js'
import {RunSupervisor} from '../../dist/core/execution/run.js'
import {OllamaAgent, ollamaFetch} from '../../dist/core/models/adapters/ollama.js'
import {estimateJSONRequest, prepareSessionContext} from '../../dist/core/session/context-policy.js'
import {DiagnosticEventBus, Message, Session} from '../../dist/index.js'
import {experimentPolicy} from '../compaction-config.mjs'
import {digest, ollamaMetadata, writeJSON} from '../host.mjs'

const flags = process.argv.slice(2)
if (flags.some((flag) => !['--prepare-only', '--run'].includes(flag)) || flags.length > 1)
  throw new Error('Use --run for live inference or --prepare-only for offline validation')
const out = path.resolve('tmp/e2e/terminal-bench/fixed-history')
await fs.mkdir(out, {recursive: true})
const modelName = 'ornith-1.5:9b'
const sdk = new Ollama({fetch: ollamaFetch, host: 'http://127.0.0.1:11434'})
const model = new OllamaAgent(
  modelName,
  {getContextWindow: () => 32_768, getName: () => 'ollama'},
  {
    client: {
      abort: () => sdk.abort(),
      chat: (request) =>
        sdk.chat({
          ...request,
          options: {num_ctx: 32_768, num_predict: 2048, seed: 42, temperature: 0.6, top_p: 0.95, ...request.options},
          think: false,
        }),
      ps: () => sdk.ps(),
      show: (request) => sdk.show(request),
    },
  },
)
const policy = experimentPolicy({arm: 'suffix', model: modelName, window: 32_768})
const messages = [
  new Message('user', {
    content:
      'Repair the parser without changing the public API. Preserve the active branch, exact compatibility marker and pending check in the handoff.',
    id: 'fixed-task',
    timestamp: '2026-11-11T00:00:00.000Z',
  }),
  new Message('assistant', {
    content:
      'Active branch: repair-parser. Exact compatibility marker: PARSER-COMPAT-7821.\n' +
      Array.from(
        {length: 1000},
        (_, i) => `Inspection ${i}: unchanged lookup tables need no edits; this is routine diagnostic noise.`,
      ).join('\n') +
      '\nThe pending check is tests/test_parser_compat.py. It has not been executed. Do not report it as passed.',
    id: 'fixed-history',
    timestamp: '2026-11-11T00:00:01.000Z',
  }),
  new Message('user', {
    content: 'Continue from the recorded state.',
    id: 'fixed-continue',
    timestamp: '2026-11-11T00:00:02.000Z',
  }),
]
const source = messages.map((m) => ({content: m.content, id: m.id, timestamp: m.timestamp, type: m.type}))
const estimate = estimateJSONRequest(model.prepare(messages).request, policy.profile)
await writeJSON(path.join(out, 'source.json'), {
  description: 'Synthetic fixed-source recap fidelity diagnostic; no task solver or real tool evidence.',
  estimate,
  source,
  sourceSha256: digest(JSON.stringify(source)),
})
if (estimate.tokens < policy.profile.trigger || estimate.tokens > 28_000)
  throw new Error('Fixed history must exercise the trigger with summary headroom')
if (flags.includes('--run')) {
  await writeJSON(path.join(out, 'model.json'), await ollamaMetadata(modelName))
  const rows = []
  async function evaluateArm(arm) {
    const session = new Session({formatVersion: 2})
    session.appendMessages(messages)
    const release = session.acquireManagedLease()
    const supervisor = new RunSupervisor()
    const events = []
    const diagnostics = new DiagnosticEventBus({capture: 'full', maxEvents: 20_000})
    diagnostics.subscribe((e) => events.push(e))
    try {
      const selected = experimentPolicy({arm, model: modelName, window: 32_768})
      const handle = await supervisor.startRun({
        configuration: {arm},
        async execute(run) {
          await run.ready([])
          return prepareSessionContext({
            actionMode: 'single',
            model,
            modelOptions: {diagnostics, tools: []},
            policy: selected,
            prefix: [],
            run,
            session,
          })
        },
        input: {},
        journal: async () => new MemoryExecutionJournal(session.getId()),
        limits: {elapsedMs: 120_000, modelCalls: 4},
        requestId: 'fixed-' + arm,
        sessionId: session.getId(),
      })
      const runtime = await handle.finished
      const checkpoint = session.getCompaction()
      const text = JSON.stringify(checkpoint?.summary ?? {})
      rows.push({
        afterTokens: checkpoint?.afterTokens ?? null,
        arm,
        beforeTokens: checkpoint?.beforeTokens ?? null,
        checkpoint: checkpoint ?? null,
        outcome: runtime.outcome,
        reason: runtime.reason,
        retained: {
          branch: text.includes('repair-parser'),
          marker: text.includes('PARSER-COMPAT-7821'),
          noFalsePass: !(checkpoint?.summary?.tests ?? []).some((t) => t.outcome === 'passed'),
          pendingCheck: text.includes('tests/test_parser_compat.py'),
        },
      })
    } finally {
      sdk.abort()
      release()
      await supervisor.close()
      await session.close()
    }

    await fs.writeFile(path.join(out, arm + '-events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    await writeJSON(path.join(out, 'results.json'), rows)
    console.log(arm, rows.at(-1).outcome, JSON.stringify(rows.at(-1).retained))
  }

  // Queue each arm after the previous one to avoid local-model contention.
  let pending = Promise.resolve()
  for (const arm of ['suffix', 'suffix-handoff', 'eocc-structured', 'eocc', 'sac-structured', 'sac']) {
    // eslint-disable-next-line unicorn/prefer-top-level-await -- Preserve the serial model queue.
    pending = pending.then(() => evaluateArm(arm))
  }

  await pending
} else {
  console.log(JSON.stringify({tokens: estimate.tokens}))
}
