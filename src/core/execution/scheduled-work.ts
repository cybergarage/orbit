// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {canonicalJSON} from './journal.js'

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

/** Single-process owner. Persistent IDs are transport replay keys, not external exactly-once guarantees. */
export class DurableWorkStore {
  private closed = false
  private readonly lock: string
  private poisoned = false
  private state: WorkState
  private readonly token = randomUUID()

  constructor(private readonly file: string) {
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
          throw new Error('Work store already owned')
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
      this.state = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, 'utf8')) as WorkState)
        : {attempts: [], data: {}, occurrences: [], runs: [], schedules: [], version: 1}
      if (
        this.state.version !== 1 ||
        !Array.isArray(this.state.runs) ||
        !Array.isArray(this.state.attempts) ||
        !Array.isArray(this.state.schedules) ||
        !Array.isArray(this.state.occurrences) ||
        !this.state.data
      )
        throw new Error('Unsupported or corrupt work state')
      const statuses = new Set(['approval', 'cancelled', 'failed', 'queued', 'running', 'succeeded', 'unknown'])
      const unique = (values: string[]) =>
        new Set(values).size === values.length && values.every((value) => typeof value === 'string' && value.length > 0)
      if (
        !unique(this.state.runs.map((r) => r.id)) ||
        !unique(this.state.runs.map((r) => r.requestId)) ||
        !unique(this.state.occurrences.map((o) => o.id)) ||
        !unique(this.state.attempts.map((a) => a.id)) ||
        !unique(this.state.schedules.map((schedule) => schedule.id)) ||
        this.state.runs.some(
          (r) =>
            !statuses.has(r.status) ||
            !['opaque', 'read'].includes(r.effect) ||
            !this.state.occurrences.some((o) => o.id === r.occurrenceId && o.runId === r.id),
        ) ||
        this.state.attempts.some((a) => !statuses.has(a.status) || !this.state.runs.some((r) => r.id === a.runId)) ||
        this.state.schedules.some(
          (schedule) =>
            !Number.isSafeInteger(schedule.next) ||
            typeof schedule.paused !== 'boolean' ||
            !['opaque', 'read'].includes(schedule.effect) ||
            (schedule.interval !== undefined && (!Number.isSafeInteger(schedule.interval) || schedule.interval < 1000)),
        )
      )
        throw new Error('Corrupt work identities or state')
      this.change((state) => {
        for (const run of state.runs)
          if (run.status === 'running') {
            run.status = run.effect === 'read' ? 'queued' : 'unknown'
            for (const attempt of state.attempts)
              if (attempt.runId === run.id && attempt.status === 'running') {
                attempt.status = 'unknown'
                attempt.ended = Date.now()
              }
          }
      })
    } catch (error) {
      this.close()
      throw error
    }
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
    if (this.closed) return
    this.closed = true
    const owner = JSON.parse(fs.readFileSync(this.lock, 'utf8')) as {token: string}
    if (owner.token === this.token) fs.unlinkSync(this.lock)
  }

  enqueue(id: string, payload: unknown, effect: 'opaque' | 'read' = 'read', approval?: string): string {
    if (!id || id.length > 200 || !['opaque', 'read'].includes(effect)) throw new Error('Invalid request')
    return this.change((state) => {
      const existing = state.runs.find((r) => r.occurrenceId === id)
      if (existing) {
        if (
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
    return this.change((state) => {
      const ids: string[] = []
      for (const schedule of state.schedules)
        if (!schedule.paused && schedule.next <= now) {
          const due = schedule.interval
            ? schedule.next + Math.floor((now - schedule.next) / schedule.interval) * schedule.interval
            : schedule.next
          const id = `${schedule.id}:${due}`
          this.insert(state, id, schedule.payload, schedule.effect, due, schedule.id)
          ids.push(id)
          if (schedule.interval) schedule.next = due + schedule.interval
          else schedule.paused = true
        }

      return ids
    })
  }

  pause(id: string, paused: boolean): void {
    this.change((state) => {
      const schedule = state.schedules.find((s) => s.id === id)
      if (!schedule) throw new Error('Unknown schedule')
      schedule.paused = paused
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
    return structuredClone(this.state)
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

  private change<T>(update: (state: WorkState) => T): T {
    if (this.closed || this.poisoned) throw new Error('Work store closed or persistence uncertain')
    const next = structuredClone(this.state)
    const result = update(next)
    const bytes = canonicalJSON(next)
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024)
      throw new Error('Work history limit reached; archive before continuing')
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

    this.state = next
    return structuredClone(result)
  }

  private insert(
    state: WorkState,
    id: string,
    payload: unknown,
    effect: 'opaque' | 'read',
    due: number,
    scheduleId?: string,
  ): ScheduledRun {
    const existing = state.runs.find((r) => r.id === id)
    if (existing) return existing
    const run: ScheduledRun = {effect, id, occurrenceId: id, payload, requestId: stableRequestId(id), status: 'queued'}
    state.occurrences.push({due, id, runId: id, ...(scheduleId ? {scheduleId} : {})})
    state.runs.push(run)
    return run
  }
}

function stableRequestId(occurrenceId: string): string {
  const hex = createHash('sha256').update(occurrenceId).digest('hex').slice(0, 32)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
