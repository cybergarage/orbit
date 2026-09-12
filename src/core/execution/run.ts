// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'

import type {SkillSelection} from '../skills/catalog.js'
import type {ExecutionJournal, JournalKind, JournalLevel, JournalRecord} from './journal.js'

import {normalizeSkillSelections} from '../skills/catalog.js'
import {canonicalJSON, copyJSON, safeIdentity} from './journal.js'
import {recordReconciliation} from './recovery.js'

export interface RunLimits {
  approvalMs: number
  cleanupMs: number
  elapsedMs: number
  mcpServers: number
  mcpStartupMs: number
  modelCalls: number
  toolRequests: number
  toolRounds: number
}
export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = Object.freeze({
  approvalMs: 300_000,
  cleanupMs: 5000,
  elapsedMs: 600_000,
  mcpServers: 16,
  mcpStartupMs: 30_000,
  modelCalls: 6,
  toolRequests: 32,
  toolRounds: 5,
})
export type RunOutcome = 'budget-exceeded' | 'cancelled' | 'completed' | 'failed' | 'incomplete'
export type RunPhase = 'awaiting-approval' | 'finalizing' | 'initializing' | 'running' | 'stopping' | 'terminal'
export interface OperationOutcome {
  id: string
  status: 'cancelled-before-start' | 'denied' | 'failed' | 'invalid' | 'succeeded' | 'unknown'
}
export interface RunResult {
  cleanupErrors: string[]
  operations: OperationOutcome[]
  outcome: RunOutcome
  quiescence: boolean
  reason: string
  recording: {level: JournalLevel; mode: 'file' | 'memory'; status: 'acknowledged' | 'failed' | 'recovered'}
  runId: string
  sessionId: string
  stopRequest?: string
  unresolved: string[]
}
export interface ApprovalRequest {
  digest: string
  expiresAt: number
  id: string
  operationId: string
  parentPhase: 'initializing' | 'running'
  policy?: string
  preview: Record<string, unknown>
  responderScope: string
  runId: string
  sessionId: string
}
export interface ApprovalReply {
  approve: boolean
  digest: string
  requestId: string
  responderScope: string
}
export interface RunSnapshot {
  approvals: ApprovalRequest[]
  budget: {modelCalls: number; toolRequests: number; toolRounds: number}
  phase: RunPhase
  quarantined: boolean
  result?: RunResult
  runId: string
  sequence: number
  sessionId: string
  skills?: {requested: SkillSelection[]; resolved?: SkillSelection[]; snapshotId?: string}
  stopRequest?: string
  unresolved: string[]
  version: 1
}
export interface RunHandle<T = unknown> {
  finished: Promise<RunResult>
  getSnapshot(): RunSnapshot
  id: string
  requestStop(reason?: string): 'already-terminal' | 'requested'
  value(): T | undefined
}
export class RunExecutionError extends Error {
  constructor(readonly result: RunResult) {
    super(
      `Run ${result.runId}: ${result.outcome}; reason=${result.reason}; recording=${result.recording.status}; quiescence=${result.quiescence}`,
    )
    this.name = 'RunExecutionError'
  }
}
export class RunStoppedError extends Error {}
export class ExecutionRequestError extends Error {}
export interface RunStartOptions<T> {
  cleanup?: () => Promise<void>
  configuration: Record<string, unknown>
  execute(context: RunContext): Promise<T>
  input: unknown
  journal: () => Promise<ExecutionJournal>
  limits?: Partial<RunLimits>
  onApproval?: (request: ApprovalRequest) => Promise<void> | void
  onSnapshot?: (snapshot: RunSnapshot) => void
  requestedSkills?: SkillSelection[]
  requestId: string
  responderScope?: string
  runId?: string
  sessionId: string
  signal?: AbortSignal
  synchronize?: () => Promise<unknown>
}
interface ApprovalState {
  grant?: boolean
  reply?: Promise<'recorded'>
  request: ApprovalRequest
  resolve(value: boolean): void
}

