// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import {Ollama} from 'ollama'

import {OllamaAgent} from '../dist/core/models/adapters/ollama.js'
import {
  Agent,
  createModelContextPolicy,
  DiagnosticEventBus,
  MemorySessionLogStore,
  Message,
  Session,
  State,
} from '../dist/index.js'

const config = JSON.parse(fs.readFileSync('/input/config.json', 'utf8'))
fs.cpSync('/fixture', '/workspace', {recursive: true, verbatimSymlinks: true})
const session = new Session({formatVersion: 2})
const diagnostics = new DiagnosticEventBus({
  capture: 'full',
  // Full diagnostic payloads remain bounded independently of execution duration.
  fullCaptureDurationMs: config.timeoutMs === 'unlimited' ? 86_400_000 : config.timeoutMs + 30_000,
  maxEvents: 20_000,
})
diagnostics.subscribe((event) => fs.appendFileSync('/output/events.jsonl', JSON.stringify(event) + '\n'))
const sdk = new Ollama({host: config.ollamaHost})
// Test-local transport configuration: exercise the real Orbit serializer and
// response parser. Expose num_ctx so discovery sees the same runtime setting;
// prepared output/context limits take precedence over test defaults.
const client = {
  abort: () => sdk.abort(),
  chat: (request) =>
    sdk.chat({...request, keep_alive: '60s', options: {...config.options, ...request.options}, think: config.think}),
  ps: () => sdk.ps(),
  show: (request) => sdk.show(request),
}
const model = new OllamaAgent(
  config.model,
  {getContextWindow: () => config.options.num_ctx, getName: () => 'ollama'},
  {client},
)
const contextPolicy = config.strategy.startsWith('book-')
  ? await createModelContextPolicy(model, {outputReserve: config.options.num_predict})
  : undefined
if (contextPolicy) fs.writeFileSync('/output/context-policy.json', JSON.stringify(contextPolicy, null, 2))
const agent = new Agent({
  contextPolicy,
  cwd: '/workspace',
  deps: {createModel: () => model},
  diagnostics,
  execution: {
    limits: {
      cleanupMs: 5000,
      elapsedMs: config.timeoutMs,
      modelCalls: config.rounds === 'unlimited' ? 'unlimited' : config.rounds + 1,
      toolRequests: config.rounds === 'unlimited' ? 'unlimited' : config.rounds * 8,
      toolRounds: config.rounds,
    },
    policy: {generation: 'isolated-e2e-v1', profile: 'unrestricted', roots: ['/workspace']},
  },
  logStore: new MemorySessionLogStore(),
  state: new State(session),
  toolProfile: 'coding',
})
const result = {sessionId: session.getId(), startedAt: new Date().toISOString()}
let handle
const stop = () => handle?.requestStop('Host requested termination')
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
try {
  handle = await agent.startRun([new Message('user', {content: config.prompt})], {maxToolIterations: config.rounds})
  result.runtime = await handle.finished
  result.answer = handle.value()?.content ?? ''
} catch (error) {
  result.error = String(error)
} finally {
  try {
    await agent.close()
  } catch (error) {
    result.closeError = String(error)
  }

  result.finishedAt = new Date().toISOString()
  result.entries = session.getEntries()
  fs.writeFileSync('/output/result.json', JSON.stringify(result, null, 2))
}
