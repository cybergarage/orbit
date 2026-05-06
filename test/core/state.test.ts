// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {Session, State} from '../../src/core/index.js'

describe('State', () => {
  it('creates a new Session when none is provided', () => {
    const state = new State()

    expect(state.getSession()).to.be.instanceOf(Session)
  })

  it('uses the provided Session', () => {
    const session = new Session()
    const state = new State(session)

    expect(state.getSession()).to.equal(session)
  })

  it('two States created without arguments hold different sessions', () => {
    const first = new State()
    const second = new State()

    expect(first.getSession()).to.not.equal(second.getSession())
  })
})