/** A run owns every started promise even after its bounded caller wait ends. */
export class RunContext {
  readonly approvals = new Map<string, ApprovalState>()
  readonly budget = {modelCalls: 0, toolRequests: 0, toolRounds: 0}
  cleanupDeadline?: number
  readonly cleanupErrors: string[] = []
  readonly controller = new AbortController()
  readonly limits: RunLimits
  readonly operations: OperationOutcome[] = []
  readonly pending = new Map<string, Promise<unknown>>()
  phase: RunPhase = 'initializing'
  recordingFailed = false
  released = false
  result?: RunResult
  sequence = 0
  stopReason?: string
  private catalog?: string
  private readonly leases: (() => void)[] = []
  private readonly releasedPromise: Promise<void>
  private resolveRelease!: () => void
  private resolveStop!: () => void
  private skillResolution?: {resolved: SkillSelection[]; snapshotId: string}
  private readonly stopped: Promise<void>
  private terminalSealed = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    readonly id: string,
    readonly options: RunStartOptions<unknown>,
    readonly journal: ExecutionJournal,
    readonly startedAt: number,
    limits: RunLimits,
  ) {
    this.releasedPromise = new Promise((resolve) => {
      this.resolveRelease = resolve
    })
    this.limits = limits
    this.stopped = new Promise((resolve) => {
      this.resolveStop = resolve
    })
    this.timer = setTimeout(() => this.requestStop('budget-exceeded'), Math.max(0, this.remaining()))
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  async ask(
    operationId: string,
    digest: string,
    preview: Record<string, unknown>,
    policy = 'owner',
  ): Promise<{expiresAt: number; granted: boolean; requestId: string}> {
    this.check()
    if (!this.options.responderScope || !this.options.onApproval) {
      await this.record('authorization-decided', {
        decision: 'deny',
        digest,
        operationId,
        policy,
        reason: 'approval-unavailable',
      })
      return {expiresAt: Date.now(), granted: false, requestId: 'approval-unavailable'}
    }

    const parentPhase = this.catalog ? 'running' : 'initializing'
    const request: ApprovalRequest = {
      digest,
      expiresAt: Date.now() + Math.min(this.limits.approvalMs, this.remaining()),
      id: randomUUID(),
      operationId,
      parentPhase,
      policy,
      preview: copyJSON(preview),
      responderScope: this.options.responderScope,
      runId: this.id,
      sessionId: this.options.sessionId,
    }
    let resolve!: (value: boolean) => void
    const decision = new Promise<boolean>((done) => {
      resolve = done
    })
    const state: ApprovalState = {request, resolve}
    await this.record('approval-requested', {
      digest,
      expiresAt: request.expiresAt,
      operationId,
      policy,
      requestId: request.id,
      responderScope: request.responderScope,
    })
    this.approvals.set(request.id, state)
    this.phase = 'awaiting-approval'
    this.emit()
    const timeout = setTimeout(() => resolve(false), Math.max(0, request.expiresAt - Date.now()))
    // Responders are notifications, never mandatory sinks. Replies use replyApproval.
    try {
      Promise.resolve(this.options.onApproval(copyJSON(request))).catch(() => resolve(false))
    } catch {
      resolve(false)
    }

    try {
      const granted = await this.wait('approval', decision)
      if (state.grant === undefined) {
        state.grant = false
        state.reply = this.record('authorization-decided', {
          decision: 'deny',
          digest,
          operationId,
          policy,
          reason: 'approval-expired-or-unavailable',
          requestId: request.id,
        }).then(() => 'recorded' as const)
        await state.reply
      }

      return {expiresAt: request.expiresAt, granted, requestId: request.id}
    } finally {
      clearTimeout(timeout)
      if (!this.stopReason) this.phase = parentPhase
      this.emit()
    }
  }

  catalogIdentity(): string | undefined {
    return this.catalog
  }

  check(): void {
    if (this.remaining() <= 0 && !this.stopReason) this.requestStop('budget-exceeded')
    if (this.stopReason || this.result) throw new RunStoppedError(this.stopReason ?? 'already-terminal')
  }

  clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  consume(kind: keyof RunContext['budget'], count = 1): void {
    this.check()
    if (this.budget[kind] + count > this.limits[kind]) {
      this.requestStop('budget-exceeded')
      throw new RunStoppedError('budget-exceeded')
    }

    this.budget[kind] += count
    this.emit()
  }

  elapsed(): number {
    return performance.now() - this.startedAt
  }

  emit(): void {
    this.sequence += 1
    try {
      Promise.resolve(this.options.onSnapshot?.(this.snapshot())).catch(() => {})
    } catch {
      /* Optional observers cannot break execution. */
    }
  }

  async ready(catalog: unknown): Promise<void> {
    this.check()
    this.catalog = this.journal.digest(catalog)
    await this.record('run-ready', {
      catalog: this.catalog,
      ...(this.skillResolution ? {skills: this.skillResolution} : {}),
    })
    this.phase = 'running'
    this.emit()
  }

  async record(kind: JournalKind, data: Record<string, unknown>, finalizing = false): Promise<void> {
    const promise = this.track('journal', this.journal.append(this.id, kind, data, this.elapsed()))
    try {
      await (finalizing
        ? until(promise, this.cleanupDeadline ?? performance.now() + this.limits.cleanupMs)
        : this.wait('record-ack', promise))
    } catch (error) {
      this.recordingFailed = true
      if (!finalizing) this.requestStop('recording-failed')
      throw error
    }
  }

  release(): void {
    for (const release of this.leases.splice(0)) release()
    this.released = true
    this.resolveRelease()
  }

  remaining(): number {
    return this.limits.elapsedMs - this.elapsed()
  }

  async replyApproval(reply: ApprovalReply): Promise<'recorded'> {
    const state = this.approvals.get(reply.requestId)
    if (!state || state.request.digest !== reply.digest || state.request.responderScope !== reply.responderScope)
      throw new ExecutionRequestError('Approval identity or responder mismatch')
    if (state.grant !== undefined) {
      if (state.grant !== reply.approve) throw new ExecutionRequestError('Conflicting approval reply')
      return state.reply!
    }

    this.check()
    if (Date.now() >= state.request.expiresAt) throw new ExecutionRequestError('Approval expired')
    state.grant = reply.approve
    state.reply = this.record('authorization-decided', {
      approve: reply.approve,
      digest: reply.digest,
      operationId: state.request.operationId,
      policy: state.request.policy ?? 'owner',
      requestId: reply.requestId,
      responderScope: reply.responderScope,
    }).then(() => {
      state.resolve(reply.approve)
      this.emit()
      return 'recorded' as const
    })
    state.reply.catch(() => state.resolve(false))
    return state.reply
  }

  requestStop(reason = 'user'): 'already-terminal' | 'requested' {
    if (this.result || this.terminalSealed) return 'already-terminal'
    if (
      !['budget-exceeded', 'recording-failed', 'runtime-failed', 'shutdown', 'unknown-operation', 'user'].includes(
        reason,
      )
    )
      reason = 'application'
    if (!this.stopReason) {
      this.stopReason = reason
      this.cleanupDeadline ??= performance.now() + this.limits.cleanupMs
      this.phase = 'stopping'
      this.controller.abort(reason)
      this.resolveStop()
      for (const entry of this.approvals.values()) entry.resolve(false)
      const write = this.journal.append(this.id, 'stop-requested', {reason}, this.elapsed())
      this.track('stop-record', write)
      write.catch(() => {
        this.recordingFailed = true
      })
      this.emit()
    }

    return 'requested'
  }

  retain(release: () => void): void {
    this.leases.push(release)
  }

  sealTerminal(): void {
    this.terminalSealed = true
    this.clearTimer()
  }

  setSkillResolution(snapshotId: string, skills: SkillSelection[]): void {
    this.skillResolution = {resolved: normalizeSkillSelections(skills), snapshotId}
    this.emit()
  }

  snapshot(): RunSnapshot {
    return copyJSON({
      approvals: [...this.approvals.values()]
        .filter(
          (entry) =>
            entry.grant === undefined && Date.now() < entry.request.expiresAt && !this.result && !this.stopReason,
        )
        .map((entry) => entry.request),
      ...(this.options.requestedSkills?.length
        ? {skills: {requested: this.options.requestedSkills, ...this.skillResolution}}
        : {}),
      budget: this.budget,
      phase: this.phase,
      quarantined: Boolean(this.result) && !this.released,
      ...(this.result ? {result: this.result} : {}),
      runId: this.id,
      sequence: this.sequence,
      sessionId: this.options.sessionId,
      ...(this.stopReason ? {stopRequest: this.stopReason} : {}),
      unresolved: [...this.pending.keys()],
      version: 1,
    })
  }

  track<T>(name: string, promise: Promise<T>): Promise<T> {
    const key = `${name}:${randomUUID()}`
    this.pending.set(key, promise)
    const settled = () => {
      this.pending.delete(key)
      this.emit()
    }

    promise.then(settled, settled)
    return promise
  }

  async wait<T>(name: string, promise: Promise<T>): Promise<T> {
    const tracked = this.track(name, promise)
    const value = await Promise.race([
      tracked,
      this.stopped.then(() => {
        throw new RunStoppedError(this.stopReason)
      }),
    ])
    this.check()
    return value
  }

  whenReleased(): Promise<void> {
    return this.releasedPromise
  }
}

