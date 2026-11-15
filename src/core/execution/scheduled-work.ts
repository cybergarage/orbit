// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash, randomUUID} from 'node:crypto'

import {canonicalJSON} from './canonical-json.js'
import {admitEvents, deliverEvent, type EventDelivery, type InboxEvent} from './event-inbox.js'
import {EventStore} from './event-store.js'
import {
  type JobPriority,
  type JobSchedulingState,
  resolveJobPriority,
  selectReadyJob,
  validateJobSchedulingState,
} from './job-priority.js'

export type WorkStatus = 'approval' | 'cancelled' | 'failed' | 'queued' | 'running' | 'succeeded' | 'unknown'
export interface WorkSchedule {
  effect: 'opaque' | 'read'
  id: string
  interval?: number
  next: number
  paused: boolean
  payload: unknown
  priority?: JobPriority
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
  priority?: JobPriority
  requestId: string
  result?: string
  status: WorkStatus
}
export interface WorkEnqueueOptions {
  priority?: JobPriority
}
export interface WorkClaim {
  attempt: WorkAttempt
  run: ScheduledRun
}
interface WorkInsertion extends Pick<ScheduledRun, 'effect' | 'id' | 'payload' | 'priority'> {
  due: number
  scheduleId?: string
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
  priority?: JobPriority
  scheduleId: string
  type: 'timer'
}

