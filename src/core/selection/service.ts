// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {CompiledProcessorGraph, GraphJSON} from '../processor/graph-definition.js'
import type {WorkflowExpectation, WorkflowSubmission} from './binding.js'
import type {WorkflowObservation, WorkflowReceipt, WorkflowScopeState, WorkflowStore} from './store.js'

import {RunAdmissionRejectedError} from '../execution/run.js'
import {parseWorkflowSubmission} from './binding.js'
import {parseWorkflowScope} from './store.js'
import {
  immutable,
  inspectWorkflowCandidate,
  parseWorkflowCandidate,
  selectionJSON,
  selectionText,
  verifyWorkflowGraph,
} from './validation.js'

export type WorkflowPurpose = 'confirm' | 'dispatch' | 'maintain' | 'read' | 'register'
export interface WorkflowGrant {
  epoch: number
  expires: number
  principal: string
  scope: string
}
/** Host verifies opaque capability provenance; JSON fields and model text cannot grant authority. */
export interface WorkflowAuthority {
  verify(capability: unknown, purpose: WorkflowPurpose): WorkflowGrant
}
export interface WorkflowTarget<T> {
  availability?(): {available: boolean; reason: string}
  context: string
  /** Pure trusted projection using an existing Agent, no factories/discovery. */
  encode(graph: CompiledProcessorGraph, input: GraphJSON, skills: unknown[], expectation: WorkflowExpectation): string
  identify(value: T): string
  mapping: string
  projector: string
  /** Explicit immutable Session/storage mapping, shared by all surfaces. */
  session: string
  start(
    graph: CompiledProcessorGraph,
    input: GraphJSON,
    options: {requestId: string; selection: WorkflowSubmission; skills: unknown[]},
  ): Promise<T>
  storage: string
}
const id = z.string().min(1).max(2048)
const previewSchema = z
  .object({
    authority: z.number().int().nonnegative(),
    availability: z.number().int().nonnegative(),
    candidate: id,
    context: id,
    current: id.nullable(),
    evidence: id,
    expires: z.number().int().positive(),
    generation: z.number().int().nonnegative(),
    level: id,
    manifest: id,
    missingOptional: z.array(z.string()),
    mode: z.enum(['memory', 'transactional-host']),
    plan: id,
    policy: id,
    principal: id,
    projector: id,
    reason: id,
    revision: z.literal(1),
    scope: id,
  })
  .strict()
const requestSchema = z
  .object({
    id,
    input: z.unknown(),
    revision: z.literal(1),
    skills: z.array(z.object({digest: z.string().regex(/^[a-f0-9]{64}$/), id}).strict()),
  })
  .strict()
export type WorkflowDispatch<T> =
  | {kind: 'live'; receipt: WorkflowReceipt; value: T}
  | {kind: 'observation'; receipt: WorkflowReceipt}
class Rejected extends Error {}

/** App coordination only: no alternate runner or persisted database is created. */
export class WorkflowSelectionService<T> {
  private readonly bundles = new Map<string, CompiledProcessorGraph>()
  private readonly incarnation = randomUUID()
  private readonly live = new Map<string, Promise<WorkflowDispatch<T>>>()
  private uncertain = false

  constructor(
    readonly scope: string,
    private readonly store: WorkflowStore,
    private readonly authority: WorkflowAuthority,
    private readonly target: WorkflowTarget<T>,
    private readonly now = Date.now,
  ) {
    this.target = Object.freeze({...target})
    if (
      (store.mode === 'memory' && store.level !== 'memory') ||
      (store.mode === 'transactional-host' && ['', 'memory'].includes(store.level))
    )
      throw new Error('Invalid selection storage mode/level')
  }

  /** Host first stops admission/restarters and proves this store's actual sync/continuity. */
  async acknowledgeStoreRecovery(
    capability: unknown,
    confirmation: {automaticRestartersDisabled: true; exclusiveVerification: true; externalAdmissionStopped: true},
  ): Promise<void> {
    if (
      confirmation.externalAdmissionStopped !== true ||
      confirmation.automaticRestartersDisabled !== true ||
      confirmation.exclusiveVerification !== true
    )
      throw new Error('Exclusive store verification required')
    const state = await this.read()
    this.authorize(state, capability, 'maintain')
    this.uncertain = false
  }

