#!/usr/bin/env node
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Explicit opt-in: synthetic memory only; no real settings, logs or saved sessions.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Agent, AppleProjectMemoryAgent, createProjectMemorySearchTool, createProvider,
  MemoryProjectStore, MemorySessionLogStore, Message, MessageType,
  ProjectMemoryService, ProjectService, SessionRepository, State,
} from '../dist/index.js'

if (process.argv.length !== 2) throw new Error('This smoke test does not accept arguments')
const helperPath = process.env.ORBIT_APPLE_MEMORY_HELPER_PATH
if (!helperPath) throw new Error('Set ORBIT_APPLE_MEMORY_HELPER_PATH to the explicitly compiled v2 helper')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-apple-memory-'))
const store = new MemoryProjectStore()
const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
repository.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
const host = {async closeThread() {}, getThread() {}}
const projects = new ProjectService(store, repository, host, root)
const memory = new ProjectMemoryService(projects, host)
const native = new AppleProjectMemoryAgent(createProvider('apple'), {helperPath})
let agent
const logs = new MemorySessionLogStore()
let b
try {
  const project = await projects.create({name: 'Synthetic native bridge', operationId: randomUUID()})
  const a = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
  const [message] = a.appendMessages([new Message(MessageType.User, {content: 'Use cobalt for the catalog status indicator.'})])
  await a.synchronize('file-sync')
  const sourceId = a.getId()
  await a.close()
  const entry = await memory.saveExcerpt(project.id, {excerpt: message.content, messageId: message.id, operationId: randomUUID(), sessionId: sourceId, title: 'Catalog status indicator'})
  b = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
  const definition = createProjectMemorySearchTool(memory, {projectId: project.id, sessionId: b.getId()})
  const dispatch = []
  const original = definition.prepare
  definition.prepare = async (input, context) => {
    const prepared = await original(input, context)
    return {...prepared, async execute() {
      const output = await prepared.execute()
      const data = JSON.parse(output.content[0].text)
      dispatch.push({matched: data.results.some((result) => result.id === entry.id && result.sources.some((source) => source.sessionId === sourceId && source.messageId === message.id))})
      return output
    }}
  }

  let first = true
  let transcript
  const nativeCallIds = []
  agent = new Agent({cwd: root, deps: {createModel: () => ({
    getModel: () => native.getModel(), getName: () => native.getName(), getProvider: () => native.getProvider(),
    async invoke(messages, options) {
      if (first) {
        assert.ok(!JSON.stringify(messages).includes('cobalt'))
        assert.ok(!JSON.stringify(messages).includes(sourceId))
        first = false
      }

      const response = await native.invoke(messages, options)
      nativeCallIds.push(...(response.payload?.toolCalls ?? []).map((call) => call.id))
      transcript = response.payload?.response?.providerMetadata?.nativeTranscript ?? transcript
      return response
    },
  })}, logStore: logs, state: new State(b), toolDefinitions: [definition], toolProfile: 'none'})
  const run = await agent.startRun([new Message(MessageType.User, {content: 'Search saved Project memory for the catalog status indicator choice. Use the project_memory_search tool before answering. What color did we choose?'})], {requestId: randomUUID()})
  const result = await run.finished
  assert.equal(result.outcome, 'completed', result.reason)
  assert.ok(dispatch.length > 0, 'The native model must actually call the search tool')
  assert.ok(dispatch.some((event) => event.matched), 'Core must return the saved source-backed entry')
  assert.equal(new Set(nativeCallIds).size, dispatch.length)
  assert.equal(transcript?.calls, dispatch.length)
  assert.equal(transcript?.outputs, dispatch.length)
  assert.equal(transcript?.correlated, true)
  assert.match(b.getMessages().at(-1)?.content ?? '', /cobalt/iu)
  console.log(JSON.stringify({answerMatched: true, coreDispatches: dispatch.length, nativeTranscript: transcript, preInjected: false, separateSessions: true, sourceMatched: true, synthetic: true, uniqueCallIds: nativeCallIds.length}))
} finally {
  native.close()
  await agent?.close()
  await b?.close()
  await memory.close()
  await store.close()
  await fs.rm(root, {force: true, recursive: true})
}
