// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash, randomUUID} from 'node:crypto'

import {canonicalJSON} from './canonical-json.js'
import {admitEvents, deliverEvent, type EventDelivery, type InboxEvent} from './event-inbox.js'
import {EventStore} from './event-store.js'

export type WorkStatus = 'approval' | 'cancelled' | 'failed' | 'queued' | 'running' | 'succeeded' | 'unknown'
export interface WorkSchedule {
  effect: 'opaque' | 'read'
  id: string
  interval?: number
  next: number
  paused: boolean
  payload: unknown
}
export interface WorkOccurrence {
  due: number
  id: string
  runId: string
  scheduleId?: string
}
export interface WorkAttempt {
  ended?: number
  id: string
  runId: string
  started: number
  status: WorkStatus
}
export interface ScheduledRun {
  approval?: {decision?: 'allow' | 'deny'; preview: string}
  effect: 'opaque' | 'read'
  id: string
  occurrenceId: string
  payload: unknown
  requestId: string
  result?: string
  status: WorkStatus
}
export interface WorkState {
  attempts: WorkAttempt[]
  data: Record<string, unknown>
  occurrences: WorkOccurrence[]
  runs: ScheduledRun[]
  schedules: WorkSchedule[]
  version: 1
}

interface TimerEvent extends InboxEvent {
  due: number
  effect: 'opaque' | 'read'
  id: string
  occurrenceId: string
  payload: unknown
  scheduleId: string
  type: 'timer'
}

interface EventWorkState extends Omit<WorkState, 'version'> {
  deliveries: EventDelivery[]
  events: TimerEvent[]
  version: 2
}

/** Single-process owner. Persistent IDs are transport replay keys, not external exactly-once guarantees. */
export class DurableWorkStore {
  private readonly backend: EventStore<EventWorkState>

  constructor(file: string) {
    this.backend = new EventStore(file, {
      decode: (input) => {
        let state = input as EventWorkState
        if (
          !state ||
          ![1, 2].includes(state.version) ||
          !Array.isArray(state.runs) ||
          !Array.isArray(state.attempts) ||
          !Array.isArray(state.schedules) ||
          !Array.isArray(state.occurrences) ||
          !state.data ||
          typeof state.data !== 'object' ||
          Array.isArray(state.data)
        )
          throw new Error('Unsupported or corrupt work state')
        const statuses = new Set(['approval', 'cancelled', 'failed', 'queued', 'running', 'succeeded', 'unknown'])
        const unique = (values: string[]) =>
          new Set(values).size === values.length &&
          values.every((value) => typeof value === 'string' && value.length > 0)
        if (
          !unique(state.runs.map((r) => r.id)) ||
          !unique(state.runs.map((r) => r.requestId)) ||
          !unique(state.occurrences.map((o) => o.id)) ||
          !unique(state.attempts.map((a) => a.id)) ||
          !unique(state.schedules.map((schedule) => schedule.id)) ||
          state.runs.some(
            (r) =>
              !statuses.has(r.status) ||
              !['opaque', 'read'].includes(r.effect) ||
              !state.occurrences.some((o) => o.id === r.occurrenceId && o.runId === r.id),
          ) ||
          state.attempts.some((a) => !statuses.has(a.status) || !state.runs.some((r) => r.id === a.runId)) ||
          state.schedules.some(
            (schedule) =>
              !Number.isSafeInteger(schedule.next) ||
              typeof schedule.paused !== 'boolean' ||
              !['opaque', 'read'].includes(schedule.effect) ||
              (schedule.interval !== undefined &&
                (!Number.isSafeInteger(schedule.interval) || schedule.interval < 1000)),
          )
        )
          throw new Error('Corrupt work identities or state')
        // Import only after validating the legacy identities, retaining all application data.
        if (Number(state.version) === 1) {
          if (Object.hasOwn(state, 'events') || Object.hasOwn(state, 'deliveries'))
            throw new Error('Ambiguous legacy work state contains event evidence')
          state = {...state, deliveries: [], events: [], version: 2}
        }

        this.validateEvents(state)
        return state
      },
      initialState: {
        attempts: [],
        data: {},
        deliveries: [],
        events: [],
        occurrences: [],
        runs: [],
        schedules: [],
        version: 2,
      },
      recover(state) {
        for (const run of state.runs)
          if (run.status === 'running') {
            run.status = run.effect === 'read' ? 'queued' : 'unknown'
            for (const attempt of state.attempts)
              if (attempt.runId === run.id && attempt.status === 'running') {
                attempt.status = 'unknown'
                attempt.ended = Date.now()
              }
          }
      },
    })
  }