export class RunSupervisor {
  private admission?: Promise<RunHandle>
  private admissionFailed = false
  private admitting = false
  private closed = false
  private closePromise?: Promise<{incomplete: boolean; results: RunResult[]}>
  private readonly recovered = new Map<string, RunHandle>()
  private readonly requests = new Map<string, {input: string; promise: Promise<RunHandle>}>()
  private readonly runs = new Map<string, {context: RunContext; handle: RunHandle}>()

  close(
    deadline = performance.now() + DEFAULT_RUN_LIMITS.cleanupMs,
  ): Promise<{incomplete: boolean; results: RunResult[]}> {
    this.closed = true
    this.closePromise ??= (async () => {
      let admissionPending = false
      try {
        await until(this.admission?.catch(() => {}) ?? Promise.resolve(), deadline)
      } catch {
        admissionPending = true
      }

      const active = [...this.runs.values()]
      for (const {context} of active) {
        context.cleanupDeadline = Math.min(context.cleanupDeadline ?? deadline, deadline)
        context.requestStop('shutdown')
      }

      const results = await Promise.all(active.map(({handle}) => handle.finished))
      return {incomplete: admissionPending || active.some(({context}) => !context.released), results}
    })()
    return this.closePromise
  }

  getRun(id: string): RunSnapshot | undefined {
    return this.runs.get(id)?.context.snapshot() ?? this.recovered.get(id)?.getSnapshot()
  }

