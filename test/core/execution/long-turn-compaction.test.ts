// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {ContextPolicy, Model, ModelInvokeOptions} from '../../../src/core/index.js'

import {
  Agent,
  createModelContextPolicy,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  SessionContextBuilder,
  SessionRepository,
  State,
} from '../../../src/core/index.js'
import {sourceDigest, validateCompactionEntries, validateToolGroups} from '../../../src/core/session/compaction.js'

const profile = {
  model: 'fixture',
  outputReserve: 1000,
  provider: 'ollama',
  revision: 'long-turn-test',
  safetyMargin: 100,
  summaryOutput: 800,
  target: 2800,
  templateOverhead: 0,
  trigger: 4000,
  window: 20_000,
}
const policy: ContextPolicy = {
  estimator: (request) => ({
    components: {json: JSON.stringify(request).length},
    kind: 'estimated',
    model: 'fixture',
    provider: 'ollama',
    revision: 'text-test',
    tokens: JSON.stringify(request).length,
  }),
  mode: 'budgeted',
  profile,
}

function longModel() {
  let rounds = 0
  let summaries = 0
  const requests: Message[][] = []
  const model: Model = {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'ollama',
    async invoke() {
      throw new Error('Expected budgeted preparation')
    },
    prepare(messages: Message[], _options?: Partial<ModelInvokeOptions>) {
      const request = {messages: messages.map((message) => message.content)}
      return {
        async invoke() {
          if (messages[0].content.startsWith('Summarize')) {
            summaries++
            const ids = JSON.parse(messages[0].content.split('ORIGINAL_SOURCE_IDS: ')[1].split('\nSOURCE:')[0])
            return new Message(MessageType.Assistant, {
              content: JSON.stringify({
                changedPaths: [],
                facts: [],
                goals: [{sourceIds: [ids[0]], text: 'Continue the requested work'}],
                tests: [],
                uncertainties: [],
                unfinished: [],
                version: 1,
              }),
            })
          }

          requests.push(messages)
          rounds++
          return new Message(MessageType.Assistant, {
            content: rounds > 7 ? 'Done' : 'Round evidence ' + 'x'.repeat(1300),
            ...(rounds > 7
              ? {}
              : {payload: {toolCalls: [{id: `call-${rounds}`, input: {}, name: 'unavailable_fixture'}]}}),
          })
        },
        request,
      }
    },
  }
  return {model, requests, summaries: () => summaries}
}

async function execute(session: Session) {
  const f = longModel()
  const store = new MemorySessionLogStore()
  const agent = new Agent({
    contextPolicy: policy,
    cwd: os.tmpdir(),
    deps: {createModel: () => f.model},
    logStore: store,
    settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'none'}},
    state: new State(session),
  })
  try {
    const result = await (
      await agent.startRun([
        new Message(MessageType.User, {content: 'ORIGINAL_CONSTRAINT: preserve the interface'}),
        new Message(MessageType.User, {content: 'SECOND_CONSTRAINT: verify the changes'}),
      ])
    ).finished
    expect(result.outcome, JSON.stringify(result)).to.equal('completed')
    return f
  } finally {
    await agent.close()
    await store.close()
  }
}

describe('long-turn compaction', () => {
  it('repeatedly compacts complete rounds and retains every original user input', async () => {
    const session = new Session({formatVersion: 2})
    const f = await execute(session)
    expect(f.summaries()).to.be.greaterThan(1)
    expect(session.getCompaction()?.projectionVersion).to.equal(3)
    expect(session.getCompaction()?.retainedUserIds).to.have.length(2)
    for (const messages of f.requests) {
      expect(messages.filter((m) => m.content.includes('ORIGINAL_CONSTRAINT'))).to.have.length(1)
      expect(messages.filter((m) => m.content.includes('SECOND_CONSTRAINT'))).to.have.length(1)
      expect(() => validateToolGroups(messages)).not.to.throw()
    }

    expect(session.getConversationMessages()).to.have.length(17)
    const projected = new SessionContextBuilder().build(session).messages
    expect(projected.length).to.be.lessThan(17)
    expect(() => validateToolGroups(projected)).not.to.throw()
  })

  it('reopens durable checkpoints with the same projection and rejects missing instructions or split groups', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-long-turn-'))
    try {
      const repository = new SessionRepository({rootDir: root})
      repository.initializeStorage({
        allWritersStopped: true,
        automaticRestartersDisabled: true,
        exclusiveStorageControl: true,
      })
      const session = repository.create({formatVersion: 2})
      await execute(session)
      const expected = new SessionContextBuilder().build(session).messages.map((m) => [m.id, m.content])
      await session.close()
      const reopened = await repository.open(session.getFile()!)
      expect(new SessionContextBuilder().build(reopened).messages.map((m) => [m.id, m.content])).to.deep.equal(expected)
      const entries = structuredClone(reopened.getEntries())
      const checkpoint = entries.find((entry) => entry.type === 'compaction' && entry.projectionVersion === 3)!
      if (checkpoint.type !== 'compaction') throw new Error('Missing checkpoint')
      checkpoint.retainedUserIds = checkpoint.retainedUserIds!.slice(1)
      expect(() => validateCompactionEntries(entries, reopened.getId(), 2)).to.throw(
        'original current-turn instructions',
      )
      const split = structuredClone(reopened.getEntries())
      const position = split.findIndex((entry) => entry.type === 'compaction' && entry.projectionVersion === 3)
      const divided = split[position]
      if (divided.type !== 'compaction') throw new Error('Missing checkpoint')
      const messages = split.slice(0, position).flatMap((entry) => entry.type === 'message' ? [entry.message] : [])
      const cut = messages.findIndex((message) => message.id === divided.firstRetainedId) + 1
      divided.firstRetainedId = messages[cut].id
      divided.prefixEndId = messages[cut - 1].id
      divided.sourceDigest = sourceDigest(messages.slice(0, cut))
      expect(() => validateCompactionEntries(split, reopened.getId(), 2)).to.throw('Unresolved tool call group')
      await reopened.close()
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('derives thresholds from runtime capacity and refuses unknown capacity', async () => {
    const f = longModel()
    f.model.getContextInfo = async () => ({
      contextWindow: 262_144,
      maxInputTokens: null,
      maxOutputTokens: 4096,
      runtimeContextWindow: 32_768,
      source: 'api',
    })
    const derived = await createModelContextPolicy(f.model)
    expect(derived.profile.window).to.equal(32_768)
    expect(derived.profile.target).to.be.lessThan(derived.profile.trigger)
    expect(derived.profile.trigger).to.be.lessThan(32_768 - derived.profile.outputReserve - derived.profile.safetyMargin)
    delete f.model.getContextInfo
    let failure: unknown
    try {
      await createModelContextPolicy(f.model)
    } catch (error) {
      failure = error
    }

    expect(String(failure)).to.contain('unknown-model-context-capacity')
  })
})