  async confirmSelection(requestId: string, preview: string, capability: unknown) {
    id.parse(requestId)
    const p = previewSchema.parse(selectionText(preview))
    const submission = selectionJSON(p)
    return this.transaction((state) => {
      this.authorize(state, capability, 'read')
      const old = state.decisions.find((d) => d.id === requestId)
      if (old) {
        if (old.submission !== submission) throw new Rejected('Conflicting selection request')
        return old
      }

      const grant = this.authorize(state, capability, 'confirm')
      const c = this.eligible(state, p.candidate)
      if (
        p.current !== state.active ||
        p.manifest !== c.manifest.digest ||
        p.context !== state.context ||
        p.projector !== state.projector ||
        p.mode !== state.mode ||
        p.level !== state.level ||
        p.plan !== c.evidence.plan ||
        p.policy !== c.evidence.policy ||
        selectionJSON(p.missingOptional) !== selectionJSON(c.evidence.missingOptional) ||
        p.scope !== state.id ||
        p.generation !== state.generation ||
        p.availability !== state.availability ||
        p.authority !== state.authority ||
        p.principal !== grant.principal ||
        p.evidence !== c.evidence.digest ||
        p.expires <= this.now()
      )
        throw new Rejected('Stale selection preview')
      if (state.generation === Number.MAX_SAFE_INTEGER) throw new Rejected('Selection generation exhausted')
      const decision = {
        at: this.now(),
        candidate: p.candidate,
        evidence: p.evidence,
        generation: state.generation + 1,
        id: requestId,
        previous: state.active,
        principal: grant.principal,
        reason: p.reason,
        submission,
      }
      state.decisions.push(decision)
      state.generation++
      state.active = p.candidate
      return decision
    })
  }

  async inspectCandidates(capability: unknown): Promise<WorkflowScopeState> {
    const state = await this.read()
    this.authorize(state, capability, 'read')
    return immutable(state)
  }

  async prepareSelection(candidate: string, reason: string, capability: unknown): Promise<string> {
    if (this.uncertain) throw new Error('Selection store requires exclusive verification')
    const state = await this.read()
    const grant = this.authorize(state, capability, 'confirm')
    const c = this.eligible(state, candidate)
    return selectionJSON(
      previewSchema.parse({
        authority: state.authority,
        availability: state.availability,
        candidate,
        context: state.context,
        current: state.active,
        evidence: c.evidence.digest,
        expires: Math.min(grant.expires, this.now() + 300_000),
        generation: state.generation,
        level: state.level,
        manifest: c.manifest.digest,
        missingOptional: c.evidence.missingOptional,
        mode: state.mode,
        plan: c.evidence.plan,
        policy: c.evidence.policy,
        principal: grant.principal,
        projector: state.projector,
        reason,
        revision: 1,
        scope: this.scope,
      }),
    )
  }

  /** Append host-authorized read-only evidence; never changes the dispatch entitlement or original terminal. */
  async recordObservation(
    receiptId: string,
    observation: Omit<WorkflowObservation, 'at'>,
    capability: unknown,
  ): Promise<void> {
    const clean = selectionText(selectionJSON(observation)) as Omit<WorkflowObservation, 'at'>
    if (
      !['conflicting', 'matched', 'unverified'].includes(clean.status) ||
      !Array.isArray(clean.issues) ||
      clean.issues.some((i) => typeof i !== 'string') ||
      (clean.status === 'matched' && !clean.runId)
    )
      throw new Error('Invalid binding observation')
    await this.transaction((state) => {
      this.authorize(state, capability, 'maintain')
      const r = state.receipts.find((r) => r.id === receiptId)
      if (!r) throw new Rejected('Unknown receipt')
      ;(r.observations ??= []).push({...clean, at: this.now()})
    })
  }