  async reconcileRun(id: string, confirmation: Parameters<typeof recordReconciliation>[2]): Promise<void> {
    const context = this.runs.get(id)?.context
    if (!context?.result || context.pending.size > 0 || context.cleanupErrors.length > 0 || context.recordingFailed)
      throw new Error('Live resources or recording failure prevent reconciliation')
    await recordReconciliation(context.journal, id, confirmation)
    context.release()
    context.emit()
  }

  replyApproval(id: string, reply: ApprovalReply): Promise<'recorded'> {
    const run = this.runs.get(id)
    return run ? run.context.replyApproval(reply) : Promise.reject(new Error('Unknown run'))
  }

  requestStop(id: string, reason?: string): 'already-terminal' | 'requested' | 'unknown' {
    return this.runs.get(id)?.context.requestStop(reason) ?? 'unknown'
  }

  startRun<T>(options: RunStartOptions<T>): Promise<RunHandle<T>> {
    // Compare submitted input before invoking a journal/configuration/resource factory.
    const input = canonicalJSON(options.input)
    safeIdentity(options.sessionId)
    safeIdentity(options.requestId)
    if (options.runId) safeIdentity(options.runId)
    const requestKey = `${options.sessionId}:${options.requestId}`
    if (!options.requestId) return Promise.reject(new Error('A request ID is required'))
    const duplicate = this.requests.get(requestKey)
    if (duplicate)
      return duplicate.input === input
        ? (duplicate.promise as Promise<RunHandle<T>>)
        : Promise.reject(new ExecutionRequestError('Conflicting request ID'))
    options = {
      ...options,
      configuration: copyJSON(options.configuration),
      input: copyJSON(options.input),
      limits: {...options.limits},
    }
    if (
      this.closed ||
      this.admitting ||
      this.admissionFailed ||
      [...this.runs.values()].some(({context}) => !context.result || !context.released || context.recordingFailed)
    )
      return Promise.reject(new ExecutionRequestError('Run supervisor is busy, closed, or quarantined'))
    this.admitting = true
    const promise = this.admit(options)
    this.admission = promise
    this.requests.set(requestKey, {input, promise})
    promise.catch(() => {
      this.requests.delete(requestKey)
    })
    return promise
  }

