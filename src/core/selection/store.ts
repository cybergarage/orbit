// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {WorkflowCandidate, WorkflowEligibility} from './validation.js'

import {DEFAULT_SELECTION_LIMITS, immutable, manifestSchema, selectionJSON, selectionText} from './validation.js'
export interface WorkflowDecision {
  at: number
  candidate: string
  evidence: string
  generation: number
  id: string
  previous: null | string
  principal: string
  reason: string
  submission: string
}
export interface WorkflowReceipt {
  candidate: string
  evidence: string
  generation: number
  id: string
  input: string
  observation?: string
  observations?: WorkflowObservation[]
  owner: string
  request: string
  session: string
  status: 'captured' | 'dispatching' | 'observed' | 'unverified'
  storage: string
  submission: string
}
export interface WorkflowObservation {
  at: number
  issues: string[]
  runId?: string
  settlement?: unknown
  status: 'conflicting' | 'matched' | 'not-admitted' | 'unverified'
  terminal?: unknown
}
export interface WorkflowEvidence {
  inspection: WorkflowEligibility
  plan: string
  policy: string
  reports: string
}
export interface WorkflowScopeState {
  active: null | string
  authority: number
  availability: number
  candidates: Record<string, {available: boolean; evidence: WorkflowEligibility; manifest: WorkflowCandidate}>
  context: string
  decisions: WorkflowDecision[]
  evidence: Record<string, WorkflowEvidence>
  generation: number
  id: string
  level: string
  mapping: string
  mode: 'memory' | 'transactional-host'
  prepared: string
  projector: string
  receipts: WorkflowReceipt[]
  revision: 1
  sessions: Record<string, string>
}
export interface WorkflowStore {
  readonly level: string
  readonly mode: 'memory' | 'transactional-host'
  read(scope: string): Promise<WorkflowScopeState>
  /** Must be atomic, serializable across processes, durable at level, and invoke update exactly once. No async callback. */
  transact<T>(scope: string, update: (state: WorkflowScopeState) => T): Promise<T>
}
/** Explicitly volatile. A new instance has a new scope, never rehydrates a previous scope. */
export class MemoryWorkflowStore implements WorkflowStore {
  readonly level = 'memory'
  readonly mode = 'memory' as const
  readonly scope: string
  private state: WorkflowScopeState

  constructor(
    context: {context: string; mapping: string; prepared: string; projector: string},
    private readonly limits: {bytes: number; candidates: number; receipts: number} = {...DEFAULT_SELECTION_LIMITS},
  ) {
    context = z
      .object({
        context: z.string().regex(/^[a-f0-9]{64}$/),
        mapping: z.string().min(1).max(2048),
        prepared: z.string().regex(/^[a-f0-9]{64}$/),
        projector: z.string().min(1).max(2048),
      })
      .strict()
      .parse(selectionText(selectionJSON(context)))
    this.limits = Object.freeze(
      z
        .object({
          bytes: z.number().int().min(1).max(DEFAULT_SELECTION_LIMITS.bytes),
          candidates: z.number().int().min(1).max(DEFAULT_SELECTION_LIMITS.candidates),
          receipts: z.number().int().min(1).max(DEFAULT_SELECTION_LIMITS.receipts),
        })
        .strict()
        .parse(limits),
    )
    for (const [k, v] of Object.entries(limits))
      if (!Number.isSafeInteger(v) || v < 1 || v > DEFAULT_SELECTION_LIMITS[k as keyof typeof DEFAULT_SELECTION_LIMITS])
        throw new Error('Invalid memory selection limit')
    this.scope = randomUUID()
    this.state = {
      id: this.scope,
      level: this.level,
      mode: this.mode,
      revision: 1,
      ...context,
      active: null,
      authority: 0,
      availability: 0,
      candidates: {},
      decisions: [],
      evidence: {},
      generation: 0,
      receipts: [],
      sessions: {},
    }
  }

  async read(scope: string): Promise<WorkflowScopeState> {
    this.require(scope)
    return immutable(structuredClone(this.state))
  }

  async transact<T>(scope: string, update: (state: WorkflowScopeState) => T): Promise<T> {
    this.require(scope)
    const next = structuredClone(this.state)
    const result = update(next)
    if (result instanceof Promise) throw new Error('Workflow transaction callback must be synchronous')
    if (
      Object.keys(next.candidates).length > this.limits.candidates ||
      next.decisions.length + next.receipts.length > this.limits.receipts
    )
      throw new Error('Workflow store capacity exceeded')
    // Bound the retained payload independently from individual wire documents.
    if (Buffer.byteLength(JSON.stringify(next)) > this.limits.bytes)
      throw new Error('Workflow store byte capacity exceeded')
    this.state = structuredClone(next)
    return structuredClone(result)
  }

  private require(scope: string) {
    if (scope !== this.scope) throw new Error('Unknown volatile workflow scope')
  }
}

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const identity = z.string().min(1).max(2048)
const eligibility = z
  .object({
    candidate: identity,
    digest: identity,
    eligible: z.boolean(),
    issues: z.array(z.string()),
    missingOptional: z.array(z.string()),
    plan: identity,
    policy: identity,
  })
  .strict()
const observation = z
  .object({
    at: counter,
    issues: z.array(z.string()),
    runId: identity.optional(),
    settlement: z.unknown().optional(),
    status: z.enum(['matched', 'conflicting', 'unverified', 'not-admitted']),
    terminal: z.unknown().optional(),
  })
  .strict()
const stateSchema = z
  .object({
    active: identity.nullable(),
    authority: counter,
    availability: counter,
    candidates: z.record(
      z.string(),
      z.object({available: z.boolean(), evidence: eligibility, manifest: manifestSchema}).strict(),
    ),
    context: identity,
    decisions: z.array(
      z
        .object({
          at: counter,
          candidate: identity,
          evidence: identity,
          generation: counter,
          id: identity,
          previous: identity.nullable(),
          principal: identity,
          reason: identity,
          submission: z.string(),
        })
        .strict(),
    ),
    evidence: z.record(
      z.string(),
      z.object({inspection: eligibility, plan: z.string(), policy: z.string(), reports: z.string()}).strict(),
    ),
    generation: counter,
    id: identity,
    level: identity,
    mapping: identity,
    mode: z.enum(['memory', 'transactional-host']),
    prepared: identity,
    projector: identity,
    receipts: z.array(
      z
        .object({
          candidate: identity,
          evidence: identity,
          generation: counter,
          id: identity,
          input: z.string(),
          observation: z.string().optional(),
          observations: z.array(observation).optional(),
          owner: identity,
          request: identity,
          session: identity,
          status: z.enum(['captured', 'dispatching', 'observed', 'unverified']),
          storage: identity,
          submission: z.string(),
        })
        .strict(),
    ),
    revision: z.literal(1),
    sessions: z.record(z.string(), identity),
  })
  .strict()
/** Fixed revision-1 reader, independent of the memory producer's lower limits. */
export function parseWorkflowScope(text: string): WorkflowScopeState {
  return immutable(stateSchema.parse(selectionText(text, 16_777_216)))
}