  async registerCandidate(
    text: string,
    graph: CompiledProcessorGraph,
    plan: string,
    reports: string,
    policy: string,
    capability: unknown,
  ): Promise<void> {
    const manifest = parseWorkflowCandidate(text)
    if (['__proto__', 'constructor', 'prototype'].includes(manifest.id)) throw new Error('Reserved candidate ID')
    verifyWorkflowGraph(manifest, graph)
    const evidence = inspectWorkflowCandidate(text, plan, reports, policy)
    await this.transaction((state) => {
      this.authorize(state, capability, 'register')
      if (
        manifest.context !== state.context ||
        manifest.prepared !== state.prepared ||
        manifest.projector !== state.projector ||
        manifest.mapping !== state.mapping
      )
        throw new Rejected('Candidate scope mismatch')
      const previous = state.candidates[manifest.id]
      if (previous && previous.manifest.digest !== manifest.digest) throw new Rejected('Candidate ID is immutable')
      if (previous && previous.evidence.digest !== evidence.digest)
        throw new Rejected('Use explicit evidence replacement')
      state.evidence[evidence.digest] = {inspection: evidence, plan, policy, reports}
      if (!previous) {
        state.candidates[manifest.id] = {available: true, evidence, manifest}
        state.availability++
      }
    })
    this.bundles.set(manifest.id, graph)
  }

  /** Evidence correction is explicit; never rewrites a past decision/receipt. */
  async replaceEvidence(
    candidate: string,
    plan: string,
    reports: string,
    policy: string,
    capability: unknown,
  ): Promise<void> {
    const before = await this.read()
    const old = before.candidates[candidate]
    if (!old) throw new Error('Unknown candidate')
    const evidence = inspectWorkflowCandidate(selectionJSON(old.manifest), plan, reports, policy)
    await this.transaction((state) => {
      this.authorize(state, capability, 'register')
      if (state.availability !== before.availability) throw new Rejected('Stale evidence update')
      state.evidence[evidence.digest] = {inspection: evidence, plan, policy, reports}
      state.candidates[candidate].evidence = evidence
      state.availability++
    })
  }

  async revokeScopeAuthority(capability: unknown): Promise<void> {
    await this.transaction((state) => {
      this.authorize(state, capability, 'maintain')
      state.authority++
    })
  }

  async setAvailability(candidate: string, available: boolean, capability: unknown): Promise<void> {
    await this.transaction((state) => {
      this.authorize(state, capability, 'register')
      if (!state.candidates[candidate]) throw new Rejected('Unknown candidate')
      state.candidates[candidate].available = available
      state.availability++
    })
  }

  /** Exact input is compared before looking at current selection or a bundle. */
  async startSelectedGraphRun(text: string, capability: unknown): Promise<WorkflowDispatch<T>> {
    const request = requestSchema.parse(selectionText(text, 1_048_576))
    const submission = selectionJSON(request, 1_048_576)
    const before = await this.read()
    this.authorize(before, capability, 'read')
    const previous = before.receipts.find((r) => r.session === this.target.session && r.request === request.id)
    if (previous) {
      if (previous.storage !== this.target.storage || previous.submission !== submission)
        throw new Error('Conflicting selected request')
      return this.live.get(previous.id) ?? {kind: 'observation', receipt: previous}
    }

    const receiptId = randomUUID()
    const created = await this.transaction((state) => {
      this.authorize(state, capability, 'dispatch')
      const prior = state.receipts.find((r) => r.session === this.target.session && r.request === request.id)
      if (prior) {
        if (prior.storage !== this.target.storage || prior.submission !== submission)
          throw new Rejected('Conflicting selected request')
        return {created: false, receipt: prior}
      }

      if (
        state.context !== this.target.context ||
        state.projector !== this.target.projector ||
        state.mapping !== this.target.mapping
      )
        throw new Rejected('Selected target mismatch')
      if (['__proto__', 'constructor', 'prototype'].includes(this.target.session))
        throw new Rejected('Reserved Session ID')
      if (
        (state.sessions[this.target.session] && state.sessions[this.target.session] !== this.target.storage) ||
        Object.entries(state.sessions).some(
          ([session, storage]) => session !== this.target.session && storage === this.target.storage,
        )
      )
        throw new Rejected('Ambiguous Session storage mapping')
      if (!state.active) throw new Rejected('No selected candidate')
      const c = this.eligible(state, state.active)
      if (state.decisions[state.generation - 1]?.evidence !== c.evidence.digest)
        throw new Rejected('Corrected evidence requires human confirmation')
      const graph = this.bundles.get(state.active)
      if (!graph) throw new Rejected('Candidate bundle unavailable')
      verifyWorkflowGraph(c.manifest, graph)
      const expectation: WorkflowExpectation = {
        candidate: c.manifest.digest,
        context: state.context,
        generation: state.generation,
        prepared: c.manifest.prepared,
        projector: state.projector,
        receipt: receiptId,
        revision: 1,
        scope: this.scope,
      }
      const input = this.target.encode(graph, request.input as GraphJSON, request.skills, expectation)
      parseWorkflowSubmission({expectation, input})
      const projected = selectionText(input, 1_048_576) as {selection: WorkflowExpectation}
      if (selectionJSON(projected.selection) !== selectionJSON(expectation))
        throw new Rejected('Missing encoded expectation')
      const receipt: WorkflowReceipt = {
        candidate: state.active,
        evidence: c.evidence.digest,
        generation: state.generation,
        id: receiptId,
        input,
        owner: this.incarnation,
        request: request.id,
        session: this.target.session,
        status: 'captured',
        storage: this.target.storage,
        submission,
      }
      state.sessions[this.target.session] = this.target.storage
      state.receipts.push(receipt)
      return {created: true, receipt}
    })
    if (!created.created) return this.live.get(created.receipt.id) ?? {kind: 'observation', receipt: created.receipt}
    const dispatch = this.dispatch(created.receipt, request)
    this.live.set(created.receipt.id, dispatch)
    dispatch.catch(() => {
      this.live.delete(created.receipt.id)
    })
    return dispatch
  }

