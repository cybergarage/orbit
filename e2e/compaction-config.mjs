// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// All arms use the same worker budget and action mode unless explicitly named otherwise.
export const compactionArms = Object.freeze({
  eocc: {algorithm: 'handoff-summary-v1', mode: 'budgeted', strategy: 'eocc-v1'},
  'eocc-structured': {algorithm: 'structured-summary-v1', mode: 'budgeted', strategy: 'eocc-v1'},
  fha: {mode: 'disabled'},
  sac: {algorithm: 'handoff-summary-v1', mode: 'budgeted', strategy: 'sac-v1'},
  'sac-structured': {algorithm: 'structured-summary-v1', mode: 'budgeted', strategy: 'sac-v1'},
  suffix: {algorithm: 'structured-summary-v1', mode: 'budgeted', strategy: 'budgeted-suffix-v1'},
  'suffix-handoff': {algorithm: 'handoff-summary-v1', mode: 'budgeted', strategy: 'budgeted-suffix-v1'},
})

export function experimentPolicy({
  arm,
  model,
  outputReserve = 2048,
  provider = 'ollama',
  target = 8192,
  trigger = 12_288,
  window = 16_384,
}) {
  if (!Object.hasOwn(compactionArms, arm)) throw new Error('Unknown compaction experiment arm')
  const counts = [window, trigger, target, outputReserve]
  if (
    counts.some((n) => !Number.isSafeInteger(n) || n < 1) ||
    !(target < trigger && trigger <= window - outputReserve - 256)
  )
    throw new Error('Invalid compaction experiment budgets')
  const selection = compactionArms[arm]
  return selection.mode === 'disabled'
    ? {...selection}
    : {
        ...selection,
        profile: {
          model,
          outputReserve,
          provider,
          revision: 'compaction-experiment-v1',
          safetyMargin: 256,
          summaryOutput: outputReserve,
          target,
          templateOverhead: 0,
          trigger,
          window,
        },
      }
}

/** Completed provider calls include worker and summary calls; missing usage stays unknown. */
export function compactionMetrics(events) {
  const started = events.filter((e) => e.type === 'model.request.started').length
  const completed = events.filter((e) => e.type === 'model.response.completed')
  const usage = completed.map((e) => e.data?.usage)
  const known = usage.filter((u) => Number.isSafeInteger(u?.inputTokens) && Number.isSafeInteger(u?.outputTokens))
  return {
    billedCostUSD: null,
    cacheTokens: null,
    compactions: events.filter((e) => e.type === 'context.compaction.completed').length,
    inputTokens: known.reduce((n, u) => n + u.inputTokens, 0),
    modelCallsCompleted: completed.length,
    modelCallsStarted: started,
    outputTokens: known.reduce((n, u) => n + u.outputTokens, 0),
    peakInputTokens: known.length > 0 ? Math.max(...known.map((u) => u.inputTokens)) : null,
    summaryAttempts: events.filter((e) => e.type === 'context.summary.started').length,
    summaryFailures: events.filter((e) => e.type === 'context.summary.failed').length,
    usageComplete: started === completed.length && known.length === completed.length,
  }
}
