// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Message, Model, Processor, ProcessorOptions} from '../../src/core/models/index.js'

type Assert<T extends true> = T
type Extends<T, U> = T extends U ? true : false

describe('Processor', () => {
  it('accepts models as message processors at the type level', () => {
    type ModelIsMessageProcessor = Assert<Extends<Model, Processor<Message[], Message, ProcessorOptions>>>

    const _typeCheck: ModelIsMessageProcessor = true

    expect(_typeCheck).to.equal(true)
  })
})
