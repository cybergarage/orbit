// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

import type {CompiledProcessorGraph} from '../processor/graph-definition.js'

import {compareEvaluationReports} from '../evaluation/comparison.js'
import {digest, parseJSON} from '../evaluation/json.js'
import {validateEvaluationPlan} from '../evaluation/plan.js'
import {canonicalJSON} from '../execution/journal.js'

export const SELECTION_FORMAT_LIMITS = Object.freeze({
  depth: 32,
  metadataBytes: 65_536,
  submissionBytes: 1_048_576,
  values: 200_000,
})
export const DEFAULT_SELECTION_LIMITS = Object.freeze({bytes: 16_777_216, candidates: 64, receipts: 1000})
export function selectionText(text: unknown, limit: number = SELECTION_FORMAT_LIMITS.metadataBytes): unknown {
  if (typeof text !== 'string' || text.length > limit || Buffer.byteLength(text) > limit)
    throw new Error('Selection text exceeds limit')
  return parseJSON(text, undefined, true)
}

export function selectionJSON(value: unknown, limit: number = SELECTION_FORMAT_LIMITS.metadataBytes): string {
  // Reject object accessors/prototypes before serializing trusted host data as well.
  let values = 0
  const check = (v: unknown, depth: number): void => {
    if (++values > 200_000 || depth > 32) throw new Error('Selection JSON exceeds structural limit')
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return
    if (typeof v === 'number' && Number.isFinite(v)) return
    if (typeof v !== 'object') throw new Error('Selection requires finite JSON')
    if (
      Array.isArray(v) &&
      (Object.getPrototypeOf(v) !== Array.prototype ||
        Reflect.ownKeys(v).length !== v.length + 1 ||
        !Array.from({length: v.length}, (_, i) => Object.hasOwn(v, i)).every(Boolean))
    )
      throw new Error('Selection requires dense JSON arrays')
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      throw new Error('Selection requires plain JSON')
    for (const k of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && k === 'length') continue
      const p = Object.getOwnPropertyDescriptor(v, k)!
      if (typeof k !== 'string' || !('value' in p) || !p.enumerable) throw new Error('Selection rejects accessors')
      check(p.value, depth + 1)
    }
  }

  check(value, 0)
  const text = canonicalJSON(value)
  selectionText(text, limit)
  return text
}

export const selectionDigest = (value: unknown): string =>
  digest(
    selectionText(
      selectionJSON(value, SELECTION_FORMAT_LIMITS.submissionBytes),
      SELECTION_FORMAT_LIMITS.submissionBytes,
    ),
  )
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) immutable(v)
    Object.freeze(value)
  }

  return value
}

const id = z.string().min(1).max(2048)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const manifestSchema = z
  .object({
    adapters: z.array(z.object({id, version: id}).strict()).max(64),
    bundle: id,
    configuration: hash,
    context: hash,
    digest: hash,
    graph: hash,
    id,
    label: id,
    mapping: id,
    prepared: hash,
    profile: hash,
    projector: id,
    revision: z.literal(1),
  })
  .strict()
export type WorkflowCandidate = z.infer<typeof manifestSchema>
export function parseWorkflowCandidate(text: string): WorkflowCandidate {
  const m = manifestSchema.parse(selectionText(text))
  const {digest: claimed, ...payload} = m
  if (digest(payload) !== claimed) throw new Error('Candidate digest mismatch')
  if (new Set(m.adapters.map((a) => a.id)).size !== m.adapters.length) throw new Error('Duplicate adapter')
  return immutable(m)
}

export function sealWorkflowCandidate(payload: Omit<WorkflowCandidate, 'digest'>): string {
  const clean = selectionText(selectionJSON(payload)) as Omit<WorkflowCandidate, 'digest'>
  const text = selectionJSON({...clean, digest: digest(clean)})
  parseWorkflowCandidate(text)
  return text
}