  approve(id: string, allow: boolean): void {
    this.change((state) => {
      const run = state.runs.find((r) => r.id === id)
      if (!run || run.status !== 'approval' || !run.approval) throw new Error('No pending approval')
      run.approval.decision = allow ? 'allow' : 'deny'
      run.status = allow ? 'queued' : 'cancelled'
    })
  }

  cancel(id: string): void {
    this.change((state) => {
      const run = state.runs.find((r) => r.id === id)
      for (const event of state.events) if (event.occurrenceId === id) this.cancelDelivery(state, event.id)
      if (!run || ['cancelled', 'failed', 'succeeded', 'unknown'].includes(run.status)) return
      run.status = run.status === 'running' && run.effect === 'opaque' ? 'unknown' : 'cancelled'
      for (const attempt of state.attempts)
        if (attempt.runId === id && attempt.status === 'running') {
          attempt.status = run.status
          attempt.ended = Date.now()
        }
    })
  }

  claim(id: string): WorkAttempt {
    return this.change((state) => {
      const run = state.runs.find((r) => r.id === id)
      if (!run || run.status !== 'queued') throw new Error('Run not queued')
      run.status = 'running'
      const attempt: WorkAttempt = {id: randomUUID(), runId: id, started: Date.now(), status: 'running'}
      state.attempts.push(attempt)
      return attempt
    })
  }

  close(): void {
    this.backend.close()
  }

  enqueue(id: string, payload: unknown, effect: 'opaque' | 'read' = 'read', approval?: string): string {
    if (!id || id.length > 200 || !['opaque', 'read'].includes(effect)) throw new Error('Invalid request')
    return this.change((state) => {
      if (state.events.some((event) => event.occurrenceId === id)) throw new Error('Conflicting request ID')
      const existing = state.runs.find((r) => r.occurrenceId === id)
      if (existing) {
        if (
          state.occurrences.find((o) => o.id === id)?.scheduleId !== undefined ||
          canonicalJSON(existing.payload) !== canonicalJSON(payload) ||
          existing.effect !== effect ||
          existing.approval?.preview !== approval
        )
          throw new Error('Conflicting request ID')
        return existing.id
      }

      const run = this.insert(state, id, payload, effect, Date.now())
      if (approval !== undefined) {
        run.status = 'approval'
        run.approval = {preview: approval}
      }

      return run.id
    })
  }

  finish(
    id: string,
    attemptId: string,
    status: 'failed' | 'succeeded' | 'unknown',
    result: string,
    data?: {key: string; value: unknown},
  ): void {
    this.change((state) => {
      const run = state.runs.find((r) => r.id === id)
      const attempt = state.attempts.find((a) => a.id === attemptId && a.runId === id)
      if (!run || run.status !== 'running' || !attempt || attempt.status !== 'running') throw new Error('Stale attempt')
      if (!['failed', 'succeeded', 'unknown'].includes(status)) throw new Error('Invalid outcome')
      if (result.length > 100_000) throw new Error('Result limit exceeded')
      run.status = status
      run.result = result
      attempt.status = status
      attempt.ended = Date.now()
      if (data) {
        if (status !== 'succeeded' || run.approval?.decision !== 'allow')
          throw new Error('Approved successful run required for data mutation')
        state.data[data.key] = data.value
      }
    })
  }

  materialize(now: number): string[] {
    if (!Number.isSafeInteger(now)) throw new Error('Invalid clock')
    this.captureTimers(now)
    return this.change((state) =>
      admitEvents(
        state.events,
        state.deliveries,
        'scheduled-work',
        (event) => this.insert(state, event.occurrenceId, event.payload, event.effect, event.due, event.scheduleId).id,
      ).map((receipt) => receipt.jobId),
    )
  }

