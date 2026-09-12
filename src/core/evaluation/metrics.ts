// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {EvaluationInspection} from './evidence.js'
import type {EvaluationMetric} from './schema.js'

import {digest} from './json.js'
import {unique} from './plan.js'

export interface EvaluationMeasurement extends EvaluationMetric {
  issues: string[]
}
export interface EvaluationMetricSummary {
  compatible: boolean
  definition: ReturnType<typeof metricDefinition>
  key: string
  measuredSlots: string[]
  planned: number
  samples: number
  sum: null | number
  variant: string
}

export function measurements(inspection: EvaluationInspection): EvaluationMeasurement[] {
  const {metrics} = inspection.attempt
  unique(
    metrics.map((m) => m.id),
    'metric',
  )
  const trusted =
    inspection.evidence.some((e) => e.category === 'measurements' && e.valid) &&
    !inspection.evidence.some((e) => e.category === 'measurements' && !e.valid)
  return metrics.map((metric) => {
    const m = {...metric}
    unique(m.sourceIds, 'measurement source event')
    unique(m.cells, 'measurement accounting cell')
    const issues: string[] = []
    const observed = m.coverage === 'complete' || m.coverage === 'partial'
    if (observed !== (m.value !== undefined)) throw new Error('Only observed measurements carry a value')
    if (m.value !== undefined && ['count', 'token'].includes(m.unit) && !Number.isSafeInteger(m.value))
      throw new Error('Counts require safe integers')
    if (!trusted) issues.push('Measurement provenance is not trusted')
    if (observed && (m.sourceIds.length === 0 || m.cells.length === 0))
      issues.push('Missing source/accounting identity')
    if (m.provenance === 'recovered') issues.push('Recovered placeholders are unavailable')
    if (m.coverage === 'complete' && (!m.completeSource || m.provenance === 'visit-prefix'))
      issues.push('Prefix is not a complete census')
    if (m.provenance === 'live-final' && (!inspection.attempt.runtime?.quiescence || !inspection.attempt.quiescent))
      issues.push('Live counter is not final')
    if (m.unit === 'millisecond' && m.scope === 'dispatch-to-quiescence') {
      if (m.provenance !== 'monotonic' || !m.includesApproval || m.clockEpoch === 'unknown')
        issues.push('Missing monotonic interval/approval coverage')
      if (!inspection.attempt.quiescent && !(m.coverage === 'partial' && m.lowerBound))
        issues.push('Unfinished interval must be a censored lower bound')
    }

    if (
      m.unit === 'currency' &&
      (m.provenance !== 'rate-estimate' ||
        m.currency === 'unknown' ||
        m.rateRevision === 'unknown' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(m.rateDate) ||
        m.modelVersion === 'unknown' ||
        m.rounding !== 'half-up-6-decimals')
    )
      issues.push('Missing cost estimate basis')
    if (issues.length > 0) {
      m.coverage = 'unavailable'
      delete m.value
      m.reason = issues.join('; ')
      m.lowerBound = false
    }

    return {...m, issues}
  })
}

function metricDefinition(m: EvaluationMetric) {
  return {
    cells: [...m.cells].sort(),
    currency: m.currency,
    method: m.method,
    modelVersion: m.modelVersion,
    rateDate: m.rateDate,
    rateRevision: m.rateRevision,
    resource: m.resource,
    rounding: m.rounding,
    scope: m.scope,
    unit: m.unit,
  }
}

export function metricKey(m: EvaluationMetric): string {
  return digest(metricDefinition(m))
}

export function summarizeMetrics(
  rows: {inspection?: EvaluationInspection; measurements: EvaluationMeasurement[]; slot: string; variant: string}[],
  planned: Map<string, number>,
): EvaluationMetricSummary[] {
  const sources = new Map<string, string>()
  const groups = new Map<
    string,
    {
      definition: ReturnType<typeof metricDefinition>
      key: string
      metrics: EvaluationMeasurement[]
      slots: string[]
      variant: string
    }
  >()
  for (const row of rows) {
    // Overlap is retained as separate measurements, never implicitly summed as a "total".
    for (const m of row.measurements) {
      for (const eventId of m.sourceIds) {
        const sourceKey = JSON.stringify([row.variant, m.source, eventId, m.resource])
        const previous = sources.get(sourceKey)
        if (previous !== undefined && previous !== row.slot)
          throw new Error('Source observation belongs to multiple slots')
        sources.set(sourceKey, row.slot)
      }

      const key = metricKey(m)
      const groupId = JSON.stringify([row.variant, key])
      const group = groups.get(groupId) ?? {
        definition: metricDefinition(m),
        key,
        metrics: [],
        slots: [],
        variant: row.variant,
      }
      if (m.coverage === 'complete') {
        if (group.slots.includes(row.slot)) throw new Error('Duplicate complete measurement for a slot')
        group.slots.push(row.slot)
        group.metrics.push(m)
      }

      groups.set(groupId, group)
    }
  }

  return [...groups.values()].map((g) => {
    let sum = 0
    for (const m of g.metrics) {
      const value = m.unit === 'currency' ? Math.round(m.value! * 1_000_000) : m.value!
      if (!Number.isSafeInteger(value) && m.unit === 'currency') throw new Error('Currency precision overflow')
      sum += value
      if (
        !Number.isFinite(sum) ||
        sum > Number.MAX_SAFE_INTEGER ||
        (['count', 'token'].includes(m.unit) && !Number.isSafeInteger(sum))
      )
        throw new Error('Measurement aggregate overflow')
    }

    if (g.metrics[0]?.unit === 'currency') sum /= 1_000_000
    const coverage = digest([...g.slots].sort())
    const compatible =
      rows.every((row) => row.inspection === undefined || row.inspection.comparable) &&
      [...planned.keys()].every((v) => {
        const other = groups.get(JSON.stringify([v, g.key]))
        return other !== undefined && digest([...other.slots].sort()) === coverage && g.slots.length > 0
      })
    return {
      compatible,
      definition: g.definition,
      key: g.key,
      measuredSlots: g.slots,
      planned: planned.get(g.variant)!,
      samples: g.slots.length,
      sum: g.slots.length > 0 ? sum : null,
      variant: g.variant,
    }
  })
}