interface EventWorkState extends Omit<WorkState, 'version'> {
  deliveries: EventDelivery[]
  events: TimerEvent[]
  jobScheduling?: JobSchedulingState
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
        for (const run of state.runs) resolveJobPriority(run.priority)
        for (const schedule of state.schedules) resolveJobPriority(schedule.priority)
        if (state.jobScheduling !== undefined) {
          validateJobSchedulingState(state.jobScheduling)
          if (state.jobScheduling.waiting.some((entry) => !state.runs.some((run) => run.id === entry.id)))
            throw new Error('Corrupt scheduling job identity')
        }

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
    return this.change((state) => this.insertAttempt(state, id))
  }

  claimNext(): undefined | WorkClaim {
    return this.change((state) => {
      // Preserve the single-owner execution boundary and conservative unknown-effect stop.
      if (state.runs.some((run) => run.status === 'running' || run.status === 'unknown')) return
      const jobs = state.runs.flatMap((run, index) => {
        if (!['approval', 'queued'].includes(run.status)) return []
        const occurrence = state.occurrences.find((value) => value.id === run.occurrenceId)!
        const key = occurrence.scheduleId === undefined ? ['request', run.id] : ['schedule', occurrence.scheduleId]
        return [
          {
            id: run.id,
            key: JSON.stringify(key),
            priority: run.priority,
            ready: run.status === 'queued',
            sequence: index + 1,
          },
        ]
      })
      const scheduling = state.jobScheduling ?? {waiting: []}
      const id = selectReadyJob(jobs, scheduling)
      if (!id) return
      state.jobScheduling = scheduling
      const attempt = this.insertAttempt(state, id)
      return {attempt, run: state.runs.find((run) => run.id === id)!}
    })
  }

  close(): void {
    this.backend.close()
  }

  enqueue(
    id: string,
    payload: unknown,
    effect: 'opaque' | 'read' = 'read',
    approval?: string,
    options?: WorkEnqueueOptions,
  ): string {
    if (!id || id.length > 200 || !['opaque', 'read'].includes(effect)) throw new Error('Invalid request')
    if (
      options !== undefined &&
      (!options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== 'priority'))
    )
      throw new Error('Invalid enqueue options')
    const priority = resolveJobPriority(options?.priority)
    return this.change((state) => {
      if (state.events.some((event) => event.occurrenceId === id)) throw new Error('Conflicting request ID')
      const existing = state.runs.find((r) => r.occurrenceId === id)
      if (existing) {
        if (
          state.occurrences.find((o) => o.id === id)?.scheduleId !== undefined ||
          canonicalJSON(existing.payload) !== canonicalJSON(payload) ||
          existing.effect !== effect ||
          resolveJobPriority(existing.priority) !== priority ||
          existing.approval?.preview !== approval
        )
          throw new Error('Conflicting request ID')
        return existing.id
      }

      const run = this.insert(state, {
        due: Date.now(),
        effect,
        id,
        payload,
        ...(options?.priority === undefined ? {} : {priority}),
      })
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
        (event) => this.insert(state, this.timerWork(event)).id,
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
    resolveJobPriority(input.priority)
    if (!['opaque', 'read'].includes(input.effect)) throw new Error('Invalid effect')
    return this.change((state) => {
      const id = randomUUID()
      const {priority, ...schedule} = input
      state.schedules.push({...schedule, id, paused: false, ...(priority === undefined ? {} : {priority})})
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

  private captureTimer(state: EventWorkState, schedule: WorkSchedule, now: number): void {
    const due = schedule.interval
      ? schedule.next + Math.floor((now - schedule.next) / schedule.interval) * schedule.interval
      : schedule.next
    const next = schedule.interval ? due + schedule.interval : due
    if (!Number.isSafeInteger(due) || !Number.isSafeInteger(next)) throw new Error('Schedule timestamp overflow')
    const event: Omit<TimerEvent, 'sequence'> = {
      due,
      effect: schedule.effect,
      id: JSON.stringify(['timer', schedule.id, due]),
      key: schedule.id,
      occurrenceId: `${schedule.id}:${due}`,
      payload: schedule.payload,
      scheduleId: schedule.id,
      source: 'schedule',
      type: 'timer',
      ...(schedule.priority === undefined ? {} : {priority: schedule.priority}),
    }
    this.matchOccurrence(state, this.timerWork(event))
    deliverEvent(state.events, state.deliveries, event, 'scheduled-work')
    if (schedule.interval) schedule.next = next
    else schedule.paused = true
  }

  private captureTimers(now: number): void {
    this.change((state) => {
      for (const schedule of state.schedules)
        if (!schedule.paused && schedule.next <= now) this.captureTimer(state, schedule, now)
    })
  }

  private change<T>(update: (state: EventWorkState) => T): T {
    return this.backend.transact(update)
  }

  private insert(state: EventWorkState, input: WorkInsertion): ScheduledRun {
    const existing = this.matchOccurrence(state, input)
    if (existing) return existing
    const {due, effect, id, payload, priority, scheduleId} = input
    const run: ScheduledRun = {
      effect,
      id,
      occurrenceId: id,
      payload,
      requestId: stableRequestId(id),
      status: 'queued',
      ...(priority === undefined ? {} : {priority}),
    }
    state.occurrences.push({due, id, runId: id, ...(scheduleId ? {scheduleId} : {})})
    state.runs.push(run)
    return run
  }

  private insertAttempt(state: EventWorkState, id: string): WorkAttempt {
    const run = state.runs.find((value) => value.id === id)
    if (!run || run.status !== 'queued') throw new Error('Run not queued')
    run.status = 'running'
    const attempt: WorkAttempt = {id: randomUUID(), runId: id, started: Date.now(), status: 'running'}
    state.attempts.push(attempt)
    return attempt
  }

  private matchOccurrence(state: EventWorkState, input: WorkInsertion): ScheduledRun | undefined {
    const {due, effect, id, payload, priority, scheduleId} = input
    const existing = state.runs.find((run) => run.id === id || run.occurrenceId === id)
    if (!existing) return undefined
    const occurrence = state.occurrences.find((value) => value.id === id)
    if (
      occurrence?.runId !== existing.id ||
      occurrence.scheduleId !== scheduleId ||
      (scheduleId !== undefined && occurrence.due !== due) ||
      existing.effect !== effect ||
      resolveJobPriority(existing.priority) !== resolveJobPriority(priority) ||
      canonicalJSON(existing.payload) !== canonicalJSON(payload) ||
      existing.approval !== undefined
    )
      throw new Error('Conflicting occurrence ID')
    return existing
  }

  private timerWork(event: Omit<TimerEvent, 'sequence'>): WorkInsertion {
    return {
      due: event.due,
      effect: event.effect,
      id: event.occurrenceId,
      payload: event.payload,
      scheduleId: event.scheduleId,
      ...(event.priority === undefined ? {} : {priority: event.priority}),
    }
  }

  private validateEvents(state: EventWorkState): void {
    if (!Array.isArray(state.events) || !Array.isArray(state.deliveries)) throw new Error('Corrupt timer inbox')
    if (state.deliveries.some((delivery) => !delivery || !state.events.some((event) => event?.id === delivery.eventId)))
      throw new Error('Orphaned event delivery')
    const seen = new Set<string>()
    const positions = new Set<string>()
    for (const event of state.events) {
      this.validateTimerIdentity(event)
      const position = JSON.stringify([event.key, event.sequence])
      if (seen.has(event.id) || positions.has(position)) throw new Error('Corrupt event sequence')
      positions.add(position)
      seen.add(event.id)
      resolveJobPriority(event.priority)
      const run = this.matchOccurrence(state, this.timerWork(event))
      this.validateTimerDelivery(state, event, run)
    }
  }

  private validateTimerDelivery(state: EventWorkState, event: TimerEvent, run?: ScheduledRun): void {
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
      if (
        schedule.effect !== event.effect ||
        resolveJobPriority(schedule.priority) !== resolveJobPriority(event.priority) ||
        canonicalJSON(schedule.payload) !== canonicalJSON(event.payload)
      )
        throw new Error('Conflicting pending timer source')
    }
  }

  private validateTimerIdentity(event: TimerEvent): void {
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
      event.occurrenceId !== `${event.scheduleId}:${event.due}`
    )
      throw new Error('Corrupt timer inbox')
  }
}

function stableRequestId(occurrenceId: string): string {
  const hex = createHash('sha256').update(occurrenceId).digest('hex').slice(0, 32)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