  private authorize(state: WorkflowScopeState, capability: unknown, purpose: WorkflowPurpose): WorkflowGrant {
    let g: WorkflowGrant
    try {
      g = this.authority.verify(capability, purpose)
    } catch {
      throw new Rejected('Workflow capability rejected')
    }

    if (
      !g ||
      g.scope !== state.id ||
      g.epoch !== state.authority ||
      !g.principal ||
      !Number.isSafeInteger(g.expires) ||
      g.expires <= this.now()
    )
      throw new Rejected('Workflow authority unavailable')
    return g
  }

  private async dispatch(
    receipt: WorkflowReceipt,
    request: z.infer<typeof requestSchema>,
  ): Promise<WorkflowDispatch<T>> {
    // Grant is consumed through the same store, and can never be recovered from a read.
    await this.transaction((state) => {
      const r = state.receipts.find((r) => r.id === receipt.id)
      if (!r || r.owner !== this.incarnation || r.status !== 'captured')
        throw new Rejected('Dispatch entitlement consumed')
      r.status = 'dispatching'
    })
    try {
      const availability = this.target.availability?.()
      if (availability && !availability.available) {
        await this.transaction((state) => {
          const r = state.receipts.find((r) => r.id === receipt.id)!
          r.status = 'observed'
          r.observation = 'Definite pre-dispatch rejection'
          r.observations = [{at: this.now(), issues: [availability.reason], status: 'not-admitted'}]
        })
        return {kind: 'observation', receipt: (await this.read()).receipts.find((r) => r.id === receipt.id)!}
      }

      const graph = this.bundles.get(receipt.candidate)
      if (!graph) throw new Error('Captured bundle unavailable')
      const input = selectionText(receipt.input, 1_048_576) as {selection: WorkflowExpectation}
      const value = await this.target.start(graph, request.input as GraphJSON, {
        requestId: request.id,
        selection: {expectation: input.selection, input: receipt.input},
        skills: request.skills,
      })
      const runId = id.parse(this.target.identify(value))
      // Returning a live handle is not a claim about its terminal outcome or quiescence.
      const observed = await this.transaction((state) => {
        const r = state.receipts.find((r) => r.id === receipt.id)!
        r.status = 'observed'
        r.observation = 'Live dispatch returned; inspect existing Run for terminal evidence'
        ;(r.observations ??= []).push({
          at: this.now(),
          issues: ['Live owning handle; later terminal and journal inspection remain separate'],
          runId,
          status: 'matched',
        })
        return r
      })
      return {kind: 'live', receipt: observed, value}
    } catch (error) {
      await this.transaction((state) => {
        const r = state.receipts.find((r) => r.id === receipt.id)!
        r.status = error instanceof RunAdmissionRejectedError ? 'observed' : 'unverified'
        r.observation = String(error).slice(0, 2048)
        ;(r.observations ??= []).push({
          at: this.now(),
          issues: [r.observation],
          status: error instanceof RunAdmissionRejectedError ? 'not-admitted' : 'unverified',
        })
      }).catch(() => {})
      throw error
    }
  }

