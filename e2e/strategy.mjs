// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const strategyVersion = 'coding-recovery-v1'

export function evaluationPrompt(task, {strategy = strategyVersion, swe = false} = {}) {
  if (strategy === 'baseline') return task
  if (strategy !== strategyVersion) throw new Error(`Unknown evaluation strategy: ${strategy}`)
  const environment = swe
    ? 'Use python3, not python. pytest and mpmath are installed. This is a source snapshot without .git history; do not look for Git metadata or run Git history commands.'
    : 'Node.js and Bash are installed. Use node to run JavaScript. This fixture has no Git history.'
  return `${task}\n\nWorking procedure:\n- Work in /workspace. ${environment}\n- Read the relevant code before editing. Use focused searches and bounded reads instead of dumping entire large files.\n- If an exact-text edit fails, re-read the affected file and rebuild the edit from the current exact text, including quotes and whitespace. Do not repeat the unchanged failed operation. Check the resulting file after editing.\n- Follow any requested test-before-edit order. Reproduce the reported behavior, implement a minimal fix, and run focused tests for the changed behavior plus closely related regression tests. Preserve the exit status of test commands; do not hide it with a pipe to tail or a trailing echo.\n- Once those checks pass, summarize the changed files and actual test results and finish. Expand testing only to investigate a concrete failure or an affected dependency; do not keep adding unrelated tests. If blocked, report the blocker and stop rather than repeating the same attempt.\n- Do not claim that independent or hidden evaluation tests passed; they are run separately by the host.\n`
}

export function readRounds(value, fallback) {
  const rounds = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100)
    throw new Error('Evaluation rounds must be an integer from 1 to 100')
  return rounds
}

// Completed response timings are partial evidence when inference is interrupted.
export function summarizeEvents(events) {
  const result = {
    modelCallsCompleted: 0,
    modelCallsStarted: 0,
    modelWallMs: 0,
    ollamaEvalMs: 0,
    ollamaLoadMs: 0,
    ollamaPromptMs: 0,
    ollamaTotalMs: 0,
    repeatedFailedCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolWallMs: 0,
  }
  const failed = new Set()
  for (const event of events) {
    const data = event.data ?? {}
    if (event.type === 'model.request.started') result.modelCallsStarted++
    if (event.type === 'model.response.completed') {
      result.modelCallsCompleted++
      result.modelWallMs += data.durationMs ?? 0
      const timing = data.providerMetadata ?? {}
      for (const [field, name] of [
        ['ollamaTotalMs', 'totalDurationNs'],
        ['ollamaLoadMs', 'loadDurationNs'],
        ['ollamaPromptMs', 'promptEvalDurationNs'],
        ['ollamaEvalMs', 'evalDurationNs'],
      ])
        result[field] += (timing[name] ?? 0) / 1e6
    }

    if (event.type === 'tool.completed') {
      result.toolCalls++
      result.toolWallMs += data.durationMs ?? 0
      if (data.isError) {
        result.toolErrors++
        const key = JSON.stringify([data.name, data.input])
        if (failed.has(key)) result.repeatedFailedCalls++
        failed.add(key)
      }
    }
  }

  return result
}
