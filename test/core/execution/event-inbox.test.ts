// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {admitEvents, deliverEvent, type EventDelivery, type InboxEvent} from '../../../src/index.js'

describe('Single-owner event admission', () => {
  it('separates facts, consumer delivery and jobs with key-local ordering', () => {
    const events: InboxEvent[] = []
    const deliveries: EventDelivery[] = []
    const input = {id: 'first', key: 'task', payload: {value: 1}, source: 'test', type: 'synthetic'}
    deliverEvent(events, deliveries, input, 'one')
    deliverEvent(events, deliveries, input, 'one')
    deliverEvent(events, deliveries, input, 'two')
    deliverEvent(events, deliveries, {...input, id: 'second'}, 'one')
    deliverEvent(events, deliveries, {...input, id: 'other', key: 'another'}, 'one')
    expect(events.map((event) => event.sequence)).deep.equal([1, 2, 1])
    expect(deliveries).length(4)
    const admitted: string[] = []
    // Physical array order is not the key-local delivery order.
    events.reverse()
    const receipts = admitEvents(events, deliveries, 'one', (event) => {
      admitted.push(event.id)
      return `job:${event.id}`
    })
    expect(admitted.indexOf('first')).lessThan(admitted.indexOf('second'))
    expect(receipts).length(3)
    expect(
      admitEvents(events, deliveries, 'one', () => {
        throw new Error('duplicate')
      }),
    ).deep.equal([])
    expect(deliveries.find((delivery) => delivery.consumer === 'two')?.status).equal('pending')
    for (const change of [{payload: {value: 2}}, {key: 'other'}, {source: 'other'}, {type: 'other'}])
      expect(() => deliverEvent(events, deliveries, {...input, ...change}, 'one')).to.throw('Conflicting')
  })

  it('captures immutable input and rejects nonserializable facts before changing a draft', () => {
    const events: InboxEvent[] = []
    const deliveries: EventDelivery[] = []
    const payload = {value: 1}
    deliverEvent(events, deliveries, {id: 'fact', key: 'key', payload, source: 'test', type: 'synthetic'}, 'worker')
    payload.value = 2
    expect(events[0].payload).deep.equal({value: 1})
    expect(() =>
      deliverEvent(
        events,
        deliveries,
        {id: 'bad', key: 'key', payload: undefined, source: 'test', type: 'synthetic'},
        'worker',
      ),
    ).to.throw('canonical JSON')
    expect(events).length(1)
    expect(deliveries).length(1)
  })

  it('keeps cancelled delivery terminal on redelivery', () => {
    const events: InboxEvent[] = []
    const deliveries: EventDelivery[] = []
    const input = {id: 'cancelled', key: 'task', payload: null, source: 'test', type: 'synthetic'}
    deliverEvent(events, deliveries, input, 'worker')
    deliveries[0].status = 'cancelled'
    deliverEvent(events, deliveries, input, 'worker')
    expect(admitEvents(events, deliveries, 'worker', () => 'unexpected')).deep.equal([])
  })
})
