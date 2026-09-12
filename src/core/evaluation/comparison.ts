// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {EvaluationDisposition, EvaluationInspection} from './evidence.js'
import type {EvaluationMeasurement, EvaluationMetricSummary} from './metrics.js'
import type {EvaluationReport} from './schema.js'

import {inspectAttempt} from './evidence.js'
import {digest, parseJSON, textBundle} from './json.js'
import {measurements, summarizeMetrics} from './metrics.js'
import {slotKey, unique, validatePlan} from './plan.js'
import {importsSchema, planSchema} from './schema.js'

export interface EvaluationRow {
  disposition: EvaluationDisposition
  inspection?: EvaluationInspection
  measurements: EvaluationMeasurement[]
  slot: string
  variant: string
}
export interface EvaluationVariantSummary {
  comparable: boolean
  counts: Record<EvaluationDisposition, number>
  evidence: {hostTrusted: number; incomplete: number; rawInspected: number}
  passes: number
  planned: number
  runtime: Record<string, number>
  variant: string
}
export interface EvaluationComparison {
  metrics: EvaluationMetricSummary[]
  planDigest: string
  reports: EvaluationReport[]
  rows: EvaluationRow[]
  variants: EvaluationVariantSummary[]
}

export function compareEvaluationReports(planText: string, importsText: string): EvaluationComparison {
  textBundle([planText, importsText])
  const budget = {values: 0}
  const plan = validatePlan(planSchema.parse(parseJSON(planText, budget)))
  const input = importsSchema.parse(parseJSON(importsText, budget))
  const fingerprint = digest(plan)
  const reports = new Map<string, EvaluationReport>()
  for (const report of input.reports) {
    const {digest: claimed, ...payload} = report
    if (digest(payload) !== claimed || report.planDigest !== fingerprint) throw new Error('Report digest/plan mismatch')
    const existing = reports.get(report.id)
    if (existing && existing.digest !== report.digest) throw new Error('Conflicting report ID')
    reports.set(report.id, report)
  }

  const assignments = new Map<string, string>()
  const immutable = new Map<string, string>()
  const namespaces = new Map<string, string>()
  const physical = new Map<string, string>()
  const bind = (key: unknown, slot: string) => {
    const encoded = JSON.stringify(key)
    const previous = assignments.get(encoded)
    if (previous && previous !== slot) throw new Error('Trial identity is assigned to multiple slots')
    assignments.set(encoded, slot)
  }

  for (const report of reports.values()) {
    const variant = plan.variants.find((v) => v.id === report.variant)
    if (!variant) throw new Error('Unknown report variant')
    unique(
      report.attempts.map((slot) => slotKey(slot)),
      'attempt slot',
    )
    unique(
      report.attempts.map((a) => a.id),
      'attempt ID',
    )
    const ancestors = new Set<string>([report.id])
    let {predecessor} = report
    while (predecessor !== null) {
      const old = reports.get(predecessor)
      if (!old || old.variant !== report.variant || ancestors.has(predecessor))
        throw new Error('Invalid report revision history')
      ancestors.add(predecessor)
      predecessor = old.predecessor
    }

    for (const a of report.attempts) {
      const slot = JSON.stringify([report.variant, slotKey(a)])
      if (!variant.slots.some((s) => slotKey(s) === slotKey(a))) throw new Error('Attempt outside plan')
      bind(['attempt', a.id], slot)
      if (a.identity) {
        const {namespace, requestId, runId, sessionId, storageIdentity} = a.identity
        if (
          (namespaces.has(namespace) && namespaces.get(namespace) !== storageIdentity) ||
          (physical.has(storageIdentity) && physical.get(storageIdentity) !== namespace)
        )
          throw new Error('Conflicting storage namespace mapping')
        namespaces.set(namespace, storageIdentity)
        physical.set(storageIdentity, namespace)
        bind(['run', namespace, sessionId, runId], slot)
        bind(['request', namespace, sessionId, requestId], slot)
        bind(['storage', namespace, sessionId], slot)
      }

      // A correction may add settlement/artifact/grade evidence, never substitute another trial.
      const permanent = digest({
        configuration: a.configuration,
        id: a.id,
        identity: a.identity,
        runtime: a.runtime,
        stage: a.stage,
      })
      const before = immutable.get(slot)
      if (before && before !== permanent) throw new Error('Revision substitutes original trial or terminal')
      immutable.set(slot, permanent)
      if (report.predecessor) {
        const old = reports.get(report.predecessor)!.attempts.find((item) => slotKey(item) === slotKey(a))
        if (old && old.id !== a.id) throw new Error('Revision changes attempt identity')
      }
    }

    if (
      report.predecessor &&
      reports.get(report.predecessor)!.attempts.some((a) => !report.attempts.some((b) => slotKey(a) === slotKey(b)))
    )
      throw new Error('Correction removes an observed trial')
  }

  const selected = [...new Set(input.selected)].map((id) => {
    const report = reports.get(id)
    if (!report) throw new Error('Unknown selected report')
    return report
  })
  unique(
    selected.map((r) => r.variant),
    'selected variant revision',
  )
  // Independent roots claiming the same slot are not revisions, even with identical Run IDs.
  for (const report of reports.values()) {
    if (
      report.predecessor === null &&
      [...reports.values()].some((r) => r.id !== report.id && r.variant === report.variant && r.predecessor === null)
    )
      throw new Error('Multiple report roots for a variant')
  }

  const rows: EvaluationRow[] = []
  for (const variant of plan.variants) {
    const report = selected.find((r) => r.variant === variant.id)
    for (const slot of variant.slots) {
      const attempt = report?.attempts.find((a) => slotKey(a) === slotKey(slot))
      if (attempt) {
        const inspection = inspectAttempt(plan, variant.id, attempt, budget)
        rows.push({
          disposition: inspection.disposition,
          inspection,
          measurements: measurements(inspection),
          slot: slotKey(slot),
          variant: variant.id,
        })
      } else rows.push({disposition: 'missing', measurements: [], slot: slotKey(slot), variant: variant.id})
    }
  }

  const variants = plan.variants.map((variant): EvaluationVariantSummary => {
    const group = rows.filter((r) => r.variant === variant.id)
    const counts = {fail: 0, indeterminate: 0, missing: 0, 'not-run': 0, pass: 0}
    const runtime: Record<string, number> = Object.create(null) as Record<string, number>
    const evidence = {hostTrusted: 0, incomplete: 0, rawInspected: 0}
    for (const row of group) {
      counts[row.disposition]++
      const observed = row.inspection?.runtime ?? 'dispatch-unknown'
      runtime[observed] = (runtime[observed] ?? 0) + 1
      if (row.inspection?.evidence.some((e) => e.kind === 'host' && e.valid)) evidence.hostTrusted++
      if (row.inspection?.evidence.some((e) => e.kind === 'core' && e.valid)) evidence.rawInspected++
      if (!row.inspection || row.inspection.issues.length > 0) evidence.incomplete++
    }

    return {
      comparable: group.every((r) => r.inspection?.comparable === true),
      counts,
      evidence,
      passes: counts.pass,
      planned: group.length,
      runtime,
      variant: variant.id,
    }
  })
  return {
    metrics: summarizeMetrics(rows, new Map(plan.variants.map((v) => [v.id, v.slots.length]))),
    planDigest: fingerprint,
    reports: [...reports.values()],
    rows,
    variants,
  }
}