export function verifyWorkflowGraph(candidate: WorkflowCandidate, graph: CompiledProcessorGraph): void {
  const adapters = [
    ...new Map(graph.descriptor.nodes.map((n) => [n.adapter, {id: n.adapter, version: n.version}])).values(),
  ]
  if (
    candidate.graph !== graph.identity ||
    candidate.profile !== selectionDigest(graph.profile) ||
    candidate.configuration !== selectionDigest(graph.configuration) ||
    canonicalJSON(candidate.adapters) !== canonicalJSON(adapters)
  )
    throw new Error('Candidate executable binding mismatch')
}

export const policySchema = z
  .object({
    configuration: z.record(z.string(), z.string()),
    id,
    mapping: id,
    metrics: z.array(z.object({key: hash, maximum: z.number().finite().nonnegative()}).strict()).max(64),
    plan: hash,
    revision: z.literal(1),
    variant: id,
    version: id,
  })
  .strict()
export type WorkflowEligibility = {
  candidate: string
  digest: string
  eligible: boolean
  issues: string[]
  missingOptional: string[]
  plan: string
  policy: string
}
export function inspectWorkflowCandidate(
  candidateText: string,
  planText: string,
  reportsText: string,
  policyText: string,
): WorkflowEligibility {
  const c = parseWorkflowCandidate(candidateText)
  const policy = policySchema.parse(selectionText(policyText))
  const comparison = compareEvaluationReports(planText, reportsText)
  const {plan} = validateEvaluationPlan(planText)
  const variant = plan.variants.find((v) => v.id === policy.variant)
  const issues: string[] = []
  if (
    policy.plan !== comparison.planDigest ||
    policy.mapping !== c.mapping ||
    !variant ||
    canonicalJSON(policy.configuration) !== canonicalJSON(variant.configuration)
  )
    issues.push('Plan/configuration mapping mismatch')
  if (
    policy.configuration.graph !== c.graph ||
    policy.configuration.privateConfiguration !== c.configuration ||
    policy.configuration.adapter !== selectionDigest(c.adapters) ||
    policy.configuration.mappingMethod !== c.mapping ||
    policy.configuration.environment !== c.context ||
    policy.configuration.catalog !== c.prepared ||
    policy.configuration.limits !== c.profile ||
    policy.configuration.application !== c.projector
  )
    issues.push('Candidate evaluation identity mismatch')
  const rows = comparison.rows.filter((row) => row.variant === policy.variant)
  if (rows.length === 0 || rows.some((row) => row.disposition !== 'pass' || row.inspection?.comparable !== true))
    issues.push('Every planned slot requires comparable passing evidence')
  const expected = rows.map((row) => row.slot).sort()
  if (new Set(policy.metrics.map((m) => m.key)).size !== policy.metrics.length)
    throw new Error('Duplicate required resource')
  for (const required of policy.metrics) {
    const m = comparison.metrics.find((m) => m.variant === policy.variant && m.key === required.key)
    if (
      !m ||
      !m.compatible ||
      canonicalJSON([...m.measuredSlots].sort()) !== canonicalJSON(expected) ||
      m.sum === null ||
      m.sum > required.maximum
    )
      issues.push('Required resource unavailable or exceeds limit: ' + required.key)
  }

  const missingOptional = rows.flatMap((row) =>
    row.measurements.filter((m) => m.coverage !== 'complete').map((m) => row.slot + ':' + m.resource),
  )
  return immutable({
    candidate: c.digest,
    digest: selectionDigest({
      candidate: c.digest,
      plan: comparison.planDigest,
      policy,
      reports: comparison.reports.map((r) => ({digest: r.digest, id: r.id})),
      selected: (selectionText(reportsText, 16_777_216) as {selected: unknown}).selected,
    }),
    eligible: issues.length === 0,
    issues,
    missingOptional,
    plan: comparison.planDigest,
    policy: selectionDigest(policy),
  })
}