  async whenQuiescent(): Promise<void> {
    await this.admission?.catch(() => {})
    await Promise.all([...this.runs.values()].map(({context}) => context.whenReleased()))
  }

  private async admit<T>(options: RunStartOptions<T>): Promise<RunHandle<T>> {
    const startedAt = performance.now()
    const limits = {...DEFAULT_RUN_LIMITS, ...options.limits}
    let journal: ExecutionJournal | undefined
    try {
      for (const [name, value] of Object.entries(limits))
        if (!Number.isSafeInteger(value) || (name.endsWith('Ms') ? value <= 0 : value < 0))
          throw new Error(`Invalid run limit: ${name}`)
      const opening = options.journal()
      try {
        journal = await until(opening, startedAt + limits.elapsedMs)
      } catch (error) {
        this.admissionFailed = true
        opening.then((late) => late.close()).catch(() => {})
        throw error
      }

      if (this.closed) throw new RunStoppedError('closed-before-admission')
      if (options.signal?.aborted) throw new RunStoppedError('cancelled-before-admission')
      const requestDigest = journal.digest(options.input)
      const admitted = journal
        .records()
        .find((record) => record.kind === 'run-admitted' && record.data.requestId === options.requestId)
      if (admitted) {
        if (admitted.data.requestDigest !== requestDigest) throw new ExecutionRequestError('Conflicting request ID')
        const handle = recoveredHandle<T>(admitted.runId, options.sessionId, journal)
        this.recovered.set(handle.id, handle)
        return handle
      }

      if (
        journal
          .records()
          .some(
            (record) =>
              record.kind === 'run-admitted' &&
              !journal!
                .records()
                .some(
                  (entry) =>
                    entry.runId === record.runId &&
                    ((entry.kind === 'run-terminal' && entry.data.quiescence === true) ||
                      (entry.kind === 'late-settlement' && entry.data.settled === true)),
                ),
          )
      )
        throw new Error('Unresolved journal run requires reconciliation')
      const id = options.runId ?? randomUUID()
      await until(
        journal.append(
          id,
          'run-admitted',
          {
            configuration: journal.digest(options.configuration),
            level: journal.level,
            limits,
            mode: journal.mode,
            ...(options.requestedSkills?.length ? {skills: normalizeSkillSelections(options.requestedSkills)} : {}),
            requestDigest,
            requestId: options.requestId,
          },
          performance.now() - startedAt,
        ),
        startedAt + limits.elapsedMs,
      ).catch((error) => {
        this.admissionFailed = true
        throw error
      })
      const context = new RunContext(id, options as RunStartOptions<unknown>, journal, startedAt, limits)
      let value: T | undefined
      const handle: RunHandle<T> = {
        finished: Promise.resolve(undefined as never),
        getSnapshot: () => context.snapshot(),
        id,
        requestStop: (reason) => context.requestStop(reason),
        value: () => value,
      }
      this.runs.set(id, {context, handle})
      const forward = () => context.requestStop('user')
      options.signal?.addEventListener('abort', forward, {once: true})
      if (options.signal?.aborted) forward()
      if (this.closed) context.requestStop('shutdown')
      handle.finished = this.execute(context, options, (result) => {
        value = result
      }).finally(() => options.signal?.removeEventListener('abort', forward))
      return handle
    } finally {
      this.admitting = false
    }
  }

