// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {copySessionId, selectedSessionSummary} from '../../../src/apps/gui/session-information.js'
import {Role, type SessionSummary, type ThreadSnapshot} from '../../../src/core/index.js'

describe('GUI session information', () => {
  it('overrides persisted runtime fields for the selected active session', () => {
    const saved: SessionSummary = {
      createdAt: '2026-08-25T00:00:00.000Z',
      cwd: '/saved',
      file: '/sessions/session-1.jsonl',
      id: 'session-1',
      model: 'saved-model',
      originator: 'orbit-thread-manager',
      preview: 'Saved title',
      provider: 'ollama',
      status: 'completed',
      updatedAt: '2026-08-25T00:01:00.000Z',
    }
    const thread: ThreadSnapshot = {
      createdAt: saved.createdAt,
      cwd: '/active',
      file: saved.file,
      id: saved.id,
      messages: [
        {
          content: 'Hello',
          contents: ['Hello'],
          id: 'message-1',
          parentid: null,
          role: Role.User,
          timestamp: saved.createdAt,
          type: 'user',
        },
      ],
      model: 'active-model',
      provider: 'openai',
      status: 'idle',
      updatedAt: '2026-08-25T00:02:00.000Z',
    }

    expect(selectedSessionSummary(thread, [saved])).to.deep.equal({
      ...saved,
      cwd: '/active',
      model: 'active-model',
      provider: 'openai',
      updatedAt: '2026-08-25T00:02:00.000Z',
    })
  })

  it('copies the exact full session ID and propagates clipboard failures', async () => {
    const session: SessionSummary = {
      createdAt: '2026-08-25T00:00:00.000Z',
      cwd: '/work',
      file: '/sessions/session.jsonl',
      id: '019d-full-session-id',
      status: 'new',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }
    const copied: string[] = []

    await copySessionId(session, {
      async writeText(value) {
        copied.push(value)
      },
    })

    expect(copied).to.deep.equal(['019d-full-session-id'])
    try {
      await copySessionId(session, {
        async writeText() {
          throw new Error('clipboard denied')
        },
      })
      expect.fail('Expected clipboard failure.')
    } catch (error) {
      expect((error as Error).message).to.equal('clipboard denied')
    }
  })
})
