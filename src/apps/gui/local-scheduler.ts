// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import {ExecutionRequestError} from '../../core/execution/run.js'
import {DurableWorkStore, type ScheduledRun} from '../../core/execution/scheduled-work.js'

export const taskSchema = z
  .object({
    instructions: z.string().trim().min(1).max(16_000),
    name: z.string().trim().min(1).max(120),
    permissions: z.literal('workspace-read'),
    version: z.literal(1),
    workspace: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => path.isAbsolute(value), 'Select an absolute workspace directory'),
  })
  .strict()
export const scheduleSchema = z
  .object({
    interval: z.number().int().min(1000).max(2_147_483_647).optional(),
    next: z.number().int().nonnegative().max(8_000_000_000_000_000),
    operationId: z.string().uuid(),
    task: taskSchema,
  })
  .strict()
const savedTaskSchema = taskSchema
  .extend({creation: z.object({input: z.string().max(150_000), operationId: z.string().uuid()}).strict()})
  .strict()
export type LocalTask = z.infer<typeof taskSchema>
export interface LocalTaskResult {
  result: string
  status: 'failed' | 'succeeded' | 'unknown'
}
export type TaskExecutor = (task: LocalTask, requestId: string, signal: AbortSignal) => Promise<LocalTaskResult>

/** A single bounded local owner; the store remains the durable transition authority. */
export class LocalScheduler {
  private active?: {controller: AbortController; done: Promise<void>; id: string}
  private closed = false
  private failure?: string
  private ticking?: Promise<void>
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly store: DurableWorkStore,
    private readonly execute: TaskExecutor,
  ) {
    try {
      const state = store.snapshot()
      for (const schedule of state.schedules) {
        const payload = savedTaskSchema.parse(schedule.payload)
        const {creation, ...task} = payload
        scheduleSchema.parse({
          next: schedule.next,
          task,
          ...(schedule.interval === undefined ? {} : {interval: schedule.interval}),
          operationId: creation.operationId,
        })
        if (schedule.effect !== 'read') throw new Error('Unsupported saved schedule effect')
      }

      for (const run of state.runs) {
        savedTaskSchema.parse(run.payload)
        if (run.effect !== 'read' || run.approval) throw new Error('Unsupported saved run permissions')
      }

      // A cancellation receipt survives a crash before the actual executor settles.
      for (const run of state.runs)
        if (run.status === 'queued' && state.data[`cancel:${run.id}`] === true) store.cancel(run.id)
    } catch (error) {
      store.close()
      throw error
    }
  }

  cancel(id: string): void {
    this.assertOpen()
    if (this.active?.id === id) {
      try {
        if (this.store.snapshot().data[`cancel:${id}`] !== true) this.store.setData(`cancel:${id}`, true)
      } finally {
        this.active.controller.abort()
      }
    }
    // Active runs stay running until the actual executor reports quiescence or uncertainty.
    else this.store.cancel(id)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.active?.controller.abort()
    try {
      await this.ticking?.catch(() => {})
      await this.active?.done.catch(() => {})
    } finally {
      this.store.close()
    }
  }

  async create(input: unknown): Promise<string> {
    const value = scheduleSchema.parse(input)
    this.assertOpen()
    const serialized = JSON.stringify(value)
    const state = this.store.snapshot()
    const previous = state.schedules.find(
      (schedule) => savedTaskSchema.parse(schedule.payload).creation.operationId === value.operationId,
    )
    if (previous) {
      if (savedTaskSchema.parse(previous.payload).creation.input !== serialized)
        throw new Error('Conflicting task creation request')
      return previous.id
    }

    const workspace = await fs.realpath(value.task.workspace)
    if (!(await fs.stat(workspace)).isDirectory()) throw new Error('Workspace must be a directory')
    this.assertOpen()
    // Recheck after filesystem awaits: concurrent creates may have saved this replay key.
    const current = this.store
      .snapshot()
      .schedules.find((schedule) => savedTaskSchema.parse(schedule.payload).creation.operationId === value.operationId)
    if (current) {
      if (savedTaskSchema.parse(current.payload).creation.input !== serialized)
        throw new Error('Conflicting task creation request')
      return current.id
    }

    if (this.store.snapshot().schedules.length >= 100) throw new Error('Local task limit reached (100)')
    const task = {...value.task, creation: {input: serialized, operationId: value.operationId}, workspace}
    const id = this.store.schedule({
      effect: 'read',
      ...(value.interval === undefined ? {} : {interval: value.interval}),
      next: value.next,
      payload: savedTaskSchema.parse(task),
    })
    return id
  }

  pause(id: string, paused: boolean): void {
    this.assertOpen()
    const state = this.store.snapshot()
    const schedule = state.schedules.find((value) => value.id === id)
    if (
      !paused &&
      schedule &&
      !schedule.interval &&
      state.occurrences.some((occurrence) => occurrence.scheduleId === id)
    )
      throw new ExecutionRequestError(
        'This one-time occurrence was already created. Create a new task for another occurrence.',
      )
    this.store.pause(id, paused)
  }

  reconcile(id: string, evidence: string, confirmedStopped: true): void {
    this.assertOpen()
    if (this.active?.id === id) throw new Error('Execution is still owned by this host')
    if (!evidence.trim() || evidence.length > 2000) throw new Error('Provide bounded reconciliation evidence')
    this.store.reconcile(id, evidence, confirmedStopped)
  }

  snapshot() {
    const state = this.store.snapshot()
    return {
      attempts: state.attempts,
      cancelling: this.active?.controller.signal.aborted ? this.active.id : undefined,
      enabled: this.timer !== undefined,
      error: this.failure,
      occurrences: state.occurrences,
      runs: state.runs,
      schedules: state.schedules,
    }
  }

  start(): void {
    this.assertOpen()
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch(() => {})
    }, 1000)
    this.timer.unref()
  }

  tick(now = Date.now()): Promise<void> {
    if (this.ticking) return this.ticking
    this.ticking = this.dispatch(now)
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error.message : String(error)
        if (this.timer) clearInterval(this.timer)
        this.timer = undefined
        throw error
      })
      .finally(() => {
        this.ticking = undefined
      })
    return this.ticking
  }

  private assertOpen(): void {
    if (this.closed || this.failure) throw new Error(this.failure ?? 'Local scheduler closed')
  }

  private async dispatch(now: number): Promise<void> {
    this.assertOpen()
    if (this.active) return
    if (this.store.snapshot().runs.some((run) => run.status === 'unknown')) return
    this.store.materialize(now)
    const run = this.store.snapshot().runs.find((value) => value.status === 'queued')
    if (!run) return
    const controller = new AbortController()
    const done = this.run(run, controller)
    this.active = {controller, done, id: run.id}
    try {
      await done
    } finally {
      this.active = undefined
    }
  }

  private async run(run: ScheduledRun, controller: AbortController): Promise<void> {
    const attempt = this.store.claim(run.id)
    let outcome: LocalTaskResult
    try {
      const task = savedTaskSchema.parse(run.payload)
      if (run.effect !== 'read' || run.approval) throw new Error('Unsupported task permissions')
      const current = await fs.realpath(task.workspace)
      if (current !== task.workspace || !(await fs.stat(current)).isDirectory())
        throw new Error('Workspace changed or is unavailable')
      if (controller.signal.aborted) {
        this.store.cancel(run.id)
        return
      }

      try {
        outcome = await this.execute(task, run.requestId, controller.signal)
      } catch (error) {
        outcome = {result: error instanceof Error ? error.message : String(error), status: 'unknown'}
      }
    } catch (error) {
      outcome = {result: error instanceof Error ? error.message : String(error), status: 'failed'}
    }

    if (controller.signal.aborted && outcome.status !== 'unknown') this.store.cancel(run.id)
    else this.store.finish(run.id, attempt.id, outcome.status, outcome.result.slice(0, 100_000))
  }
}
