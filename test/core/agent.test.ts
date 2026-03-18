// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {splitSystemPrompt} from '../../src/core/models/index.js'

describe('splitSystemPrompt', () => {
  it('collects system messages and leaves visible history intact', () => {
    const result = splitSystemPrompt([
      {content: 'Japanese only', role: 'system'},
      {content: 'Workspace context', role: 'system'},
      {content: 'Hello', role: 'user'},
      {content: 'Hi there', role: 'assistant'},
    ])

    expect(result.systemPrompt).to.equal('Japanese only\n\nWorkspace context')
    expect(result.messages).to.deep.equal([
      {content: 'Hello', role: 'user'},
      {content: 'Hi there', role: 'assistant'},
    ])
  })
})
