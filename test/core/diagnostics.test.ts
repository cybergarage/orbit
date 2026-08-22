// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {DiagnosticCapture, DiagnosticEventBus} from '../../src/core/index.js'

describe('diagnostics', () => {
  it('keeps metadata and omits full data by default', () => {
    const bus = new DiagnosticEventBus()

    const event = bus.emit({data: {model: 'test-model'}, fullData: {request: 'secret prompt'}, type: 'model.request.started'})

    expect(event?.data).to.deep.equal({model: 'test-model'})
  })

  it('includes full data when full capture is enabled', () => {
    const bus = new DiagnosticEventBus({capture: DiagnosticCapture.Full})

    const event = bus.emit({data: {model: 'test-model'}, fullData: {request: 'full prompt'}, type: 'model.request.started'})

    expect(event?.data).to.deep.equal({model: 'test-model', request: 'full prompt'})
  })

  it('does not record or publish events when capture is off', () => {
    const bus = new DiagnosticEventBus({capture: DiagnosticCapture.Off})
    const received: string[] = []
    bus.subscribe((event) => received.push(event.type))

    expect(bus.emit({type: 'app.started'})).to.equal(undefined)
    expect(bus.list()).to.deep.equal([])
    expect(received).to.deep.equal([])
  })

  it('keeps a bounded replay buffer and supports unsubscribe', () => {
    const bus = new DiagnosticEventBus({maxEvents: 2})
    const received: number[] = []
    const unsubscribe = bus.subscribe((event) => received.push(event.sequence))

    bus.emit({type: 'first'})
    bus.emit({type: 'second'})
    unsubscribe()
    bus.emit({type: 'third'})

    expect(received).to.deep.equal([1, 2])
    expect(bus.list().map((event) => event.type)).to.deep.equal(['second', 'third'])
    expect(bus.list(2).map((event) => event.type)).to.deep.equal(['third'])
  })
})
