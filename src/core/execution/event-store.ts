// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {canonicalJSON} from './canonical-json.js'
import {admitEvents, deliverEvent, type EventDelivery, type InboxEvent, type JobReceipt} from './event-inbox.js'

export interface EventInboxState {
  deliveries: EventDelivery[]
  events: InboxEvent[]
}

export interface EventStoreState extends EventInboxState {
  data: Record<string, unknown>
  version: 1
}

export interface EventStoreOptions<S extends EventInboxState> {
  /** Validate and, when explicitly supported, migrate application state before writing. */
  decode?: (input: unknown) => S
  initialState: S
  /** Synchronous state-only recovery. Never dispatch effects from this callback. */
  recover?: (state: S) => void
}

/** Single-host durable inbox. No task runtime, broker, lease or external-effect replay. */
export class EventStore<S extends EventInboxState = EventStoreState> {
  private changing = false
  private closed = false
  private readonly defaultFormat: boolean
  private readonly lock: string
  private poisoned = false
  private released = false
  private state: S
  private readonly token = randomUUID()

  constructor(
    private readonly file: string,
    options?: EventStoreOptions<S>,
  ) {
    this.defaultFormat = options?.decode === undefined
    fs.mkdirSync(path.dirname(file), {mode: 0o700, recursive: true})
    this.lock = `${file}.lock`
    try {
      this.acquire()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      fs.mkdirSync(`${this.lock}.recovery`)
      try {
        const owner = JSON.parse(fs.readFileSync(this.lock, 'utf8')) as {pid: number}
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid owner lock; inspect manually')
        try {
          process.kill(owner.pid, 0)
          throw new Error('Event store already owned')
        } catch (error_) {
          if ((error_ as NodeJS.ErrnoException).code !== 'ESRCH') throw error_
        }

        fs.unlinkSync(this.lock)
        this.acquire()
      } finally {
        fs.rmdirSync(`${this.lock}.recovery`)
      }
    }

    try {
      const input: unknown = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : structuredClone(options?.initialState ?? {data: {}, deliveries: [], events: [], version: 1})
      if (options?.decode) this.state = options.decode(input)
      else {
        const state = input as EventStoreState
        validateDefaultState(state)
        this.state = state as unknown as S
      }

      validateInbox(this.state)
      this.transact((state) => options?.recover?.(state))
    } catch (error) {
      this.close()
      throw error
    }
  }

  /** Accept a fact and consumer delivery, optionally updating application state in the same commit. */
  accept(input: Omit<InboxEvent, 'sequence'>, consumer: string, update?: (state: S) => void): InboxEvent {
    return this.transact((state) => {
      const existing = state.events.some((event) => event.id === input.id)
      const event = deliverEvent(state.events, state.deliveries, input, consumer)
      if (!existing) assertSynchronous(update?.(state))
      return event
    })
  }

  /** Atomically admit application-owned jobs and acknowledge their deliveries. No effects in callback. */
  admit(consumer: string, admit: (event: InboxEvent, state: S) => string): JobReceipt[] {
    return this.transact((state) =>
      admitEvents(state.events, state.deliveries, consumer, (event) => {
        const jobId = admit(event, state)
        assertSynchronous(jobId)
        return jobId
      }),
    )
  }

  cancel(eventId: string, consumer: string): void {
    this.transact((state) => {
      const delivery = state.deliveries.find((value) => value.eventId === eventId && value.consumer === consumer)
      if (delivery?.status === 'pending') delivery.status = 'cancelled'
    })
  }

  close(): void {
    if (this.changing) throw new Error('Cannot close during an event transaction')
    this.closed = true
    if (this.released) return
    try {
      const owner = JSON.parse(fs.readFileSync(this.lock, 'utf8')) as {token: string}
      if (owner.token === this.token) fs.unlinkSync(this.lock)
      this.released = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.released = true
    }
  }

  snapshot(): S {
    return structuredClone(this.state)
  }

  transact<T>(update: (state: S) => T): T {
    if (this.closed || this.poisoned) throw new Error('Event store closed or persistence uncertain')
    if (this.changing) throw new Error('Nested event transaction')
    this.changing = true
    try {
      const next = structuredClone(this.state)
      const result = update(next)
      assertSynchronous(result)
      // Validate before publication; retained callback references must not mutate committed state.
      if (this.defaultFormat) validateDefaultState(next)
      validateInbox(next)
      validateTransition(this.state, next)
      const returned = structuredClone(result)
      const bytes = canonicalJSON(next)
      if (Buffer.byteLength(bytes) > 16 * 1024 * 1024)
        throw new Error('Event history limit reached; archive before continuing')
      const temp = `${this.file}.${this.token}.tmp`
      const fd = fs.openSync(temp, 'w', 0o600)
      try {
        fs.writeFileSync(fd, bytes)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }

      try {
        fs.renameSync(temp, this.file)
        if (process.platform !== 'win32') {
          const directory = fs.openSync(path.dirname(this.file), 'r')
          try {
            fs.fsyncSync(directory)
          } finally {
            fs.closeSync(directory)
          }
        }
      } catch (error) {
        this.poisoned = true
        throw error
      }

      this.state = structuredClone(next)
      return returned
    } finally {
      this.changing = false
    }
  }

