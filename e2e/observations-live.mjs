// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Run in the evaluation image. Fixture setup executes real writes with a fixed
// model; only the reopened checkpoint/consumer stage uses the actual Ollama model.
import fs from 'node:fs'
import {Ollama} from 'ollama'

import {OllamaAgent, ollamaFetch} from '../dist/core/models/adapters/ollama.js'
import {
  Agent,
  createModelContextPolicy,
  DiagnosticEventBus,
  MemorySessionLogStore,
  Message,
  SessionRepository,
  State,
} from '../dist/index.js'

const root = '/output/observations-live'
fs.mkdirSync(root, {recursive: false})
const repository = new SessionRepository({rootDir: `${root}/sessions`})
repository.initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
const session = repository.create({formatVersion: 2})
let round = 0
const setupModel = {
  getModel: () => 'fixed-observation-setup',
  getName: () => 'fixed-observation-setup',
  getProvider: () => 'ollama',
  async invoke() {
    round++
    return round <= 2
      ? new Message('assistant', {
          content: 'Historical fixture filler. '.repeat(1200),
          payload: {
            toolCalls: [{id: 'reused', input: {content: String(round), path: `observed-${round}.txt`}, name: 'write'}],
          },
        })
      : new Message('assistant', {content: 'The two writes were acknowledged. No tests were run.'})
  },
}
const execution = {policy: {generation: 'isolated-observation-fixture', profile: 'unrestricted', roots: ['/workspace']}}
const setupStore = new MemorySessionLogStore()
const setup = new Agent({
  cwd: '/workspace',
  deps: {createModel: () => setupModel},
  execution,
  logStore: setupStore,
  settings: {model: 'fixed-observation-setup', provider: 'ollama', tools: {profile: 'coding'}},
  state: new State(session),
})
try {
  const result = await (
    await setup.startRun([new Message('user', {content: 'Save observed-1.txt and observed-2.txt; do not run tests.'})])
  ).finished
  if (result.outcome !== 'completed') throw new Error('Fixture operation setup failed')
} finally {
  await setup.close()
  await session.close()
  await setupStore.close()
}

const reopened = await repository.open(session.getFile())
const diagnostics = new DiagnosticEventBus({capture: 'full', fullCaptureDurationMs: 600_000, maxEvents: 1000})
diagnostics.subscribe((event) => fs.appendFileSync(`${root}/events.jsonl`, JSON.stringify(event) + '\n'))
const sdk = new Ollama({fetch: ollamaFetch, host: 'http://host.docker.internal:11434'})
const client = {
  abort: () => sdk.abort(),
  chat: (request) =>
    sdk.chat({
      ...request,
      options: {num_ctx: 32_768, num_predict: 2048, seed: 42, temperature: 0.6, top_p: 0.95, ...request.options},
      think: false,
    }),
  ps: () => sdk.ps(),
  show: (request) => sdk.show(request),
}
const model = new OllamaAgent('ornith-1.5:9b', {getContextWindow: () => 32_768, getName: () => 'ollama'}, {client})
const policy = await createModelContextPolicy(model, {outputReserve: 2048})
// Diagnostic-only forced compaction, not a production profile recommendation.
policy.profile.trigger = 3500
policy.profile.target = 2500
fs.writeFileSync(`${root}/context-policy.json`, JSON.stringify(policy, null, 2))
const store = new MemorySessionLogStore()
const agent = new Agent({
  contextPolicy: policy,
  cwd: '/workspace',
  deps: {createModel: () => model},
  diagnostics,
  execution: {...execution, limits: {elapsedMs: 300_000}},
  logStore: store,
  settings: {model: 'ornith-1.5:9b', provider: 'ollama', tools: {profile: 'none'}},
  state: new State(reopened),
})
let result
try {
  const handle = await agent.startRun([
    new Message('user', {
      content:
        'Report the acknowledged saved operations. Do not perform actions or claim tests passed; no behavioral verification occurred.',
    }),
  ])
  const runtime = await handle.finished
  result = {answer: handle.value()?.content ?? '', runtime}
} finally {
  await agent.close()
  fs.writeFileSync(`${root}/result.json`, JSON.stringify({...result, entries: reopened.getEntries()}, null, 2))
  await reopened.close()
  await store.close()
}
