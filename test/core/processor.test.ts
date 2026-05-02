// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent, Message, Model, Processor, ProcessorOptions} from '../../src/core/models/index.js'

import {ProcessorType} from '../../src/core/models/index.js'

type Assert<T extends true> = T
type Extends<T, U> = T extends U ? true : false

describe('Processor', () => {
  it('defines processor type names', () => {
    expect(ProcessorType).to.deep.equal({
      Agent: 'agent',
      Model: 'model',
    })
  })

  it('accepts models as message processors at the type level', () => {
    type ModelIsMessageProcessor = Assert<Extends<Model, Processor<Message[], Message, ProcessorOptions>>>

    const _typeCheck: ModelIsMessageProcessor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts agents as message processors at the type level', () => {
    type AgentIsMessageProcessor = Assert<Extends<Agent, Processor<Message[], Message, ProcessorOptions>>>

    const _typeCheck: AgentIsMessageProcessor = true

    expect(_typeCheck).to.equal(true)
  })
})