  pause(id: string, paused: boolean, now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock')
    this.change((state) => {
      const schedule = state.schedules.find((s) => s.id === id)
      if (!schedule) throw new Error('Unknown schedule')
      if (!paused && !schedule.interval) {
        if (
          state.occurrences.some((occurrence) => occurrence.scheduleId === id) ||
          state.events.some((event) => event.scheduleId === id)
        )
          throw new Error('This one-time occurrence was already created. Create a new task for another occurrence.')
        if (schedule.next <= now)
          throw new Error('This one-time schedule has expired. Create a new task with a future time.')
      }

      if (!paused && schedule.paused && schedule.interval && schedule.next <= now) {
        const next = schedule.next + (Math.floor((now - schedule.next) / schedule.interval) + 1) * schedule.interval
        if (!Number.isSafeInteger(next)) throw new Error('Schedule timestamp overflow')
        schedule.next = next
      }

      schedule.paused = paused
      if (paused) this.cancelQueued(state, id)
    })
  }

  reconcile(id: string, result: string, confirmedStopped: true): void {
    if (confirmedStopped !== true) throw new Error('Confirm external quiescence first')
    this.change((state) => {
      const run = state.runs.find((r) => r.id === id)
      if (!run || run.status !== 'unknown') throw new Error('Run not uncertain')
      run.status = 'failed'
      run.result = result
    })
  }

  removeSchedule(id: string): void {
    this.change((state) => {
      const index = state.schedules.findIndex((schedule) => schedule.id === id)
      if (index === -1) return
      state.schedules.splice(index, 1)
      this.cancelQueued(state, id)
    })
  }

  schedule(input: Omit<WorkSchedule, 'id' | 'paused'>): string {
    if (
      !Number.isSafeInteger(input.next) ||
      input.next < 0 ||
      (input.interval !== undefined && (!Number.isSafeInteger(input.interval) || input.interval < 1000))
    )
      throw new Error('Invalid timestamp or interval')
    if (!['opaque', 'read'].includes(input.effect)) throw new Error('Invalid effect')
    return this.change((state) => {
      const id = randomUUID()
      state.schedules.push({...input, id, paused: false})
      return id
    })
  }

  setData(key: string, value: unknown): void {
    this.change((state) => {
      state.data[key] = value
    })
  }

  snapshot(): WorkState {
    const {attempts, data, occurrences, runs, schedules} = this.backend.snapshot()
    return {attempts, data, occurrences, runs, schedules, version: 1}
  }

  private cancelDelivery(state: EventWorkState, eventId: string): void {
    for (const delivery of state.deliveries)
      if (delivery.eventId === eventId && delivery.status === 'pending') delivery.status = 'cancelled'
  }

  private cancelQueued(state: EventWorkState, scheduleId: string): void {
    for (const event of state.events) if (event.scheduleId === scheduleId) this.cancelDelivery(state, event.id)
    const ids = new Set(
      state.occurrences.filter((value) => value.scheduleId === scheduleId).map((value) => value.runId),
    )
    for (const run of state.runs)
      if (ids.has(run.id) && (run.status === 'queued' || run.status === 'approval')) run.status = 'cancelled'
  }

  private captureTimers(now: number): void {
    this.change((state) => {
      for (const schedule of state.schedules)
        if (!schedule.paused && schedule.next <= now) {
          const due = schedule.interval
            ? schedule.next + Math.floor((now - schedule.next) / schedule.interval) * schedule.interval
            : schedule.next
          const next = schedule.interval ? due + schedule.interval : due
          if (!Number.isSafeInteger(due) || !Number.isSafeInteger(next)) throw new Error('Schedule timestamp overflow')
          const id = JSON.stringify(['timer', schedule.id, due])
          const occurrenceId = `${schedule.id}:${due}`
          // Check legacy/public collisions before committing the cursor.
          this.matchOccurrence(state, occurrenceId, schedule.payload, schedule.effect, due, schedule.id)
          deliverEvent(
            state.events,
            state.deliveries,
            {
              due,
              effect: schedule.effect,
              id,
              key: schedule.id,
              occurrenceId,
              payload: schedule.payload,
              scheduleId: schedule.id,
              source: 'schedule',
              type: 'timer',
            },
            'scheduled-work',
          )

          if (schedule.interval) schedule.next = next
          else schedule.paused = true
        }
    })
  }

