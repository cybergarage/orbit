// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {RunLimits} from '../../core/execution/limits.js'
import type {RunSnapshot} from '../../core/execution/run.js'

import {parseBudgetReason} from '../../core/execution/limits.js'

const labels = {
  elapsedMs: 'Time limit (minutes)',
  modelCalls: 'Model calls',
  toolRequests: 'Tool requests',
  toolRounds: 'Tool rounds',
} as const

export function canContinueBudget(snapshot?: RunSnapshot): boolean {
  const result = snapshot?.result
  return (
    result?.outcome === 'budget-exceeded' &&
    result.quiescence &&
    result.recording.status !== 'failed' &&
    result.unresolved.length === 0 &&
    result.cleanupErrors.length === 0 &&
    !snapshot?.quarantined
  )
}

export function budgetStatus(snapshot: RunSnapshot): string {
  const detail = parseBudgetReason(snapshot.result?.reason ?? '')
  if (!detail) return 'Orbit stopped because a run limit was reached.'
  const name = labels[detail.limitName as keyof typeof labels] ?? detail.limitName
  return detail.limitName === 'elapsedMs'
    ? `Orbit reached the time limit of ${detail.limit / 60_000} minutes.`
    : `Orbit reached the ${name.toLowerCase()} limit: ${detail.consumed} used, ${detail.limit} allowed; the next step needs ${detail.requested}.`
}

export function BudgetPanel({
  active,
  limits,
  onChange,
  onContinue,
  snapshot,
}: {
  active: boolean
  limits: RunLimits
  onChange: (key: keyof RunLimits, value: number) => void
  onContinue: () => void
  snapshot?: RunSnapshot
}) {
  const stopped = snapshot?.result?.outcome === 'budget-exceeded'
  return (
    <section aria-label="Run limits" className="run-budget">
      {stopped && (
        <div role="status">
          <p>{budgetStatus(snapshot!)}</p>
          <p>
            {canContinueBudget(snapshot)
              ? 'Your conversation is saved. Continue starts a new run with the limits below; it does not replay the stopped tool call. Add guidance in the message box if needed.'
              : 'Continuation is unavailable because work or recording needs recovery. Keep this conversation and inspect its logs before starting a new chat.'}
          </p>
        </div>
      )}
      <details open={stopped || undefined}>
        <summary>Limits for the next run</summary>
        {Object.entries(labels).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              disabled={active}
              min={key === 'elapsedMs' ? 1 : 0}
              onChange={(event) =>
                onChange(
                  key as keyof RunLimits,
                  event.target.value === ''
                    ? Number.NaN
                    : Number(event.target.value) * (key === 'elapsedMs' ? 60_000 : 1),
                )
              }
              step={1}
              type="number"
              value={
                Number.isFinite(limits[key as keyof RunLimits])
                  ? limits[key as keyof RunLimits] / (key === 'elapsedMs' ? 60_000 : 1)
                  : ''
              }
            />
          </label>
        ))}
      </details>
      {stopped && (
        <button disabled={active || !canContinueBudget(snapshot)} onClick={onContinue}>
          Continue with these limits
        </button>
      )}
    </section>
  )
}