  private acquire(): void {
    const fd = fs.openSync(this.lock, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify({pid: process.pid, token: this.token}))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }
}

function validateInbox(state: EventInboxState): void {
  if (!state || !Array.isArray(state.events) || !Array.isArray(state.deliveries)) throw new Error('Corrupt event inbox')
  const events = new Map<string, InboxEvent>()
  const positions = new Set<string>()
  for (const event of state.events) {
    if (
      !event ||
      ![event.id, event.key, event.source, event.type].every(
        (value) => typeof value === 'string' && value.length > 0,
      ) ||
      !Object.hasOwn(event, 'payload') ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= 0 ||
      events.has(event.id)
    )
      throw new Error('Corrupt event identity')
    const position = JSON.stringify([event.key, event.sequence])
    if (positions.has(position)) throw new Error('Corrupt event sequence')
    positions.add(position)
    events.set(event.id, event)
  }

  const deliveries = new Set<string>()
  const acknowledged = new Map<string, number>()
  for (const delivery of state.deliveries) {
    if (
      !delivery ||
      typeof delivery.consumer !== 'string' ||
      !delivery.consumer ||
      !events.has(delivery.eventId) ||
      !['acknowledged', 'cancelled', 'pending'].includes(delivery.status)
    )
      throw new Error('Corrupt event delivery')
    const identity = JSON.stringify([delivery.eventId, delivery.consumer])
    if (deliveries.has(identity)) throw new Error('Duplicate event delivery')
    deliveries.add(identity)
    if (delivery.status === 'acknowledged') {
      if (typeof delivery.jobId !== 'string' || !delivery.jobId) throw new Error('Corrupt job acknowledgement')
      const event = events.get(delivery.eventId)!
      const key = JSON.stringify([delivery.consumer, event.key])
      acknowledged.set(key, Math.max(acknowledged.get(key) ?? 0, event.sequence))
    } else if (delivery.jobId !== undefined) throw new Error('Unacknowledged delivery has job identity')
  }

  for (const delivery of state.deliveries) {
    const event = events.get(delivery.eventId)!
    if (
      delivery.status === 'pending' &&
      event.sequence <= (acknowledged.get(JSON.stringify([delivery.consumer, event.key])) ?? 0)
    )
      throw new Error('Consumer sequence already advanced')
  }
}

function validateTransition(previous: EventInboxState, next: EventInboxState): void {
  for (const delivery of next.deliveries) {
    if (
      delivery.status !== 'acknowledged' ||
      previous.deliveries.some(
        (value) =>
          value.eventId === delivery.eventId && value.consumer === delivery.consumer && value.status === 'acknowledged',
      )
    )
      continue
    const event = next.events.find((value) => value.id === delivery.eventId)!
    if (
      previous.deliveries.some(
        (value) =>
          value.consumer === delivery.consumer &&
          value.status === 'acknowledged' &&
          previous.events.some(
            (prior) => prior.id === value.eventId && prior.key === event.key && prior.sequence >= event.sequence,
          ),
      )
    )
      throw new Error('Consumer sequence already advanced')
  }

  for (const event of previous.events) {
    const retained = next.events.find((value) => value.id === event.id)
    if (!retained || canonicalJSON(retained) !== canonicalJSON(event)) throw new Error('Immutable event changed')
  }

  for (const delivery of previous.deliveries) {
    const retained = next.deliveries.find(
      (value) => value.eventId === delivery.eventId && value.consumer === delivery.consumer,
    )
    if (!retained || (delivery.status !== 'pending' && canonicalJSON(retained) !== canonicalJSON(delivery)))
      throw new Error('Terminal delivery changed or removed')
  }
}

function assertSynchronous(value: unknown): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  ) {
    // Observe a rejected callback without granting it a commit or retaining its draft.
    Promise.resolve(value).catch(() => {})
    throw new Error('Event transaction callbacks must be synchronous')
  }
}

function validateDefaultState(input: unknown): asserts input is EventStoreState {
  const state = input as EventStoreState
  if (!state || state.version !== 1 || !state.data || typeof state.data !== 'object' || Array.isArray(state.data))
    throw new Error('Unsupported or corrupt event state')
}