  private async execute<T>(
    context: RunContext,
    options: RunStartOptions<T>,
    setValue: (value: T) => void,
  ): Promise<RunResult> {
    let reason = 'completed'
    let synchronized: unknown
    let cleanupStarted = false
    try {
      setValue(
        await context.wait(
          'run-body',
          Promise.resolve().then(() => {
            context.check()
            return options.execute(context)
          }),
        ),
      )
    } catch (error) {
      reason = error instanceof Error ? error.message : 'execution-failed'
      context.requestStop(context.stopReason ?? 'runtime-failed')
    }

    context.cleanupDeadline ??= performance.now() + context.limits.cleanupMs
    context.phase = 'finalizing'
    context.emit()
    if (options.cleanup) {
      cleanupStarted = true
      const cleanup = context.track(
        'cleanup',
        Promise.resolve().then(() => options.cleanup!()),
      )
      cleanup.catch(() => {
        context.cleanupErrors.push('cleanup-failed')
      })
    }

    try {
      await until(Promise.allSettled(context.pending.values()), context.cleanupDeadline)
    } catch {
      /* Pending work retains ownership below. */
    }

    if (context.pending.size === 0) {
      try {
        if (options.synchronize)
          synchronized = await until(context.track('transcript-sync', options.synchronize()), context.cleanupDeadline)
      } catch {
        context.recordingFailed = true
      }
    }

    const unresolved = [...context.pending.keys(), ...context.cleanupErrors]
    const result: RunResult = {
      cleanupErrors: [...context.cleanupErrors],
      operations: copyJSON(context.operations),
      outcome:
        unresolved.length > 0 || context.operations.some((operation) => operation.status === 'unknown')
          ? 'incomplete'
          : context.recordingFailed || context.cleanupErrors.length > 0 || context.stopReason === 'runtime-failed'
            ? 'failed'
            : context.stopReason === 'budget-exceeded'
              ? 'budget-exceeded'
              : context.stopReason
                ? 'cancelled'
                : 'completed',
      quiescence: unresolved.length === 0 && !context.operations.some((operation) => operation.status === 'unknown'),
      reason: context.stopReason ?? reason,
      recording: {
        level: context.journal.level,
        mode: context.journal.mode,
        status: context.recordingFailed ? 'failed' : 'acknowledged',
      },
      runId: context.id,
      sessionId: options.sessionId,
      ...(context.stopReason ? {stopRequest: context.stopReason} : {}),
      unresolved,
    }
    context.sealTerminal()
    try {
      await context.record(
        'run-terminal',
        {
          ...(copyJSON(result) as unknown as Record<string, unknown>),
          ...(synchronized === undefined ? {} : {transcriptHighWater: synchronized}),
        },
        true,
      )
    } catch {
      result.recording.status = 'failed'
      result.unresolved = [...context.pending.keys()]
      result.quiescence =
        result.unresolved.length === 0 &&
        !context.operations.some((operation) => operation.status === 'unknown') &&
        context.cleanupErrors.length === 0
      result.outcome = result.quiescence ? 'failed' : 'incomplete'
    }

    context.clearTimer()
    context.result = copyJSON(result)
    context.phase = 'terminal'
    context.emit()
    if (result.quiescence) context.release()
    else {
      Promise.allSettled(context.pending.values()).then(async () => {
        try {
          if (!cleanupStarted) await options.cleanup?.()
          if (
            context.operations.some((operation) => operation.status === 'unknown') ||
            context.cleanupErrors.length > 0
          )
            return
          await options.synchronize?.()
          await context.journal.append(
            context.id,
            'late-settlement',
            {operations: copyJSON(context.operations), settled: true},
            context.elapsed(),
          )
          context.release()
        } catch {
          /* Keep quarantine and ownership until explicit recovery. */
        }

        context.emit()
      })
    }

    return copyJSON(result)
  }
}

