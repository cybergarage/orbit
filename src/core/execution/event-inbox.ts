// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {canonicalJSON} from './canonical-json.js'

/** Immutable fact. Sequence is local to a key, not a global FIFO contract. */
export interface InboxEvent<T = unknown> {
  id: string
  key: string
  payload: T
  sequence: number
  source: string
  type: string
}

/** One consumer's durable admission state, separate from task/execution state. */
export interface EventDelivery {
  consumer: string
  eventId: string
  jobId?: string
  status: 'acknowledged' | 'cancelled' | 'pending'
}

export interface JobReceipt {
  eventId: string
  jobId: string
}

/** Single-owner transaction-draft implementation; the host owns atomic persistence. */
export function deliverEvent<T extends InboxEvent>(
  events: T[],
  deliveries: EventDelivery[],
  input: Omit<T, 'sequence'>,
  consumer: string,
): T {
  if (
    ![input.id, input.key, input.source, input.type, consumer].every(
      (value) => typeof value === 'string' && value.length > 0,
    )
  )
    throw new Error('Invalid event identity')
  canonicalJSON(input)
  let event = events.find((value) => value.id === input.id)
  if (event) {
    if (canonicalJSON(event) !== canonicalJSON({...input, sequence: event.sequence}))
      throw new Error('Conflicting event ID')
  } else {
    let sequence = 1
    for (const value of events) if (value.key === input.key) sequence = Math.max(sequence, value.sequence + 1)
    if (!Number.isSafeInteger(sequence)) throw new Error('Event sequence overflow')
    event = structuredClone({...input, sequence}) as T
    events.push(event)
  }

  if (!deliveries.some((value) => value.eventId === event.id && value.consumer === consumer)) {
    const laterAcknowledged = deliveries.some(
      (delivery) =>
        delivery.consumer === consumer &&
        delivery.status === 'acknowledged' &&
        events.some(
          (value) => value.id === delivery.eventId && value.key === event.key && value.sequence > event.sequence,
        ),
    )
    if (laterAcknowledged) throw new Error('Consumer sequence already advanced')
    deliveries.push({consumer, eventId: event.id, status: 'pending'})
  }

  return event
}

/** Callback only admits a job in the same draft. Ack and job must persist atomically. */
export function admitEvents<T extends InboxEvent>(
  events: T[],
  deliveries: EventDelivery[],
  consumer: string,
  admit: (event: T) => string,
): JobReceipt[] {
  const receipts: JobReceipt[] = []
  const pending = events.filter((event) =>
    deliveries.some((value) => value.eventId === event.id && value.consumer === consumer && value.status === 'pending'),
  )
  pending.sort((left, right) => left.key.localeCompare(right.key) || left.sequence - right.sequence)
  for (const event of pending) {
    const delivery = deliveries.find((value) => value.eventId === event.id && value.consumer === consumer)!
    const jobId = admit(event)
    if (typeof jobId !== 'string' || !jobId) throw new Error('Invalid admitted job identity')
    delivery.jobId = jobId
    delivery.status = 'acknowledged'
    receipts.push({eventId: event.id, jobId})
  }

  return receipts
}
