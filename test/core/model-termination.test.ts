// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import os from 'node:os'

import type {Model} from '../../src/core/index.js'

import {
  Agent,
  IncompleteModelResponseError,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  State,
} from '../../src/core/index.js'
import {assertCompleteModelResponse} from '../../src/core/models/termination.js'

function response(stopReason?: string, calls = false) {
  return new Message(MessageType.Assistant, {
    content: 'Partial output',
    payload: {
      response: {durationMs: 1, model: 'fixture', provider: 'fixture', ...(stopReason ? {stopReason} : {})},
      ...(calls ? {toolCalls: [{id: 'partial', input: {command: 'exit 0'}, name: 'bash'}]} : {}),
    },
  })
}

describe('model termination gate', () => {
  for (const stopReason of [
    'length',
    'max_tokens',
    'model_context_window_exceeded',
    'content_filter',
    'refusal',
    'pause_turn',
  ]) {
    for (const calls of [false, true]) {
      it(`rejects ${stopReason} before history append or tool dispatch (calls=${calls})`, async () => {
        const session = new Session()
        const store = new MemorySessionLogStore()
        const model: Model = {
          getModel: () => 'fixture',
          getName: () => 'fixture',
          getProvider: () => 'fixture',
          async invoke() {
            return response(stopReason, calls)
          },
        }
        const agent = new Agent({
          cwd: os.tmpdir(),
          deps: {createModel: () => model},
          logStore: store,
          settings: {model: 'fixture', provider: 'ollama', tools: {profile: 'none'}},
          state: new State(session),
        })
        try {
          const result = await (
            await agent.startRun([new Message(MessageType.User, {content: 'Complete the task'})])
          ).finished
          expect(result.outcome).to.equal('failed')
          expect(session.getConversationMessages()).to.have.length(1)
          expect(JSON.stringify(session.getEntries())).to.contain('MODEL_INCOMPLETE')
          expect(
            session.getEntries().some((entry) => entry.type === 'message' && entry.message.type === 'tool'),
          ).to.equal(false)
        } finally {
          await agent.close()
          await store.close()
        }
      })
    }
  }

  it('exports the typed failure and preserves successful/custom responses', () => {
    expect(() => assertCompleteModelResponse(response('length'))).to.throw(IncompleteModelResponseError)
    for (const reason of [undefined, 'stop', 'end_turn', 'tool_calls'])
      expect(() => assertCompleteModelResponse(response(reason))).not.to.throw()
  })
})
