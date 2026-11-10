// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import {Ollama} from 'ollama'

import {OllamaAgent, ollamaFetch} from '../dist/core/models/adapters/ollama.js'
import {
  Agent,
  createModelContextPolicy,
  DiagnosticEventBus,
  MemorySessionLogStore,
  Message,
  Session,
  State,
} from '../dist/index.js'
import {compactionMetrics, experimentPolicy} from './compaction-config.mjs'

const configFile = process.argv[2] ?? '/input/config.json'
if (!['/input/config.json', '/logs/agent/orbit-config.json'].includes(configFile))
  throw new Error('Unsupported evaluation configuration path')
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
const workspace = config.workspace ?? '/workspace'
const output = config.outputDirectory ?? '/output'
fs.mkdirSync(output, {recursive: true})
if (config.copyFixture !== false) fs.cpSync('/fixture', workspace, {recursive: true, verbatimSymlinks: true})
const events = []
const session = new Session({formatVersion: 2})
const diagnostics = new DiagnosticEventBus({
  capture: 'full',
  // Full diagnostic payloads remain bounded independently of execution duration.
  fullCaptureDurationMs: config.timeoutMs === 'unlimited' ? 86_400_000 : config.timeoutMs + 30_000,
  maxEvents: 20_000,
})
diagnostics.subscribe((event) => {
  events.push({data: event.type === 'model.response.completed' ? {usage: event.data?.usage} : {}, type: event.type})
  fs.appendFileSync(path.join(output, 'events.jsonl'), JSON.stringify(event) + '\n')
})
const sdk = new Ollama({fetch: ollamaFetch, host: config.ollamaHost})
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
let contextPolicy
if (config.compactionArm) {
  contextPolicy = experimentPolicy({arm: config.compactionArm, model: config.model, ...config.compactionBudgets})
} else if (config.contextPolicy === 'budgeted' || config.strategy.startsWith('book-')) {
  contextPolicy = await createModelContextPolicy(model, {outputReserve: config.options.num_predict})
}
if (contextPolicy?.mode === 'budgeted' && config.contextTriggerRatio !== undefined) {
  const {outputReserve, safetyMargin, window} = contextPolicy.profile
  const inputBudget = window - outputReserve - safetyMargin
  contextPolicy.profile.trigger = Math.floor(inputBudget * config.contextTriggerRatio)
  contextPolicy.profile.target = Math.min(contextPolicy.profile.target, contextPolicy.profile.trigger - 1)
}

if (contextPolicy) fs.writeFileSync(path.join(output, 'context-policy.json'), JSON.stringify(contextPolicy, null, 2))
const agent = new Agent({
  contextPolicy,
  cwd: workspace,
  deps: {createModel: () => model},
  diagnostics,
  execution: {
    actionMode: config.executionActionMode ?? 'multiple',
    limits: {
      cleanupMs: 5000,
      elapsedMs: config.timeoutMs,
      modelCalls: config.rounds === 'unlimited' ? 'unlimited' : config.rounds + 1,
      toolRequests: config.rounds === 'unlimited' ? 'unlimited' : config.rounds * 8,
      toolRounds: config.rounds,
    },
    policy: {generation: 'isolated-e2e-v1', profile: 'unrestricted', roots: [workspace]},
  },
  logStore: new MemorySessionLogStore(),
  settings: config.toolset === 'bash' ? {tools: {include: ['bash']}} : {},
  state: new State(session),
  toolProfile: config.toolset === 'bash' ? 'none' : 'coding',
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
  result.evaluation = compactionMetrics(events)
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
}
