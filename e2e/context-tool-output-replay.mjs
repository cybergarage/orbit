// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Docker driver shared verbatim across baseline and candidate images. Real Ollama
// performs every summary invocation; the final consumer is deliberately fixed.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import {Ollama} from 'ollama'

import {OllamaAgent, ollamaFetch} from '../dist/core/models/adapters/ollama.js'
import {persistedContextMessage} from '../dist/core/session/compaction.js'
import {
  Agent,
  createModelContextPolicy,
  DiagnosticEventBus,
  MemorySessionLogStore,
  Message,
  Session,
  State,
} from '../dist/index.js'

const fixtureBytes = fs.readFileSync('/input/history.json')
const fixture = JSON.parse(fixtureBytes)
const session = new Session({
  entries: fixture.messages.map((message) => ({message, timestamp: message.timestamp, type: 'message'})),
  formatVersion: 2,
  messages: fixture.messages.map((message) => new Message(message.type, message)),
  metadata: {
    createdAt: '2026-09-29T00:00:00.000Z',
    id: '00000000-0000-4000-8000-000000000001',
    rootMessageId: fixture.messages[0].parentid,
  },
})
const root = '/output/replay'
fs.mkdirSync(root, {recursive: false})
const diagnostics = new DiagnosticEventBus({capture: 'full', fullCaptureDurationMs: 1_800_000, maxEvents: 2000})
diagnostics.subscribe((event) => fs.appendFileSync(`${root}/events.jsonl`, JSON.stringify(event) + '\n'))
const sdk = new Ollama({fetch: ollamaFetch, host: 'http://host.docker.internal:11434'})
const responses = []
const client = {
  abort: () => sdk.abort(),
  async chat(request) {
    const started = performance.now()
    const response = await sdk.chat({
      ...request,
      options: {num_ctx: 32_768, num_predict: 2048, seed: 42, temperature: 0.6, top_p: 0.95, ...request.options},
      stream: false,
      think: false,
    })
    responses.push({
      doneReason: response.done_reason,
      elapsedMs: performance.now() - started,
      inputTokens: response.prompt_eval_count,
      outputTokens: response.eval_count,
      summary: response.message.content,
    })
    fs.writeFileSync(`${root}/responses.json`, JSON.stringify(responses, null, 2))
    return response
  },
  ps: () => sdk.ps(),
  show: (request) => sdk.show(request),
}
const model = new OllamaAgent('ornith-1.5:9b', {getContextWindow: () => 32_768, getName: () => 'ollama'}, {client})
const policy = await createModelContextPolicy(model, {outputReserve: 4096})
// Same diagnostic thresholds in both conditions; production defaults are unchanged.
policy.profile.trigger = 8000
policy.profile.target = 7000
const prepare = model.prepare.bind(model)
const requests = []
let reconstructed = 0
let referencedStreams = 0
let sourceBytes = 0
let renderedBytes = 0
const expected = new Map(fixture.messages.map((message) => [message.id, message]))
model.prepare = (messages, options) => {
  const prepared = prepare(messages, options)
  if (options?.responseFormat !== 'json')
    return {
      ...prepared,
      async invoke() {
        return new Message('assistant', {content: 'Fixed consumer; summary-only diagnostic completed.'})
      },
    }
  const source = JSON.parse(messages[0].content.split('\nSOURCE: ')[1])
  let references = 0
  let bytesBefore = 0
  let bytesAfter = 0
  for (const rendered of source.messages) {
    const originalMessage = expected.get(rendered.id)
    assert.ok(originalMessage, 'Summary source must retain original UUIDs')
    const restored = structuredClone(rendered)
    const output = restored.payload?.output
    if (output?.encoding === 'orbit-tool-output-references-v1' && !originalMessage.payload?.output?.encoding) {
      const {streams, value} = output
      for (const [stream, ref] of Object.entries(streams)) {
        assert.ok(['stderr', 'stdout'].includes(stream))
        value.details[stream] = value.content[ref.contentIndex].text.slice(ref.start, ref.start + ref.length)
        references++
      }

      restored.payload.output = value
    }

    assert.deepEqual(restored, originalMessage, 'Independent reconstruction must preserve all source fields')
    bytesBefore += Buffer.byteLength(JSON.stringify(originalMessage))
    bytesAfter += Buffer.byteLength(JSON.stringify(rendered))
  }

  return {
    ...prepared,
    async invoke(invokeOptions) {
      requests.push({
        referencedStreams: references,
        renderedBytes: bytesAfter,
        sourceBytes: bytesBefore,
        sourceIds: source.messages.map((message) => message.id),
      })
      reconstructed += source.messages.length
      referencedStreams += references
      sourceBytes += bytesBefore
      renderedBytes += bytesAfter
      return prepared.invoke(invokeOptions)
    },
  }
}

const store = new MemorySessionLogStore()
const agent = new Agent({
  contextPolicy: policy,
  cwd: '/workspace',
  deps: {createModel: () => model},
  diagnostics,
  execution: {limits: {elapsedMs: 1_800_000}},
  logStore: store,
  settings: {model: 'ornith-1.5:9b', provider: 'ollama', tools: {profile: 'none'}},
  state: new State(session),
})
const started = performance.now()
let runtime
let error
try {
  runtime = await (await agent.startRun([new Message(fixture.request.type, fixture.request)])).finished
} catch (error_) {
  error = {message: error_.message, name: error_.name}
} finally {
  await agent.close()
  let unchanged = true
  try {
    assert.deepEqual(
      session
        .getConversationMessages()
        .slice(0, fixture.messages.length)
        .map((message) => persistedContextMessage(message)),
      fixture.messages,
    )
  } catch {
    unchanged = false
  }

  fs.writeFileSync(
    `${root}/result.json`,
    JSON.stringify(
      {
        canonicalUnchanged: unchanged,
        checkpoint: session.getCompaction() ?? null,
        consumer: 'fixed; no ordinary inference or tools',
        elapsedMs: performance.now() - started,
        error,
        fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
        policy,
        reconstructed,
        referencedStreams,
        renderedBytes,
        requests,
        responses,
        runtime,
        sourceBytes,
        sourceIds: fixture.messages.map((message) => message.id),
      },
      null,
      2,
    ),
  )
  await session.close()
  await store.close()
}
