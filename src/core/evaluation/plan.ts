// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {EvaluationPlan, EvaluationReport, EvaluationReportPayload} from './schema.js'

import {digest, parseJSON, textBundle} from './json.js'
import {payloadSchema, planSchema} from './schema.js'

export function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
}

export function slotKey(slot: {caseId: string; repetition: number}): string {
  return JSON.stringify([slot.caseId, slot.repetition])
}

export function validatePlan(plan: EvaluationPlan): EvaluationPlan {
  unique(
    plan.cases.map((c) => c.id),
    'case',
  )
  unique(
    plan.variants.map((v) => v.id),
    'variant',
  )
  unique(plan.dimensions, 'comparison dimension')
  if (plan.variants.reduce((n, v) => n + v.slots.length, 0) > 1000) throw new Error('Too many planned slots')
  for (const c of plan.cases) {
    unique(
      c.checks.map((check) => check.id),
      'required check',
    )
    unique(
      c.evidence.map((e) => e.category),
      'evidence requirement',
    )
    unique(c.permittedOutcomes, 'permitted outcome')
    unique(c.refusalNotApplicable, 'refusal applicability')
    for (const e of c.evidence) {
      unique(e.stages, 'evidence stage')
      unique(
        e.verifiers.map((v) => JSON.stringify(v)),
        'verifier',
      )
      if ((!e.core && e.verifiers.length === 0) || (e.core && !['journal', 'transcript'].includes(e.category)))
        throw new Error('Evidence requires an applicable inspector')
    }

    for (const stage of ['admitted', 'refused', 'not-run'] as const) {
      const minimum =
        stage === 'not-run'
          ? ['admission']
          : [
              'admission',
              'quiescence',
              'artifact',
              'grading',
              'isolation',
              ...(stage === 'admitted' ? ['terminal', 'configuration'] : []),
            ]
      for (const category of minimum) {
        if (!c.evidence.some((e) => e.category === category && e.stages.includes(stage)))
          throw new Error(`Missing mandatory ${stage} ${category} policy`)
      }
    }

    if ((c.recording.mode === 'memory') !== (c.recording.level === 'memory'))
      throw new Error('Inconsistent recording policy')
  }

  const baseline = plan.variants[0]
  for (const v of plan.variants) {
    unique(
      v.slots.map((slot) => slotKey(slot)),
      'planned slot',
    )
    if (digest(v.slots) !== digest(baseline.slots)) throw new Error('Variants require identical ordered schedules')
    for (const s of v.slots) if (!plan.cases.some((c) => c.id === s.caseId)) throw new Error('Unknown planned case')
    for (const key of Object.keys(v.configuration) as (keyof typeof v.configuration)[]) {
      if (!plan.dimensions.includes(key) && v.configuration[key] !== baseline.configuration[key])
        throw new Error(`Undeclared plan difference: ${key}`)
    }
  }

  return plan
}

export function validateEvaluationPlan(planText: string): {digest: string; plan: EvaluationPlan} {
  textBundle([planText])
  const plan = validatePlan(planSchema.parse(parseJSON(planText)))
  return {digest: digest(plan), plan}
}

/** A producer may use stricter policy; readers always use the immutable revision ceiling. */
export function sealEvaluationReport(payloadText: string): EvaluationReport {
  textBundle([payloadText])
  const payload: EvaluationReportPayload = payloadSchema.parse(parseJSON(payloadText))
  return {...payload, digest: digest(payload)}
}
