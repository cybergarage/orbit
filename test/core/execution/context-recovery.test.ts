// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import os from 'node:os'

import type {ContextPolicy, Model} from '../../../src/core/index.js'

import {
  Agent,
  ContextOverflowError,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  State,
} from '../../../src/core/index.js'

async function trial(mode = 'length', history = true, maxCalls = 10) {
  const session = new Session({formatVersion: 2})
  if (history)
    session.appendMessages([
      new Message(MessageType.User, {content: 'Earlier task ' + 'x'.repeat(4000)}),
      new Message(MessageType.Assistant, {content: 'Earlier result'}),
    ])
  let ordinary = 0
  let summaries = 0
  const sizes: number[] = []
  const controller = new AbortController()
  const policy: ContextPolicy = {
    estimator: (request) => ({
      components: {json: JSON.stringify(request).length},
      kind: 'estimated',
      model: 'fixture',
      provider: 'ollama',
      revision: 'json-test',
      tokens: JSON.stringify(request).length,
    }),
    mode: 'budgeted',
    profile: {
      model: 'fixture',
      outputReserve: 1000,
      provider: 'ollama',
      revision: 'recovery-test',
      safetyMargin: 100,
      summaryOutput: 800,
      target: 2500,
      templateOverhead: 0,
      trigger: 10_000,
      window: 20_000,
    },
  }
  const model: Model = {
    getModel: () => 'fixture',
    getName: () => 'fixture',
    getProvider: () => 'ollama',
    async invoke() {
      throw new Error('Expected prepared request')
    },
    prepare(messages) {
      const request = {messages: messages.map((message) => message.content)}
      return {
        async invoke() {
          if (messages[0].content.startsWith('Summarize')) {
            summaries++
            if (mode === 'summary-error') throw new Error('Summary unavailable')
            if (mode === 'cancel') controller.abort()
            const ids = JSON.parse(messages[0].content.split('ORIGINAL_SOURCE_IDS: ')[1].split('\nSOURCE:')[0])
            return new Message(MessageType.Assistant, {
              content: JSON.stringify({
                changedPaths: [],
                facts: [],
                goals: [{sourceIds: [ids[0]], text: mode === 'oversized' ? 'x'.repeat(5000) : 'Continue the task'}],
                tests: [],
                uncertainties: [],
                unfinished: [],
                version: 1,
              }),
            })
          }

          ordinary++
          sizes.push(JSON.stringify(request).length)
          if (ordinary === 1 || mode === 'twice') {
            if (mode === 'generic') throw new Error('HTTP 500')
            if (mode === 'overflow') throw new ContextOverflowError('Input overflow')
            return new Message(MessageType.Assistant, {
              content: 'Partial',
              payload: {
                response: {
                  durationMs: 1,
                  model: 'fixture',
                  provider: 'ollama',
                  stopReason: mode === 'filtered' ? 'content_filter' : 'length',
                },
                toolCalls: [{id: 'partial', input: {command: 'exit 0'}, name: 'bash'}],
              },
            })
          }

          expect(messages.some((message) => message.content === 'Partial')).to.equal(false)
          return new Message(MessageType.Assistant, {content: 'Completed after reduction'})
        },
        request,
      }
    },
  }
  const store = new MemorySessionLogStore()
  const agent = new Agent({
    contextPolicy: policy,
    cwd: os.tmpdir(),
    deps: {createModel: () => model},
    execution: {limits: {modelCalls: maxCalls}},
    logStore: store,
    settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'none'}},
    state: new State(session),
  })
  try {
    const result = await (
      await agent.startRun([new Message(MessageType.User, {content: 'Continue'})], {signal: controller.signal})
    ).finished
    return {ordinary, result, session, sizes, summaries}
  } finally {
    await agent.close()
    await store.close()
  }
}

describe('capacity-backed model regeneration', () => {
  for (const mode of ['length', 'overflow']) {
    it(`regenerates ${mode} only after committing a smaller context`, async () => {
      const f = await trial(mode)
      expect(f.result.outcome).to.equal('completed')
      expect(f.ordinary).to.equal(2)
      expect(f.summaries).to.equal(1)
      expect(f.sizes[1]).to.be.lessThan(f.sizes[0])
      expect(f.session.getCompaction()).not.to.equal(undefined)
      expect(f.session.getConversationMessages().some((m) => m.content === 'Partial')).to.equal(false)
    })
  }

  it('stops after a second truncated generation even with remaining Run budget', async () => {
    const f = await trial('twice')
    expect(f.result.outcome).to.equal('failed')
    expect(f.ordinary).to.equal(2)
    expect(f.summaries).to.equal(1)
  })
  for (const mode of ['summary-error', 'oversized']) {
    it(`does not fall back to unchanged input after ${mode}`, async () => {
      const f = await trial(mode)
      expect(f.result.outcome).to.equal('failed')
      expect(f.ordinary).to.equal(1)
      expect(f.summaries).to.equal(1)
      expect(f.session.getCompaction()).to.equal(undefined)
    })
  }

  for (const mode of ['generic', 'filtered']) {
    it(`does not retry an unclassified ${mode} failure`, async () => {
      const f = await trial(mode)
      expect(f.result.outcome).to.equal('failed')
      expect(f.ordinary).to.equal(1)
      expect(f.summaries).to.equal(0)
    })
  }

  it('does not resend an uncompactable request', async () => {
    const f = await trial('length', false)
    expect(f.result.outcome).to.equal('failed')
    expect(f.ordinary).to.equal(1)
    expect(f.summaries).to.equal(0)
  })

  it('charges the summary and regeneration to the same Run budget', async () => {
    const f = await trial('length', true, 2)
    expect(f.result.outcome).to.equal('budget-exceeded')
    expect(f.ordinary).to.equal(1)
    expect(f.summaries).to.equal(1)
  })

  it('honors cancellation during recovery and does not save the summary', async () => {
    const f = await trial('cancel')
    expect(f.result.outcome).to.equal('cancelled')
    expect(f.ordinary).to.equal(1)
    expect(f.session.getCompaction()).to.equal(undefined)
  })
})