  private eligible(state: WorkflowScopeState, candidate: string) {
    const c = state.candidates[candidate]
    if (!c || !c.available || !c.evidence.eligible || c.evidence.candidate !== c.manifest.digest)
      throw new Rejected('Candidate evidence unavailable or ineligible')
    return c
  }

  private async read(): Promise<WorkflowScopeState> {
    const state = await this.store.read(this.scope)
    selectionJSON(state, 16_777_216)
    this.validate(state)
    return structuredClone(state)
  }

  private async transaction<R>(update: (state: WorkflowScopeState) => R): Promise<R> {
    if (this.uncertain) throw new Error('Selection store requires exclusive verification')
    try {
      return await this.store.transact(this.scope, (state) => {
        this.validate(state)
        const result = update(state)
        this.validate(state)
        return result
      })
    } catch (error) {
      if (!(error instanceof Rejected)) this.uncertain = true
      throw error
    }
  }

  private validate(state: WorkflowScopeState): void {
    parseWorkflowScope(selectionJSON(state, 16_777_216))
    if (
      state.id !== this.scope ||
      state.revision !== 1 ||
      state.mode !== this.store.mode ||
      state.level !== this.store.level ||
      !Number.isSafeInteger(state.generation) ||
      state.generation < 0 ||
      state.decisions.length !== state.generation
    )
      throw new Error('Invalid workflow store state')
    for (const [key, c] of Object.entries(state.candidates)) {
      const m = parseWorkflowCandidate(selectionJSON(c.manifest))
      const retained = state.evidence[c.evidence.digest]
      if (
        key !== m.id ||
        m.context !== state.context ||
        m.prepared !== state.prepared ||
        m.projector !== state.projector ||
        m.mapping !== state.mapping ||
        !retained ||
        selectionJSON(retained.inspection) !== selectionJSON(c.evidence)
      )
        throw new Error('Invalid retained candidate evidence')
    }

    for (const [key, e] of Object.entries(state.evidence)) {
      if (e.inspection.digest !== key || !e.plan || !e.reports || !e.policy)
        throw new Error('Missing retained evidence provenance')
      const candidate = Object.values(state.candidates).find((c) => c.manifest.digest === e.inspection.candidate)
      if (
        !candidate ||
        selectionJSON(inspectWorkflowCandidate(selectionJSON(candidate.manifest), e.plan, e.reports, e.policy)) !==
          selectionJSON(e.inspection)
      )
        throw new Error('Invalid cached evidence inspection')
    }

    const ids = new Set<string>()
    let active: null | string = null
    for (const [i, d] of state.decisions.entries()) {
      if (
        ids.has(d.id) ||
        d.generation !== i + 1 ||
        d.previous !== active ||
        !state.candidates[d.candidate] ||
        !state.evidence[d.evidence]
      )
        throw new Error('Invalid decision continuity')
      ids.add(d.id)
      active = d.candidate
    }

    if (active !== state.active) throw new Error('Invalid active generation')
    const receipts = new Set<string>()
    const requests = new Set<string>()
    for (const r of state.receipts) {
      const key = selectionJSON([r.session, r.request])
      if (
        requests.has(key) ||
        receipts.has(r.id) ||
        !state.candidates[r.candidate] ||
        r.generation < 1 ||
        r.generation > state.generation ||
        !state.evidence[r.evidence] ||
        state.decisions[r.generation - 1].candidate !== r.candidate ||
        state.sessions[r.session] !== r.storage ||
        !['captured', 'dispatching', 'observed', 'unverified'].includes(r.status)
      )
        throw new Error('Invalid dispatch history')
      requests.add(key)
      receipts.add(r.id)
    }
  }
}