  private change<T>(update: (state: EventWorkState) => T): T {
    return this.backend.transact(update)
  }

  private insert(
    state: EventWorkState,
    id: string,
    payload: unknown,
    effect: 'opaque' | 'read',
    due: number,
    scheduleId?: string,
  ): ScheduledRun {
    const existing = this.matchOccurrence(state, id, payload, effect, due, scheduleId)
    if (existing) return existing
    const run: ScheduledRun = {effect, id, occurrenceId: id, payload, requestId: stableRequestId(id), status: 'queued'}
    state.occurrences.push({due, id, runId: id, ...(scheduleId ? {scheduleId} : {})})
    state.runs.push(run)
    return run
  }

  private matchOccurrence(
    state: EventWorkState,
    id: string,
    payload: unknown,
    effect: 'opaque' | 'read',
    due: number,
    scheduleId?: string,
  ): ScheduledRun | undefined {
    const existing = state.runs.find((run) => run.id === id || run.occurrenceId === id)
    if (!existing) return undefined
    const occurrence = state.occurrences.find((value) => value.id === id)
    if (
      !occurrence ||
      occurrence.runId !== existing.id ||
      occurrence.scheduleId !== scheduleId ||
      (scheduleId !== undefined && occurrence.due !== due) ||
      existing.effect !== effect ||
      canonicalJSON(existing.payload) !== canonicalJSON(payload) ||
      existing.approval !== undefined
    )
      throw new Error('Conflicting occurrence ID')
    return existing
  }

  private validateEvents(state: EventWorkState): void {
    if (!Array.isArray(state.events) || !Array.isArray(state.deliveries)) throw new Error('Corrupt timer inbox')
    if (state.deliveries.some((delivery) => !delivery || !state.events.some((event) => event?.id === delivery.eventId)))
      throw new Error('Orphaned event delivery')
    const seen = new Set<string>()
    const positions = new Set<string>()
    for (const event of state.events) {
      if (
        !event ||
        event.type !== 'timer' ||
        event.source !== 'schedule' ||
        event.key !== event.scheduleId ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence <= 0 ||
        typeof event.scheduleId !== 'string' ||
        !event.scheduleId ||
        !Number.isSafeInteger(event.due) ||
        event.due < 0 ||
        !['opaque', 'read'].includes(event.effect) ||
        event.id !== JSON.stringify(['timer', event.scheduleId, event.due]) ||
        seen.has(event.id) ||
        event.occurrenceId !== `${event.scheduleId}:${event.due}`
      )
        throw new Error('Corrupt timer inbox')
      const position = JSON.stringify([event.key, event.sequence])
      if (positions.has(position)) throw new Error('Corrupt event sequence')
      positions.add(position)
      seen.add(event.id)
      const run = this.matchOccurrence(
        state,
        event.occurrenceId,
        event.payload,
        event.effect,
        event.due,
        event.scheduleId,
      )
      const deliveries = state.deliveries.filter((delivery) => delivery.eventId === event.id)
      if (
        deliveries.length !== 1 ||
        deliveries[0].consumer !== 'scheduled-work' ||
        !['acknowledged', 'cancelled', 'pending'].includes(deliveries[0].status)
      )
        throw new Error('Corrupt event delivery')
      const delivery = deliveries[0]
      if (delivery.status === 'acknowledged' && (!run || delivery.jobId !== run.id))
        throw new Error('Corrupt timer acknowledgement')
      if (delivery.status !== 'acknowledged' && delivery.jobId !== undefined)
        throw new Error('Unacknowledged delivery has job identity')
      if (delivery.status === 'pending') {
        const schedule = state.schedules.find((value) => value.id === event.scheduleId)
        if (!schedule) throw new Error('Orphaned pending timer')
        if (schedule.effect !== event.effect || canonicalJSON(schedule.payload) !== canonicalJSON(event.payload))
          throw new Error('Conflicting pending timer source')
      }
    }
  }
}

function stableRequestId(occurrenceId: string): string {
  const hex = createHash('sha256').update(occurrenceId).digest('hex').slice(0, 32)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
