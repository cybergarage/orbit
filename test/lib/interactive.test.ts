// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent} from '../../src/lib/agent.js'

import {createInitialInteractiveState, submitInteractiveInput} from '../../src/lib/interactive.js'

describe('interactive helpers', () => {
  it('starts with an empty session state', () => {
    expect(createInitialInteractiveState()).to.deep.equal({
      input: '',
      isLoading: false,
      messages: [],
    })
  })

  it('appends user and assistant messages while keeping prior history', async () => {
    const agent: Agent = {
      async chat(messages) {
        return `reply:${messages.length}`
      },
    }

    const first = await submitInteractiveInput(agent, createInitialInteractiveState(), 'hello')
    const second = await submitInteractiveInput(agent, first, 'again')

    expect(first.messages).to.deep.equal([
      {content: 'hello', role: 'user'},
      {content: 'reply:1', role: 'assistant'},
    ])
    expect(second.messages).to.deep.equal([
      {content: 'hello', role: 'user'},
      {content: 'reply:1', role: 'assistant'},
      {content: 'again', role: 'user'},
      {content: 'reply:3', role: 'assistant'},
    ])
  })

  it('ignores exit commands and empty input', async () => {
    const initial = createInitialInteractiveState()
    const agent: Agent = {
      async chat() {
        throw new Error('should not be called')
      },
    }

    expect(await submitInteractiveInput(agent, initial, '   ')).to.equal(initial)
    expect(await submitInteractiveInput(agent, initial, '/exit')).to.equal(initial)
  })
})