export async function until<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new RunStoppedError('Settlement deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function recoveredRunSnapshot(
  id: string,
  sessionId: string,
  records: JournalRecord[],
  recording: {level: JournalLevel; mode: 'file' | 'memory'},
): RunSnapshot {
  const run = records.filter((entry) => entry.runId === id)
  const terminal = run.find((entry) => entry.kind === 'run-terminal')
  const outcomes = new Map<string, OperationOutcome>()
  for (const entry of run) {
    const {operationId} = entry.data
    if (typeof operationId !== 'string') continue
    if (entry.kind === 'operation-intent') outcomes.set(operationId, {id: operationId, status: 'unknown'})
    if (entry.kind === 'operation-result')
      outcomes.set(operationId, {id: operationId, status: entry.data.status as OperationOutcome['status']})
  }

  const result: RunResult = terminal
    ? {
        ...(copyJSON(terminal.data) as unknown as RunResult),
        recording: {level: recording.level, mode: recording.mode, status: 'recovered'},
      }
    : {
        cleanupErrors: [],
        operations: [...outcomes.values()],
        outcome: 'incomplete',
        quiescence: false,
        reason: 'interrupted',
        recording: {level: recording.level, mode: recording.mode, status: 'recovered'},
        runId: id,
        sessionId,
        unresolved: ['recovery-required'],
      }
  const settled = run.some((entry) => entry.kind === 'late-settlement' && entry.data.settled === true)
  const requested = normalizeSkillSelections(
    (run.find((entry) => entry.kind === 'run-admitted')?.data.skills ?? []) as SkillSelection[],
  )
  const readySkills = run.find((entry) => entry.kind === 'run-ready')?.data.skills as
    | undefined
    | {resolved: SkillSelection[]; snapshotId: string}

  return {
    ...(requested.length > 0
      ? {
          skills: {
            requested,
            ...(readySkills
              ? {resolved: normalizeSkillSelections(readySkills.resolved), snapshotId: readySkills.snapshotId}
              : {}),
          },
        }
      : {}),
    approvals: [],
    budget: {modelCalls: 0, toolRequests: 0, toolRounds: 0},
    phase: 'terminal',
    quarantined: !result.quiescence && !settled,
    result,
    runId: id,
    sequence: run.at(-1)?.sequence ?? 0,
    sessionId,
    unresolved: settled ? [] : result.unresolved,
    version: 1,
  }
}

function recoveredHandle<T>(id: string, sessionId: string, journal: ExecutionJournal): RunHandle<T> {
  const snapshot = recoveredRunSnapshot(id, sessionId, journal.records(), journal)
  return {
    finished: Promise.resolve(copyJSON(snapshot.result!)),
    getSnapshot: () => recoveredRunSnapshot(id, sessionId, journal.records(), journal),
    id,
    requestStop: () => 'already-terminal',
    value(): undefined {},
  }
}
