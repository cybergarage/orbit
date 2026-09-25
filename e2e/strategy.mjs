// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const strategyVersion = 'coding-recovery-v1'

export function evaluationPrompt(task, {strategy = strategyVersion, swe = false} = {}) {
  if (strategy === 'baseline') return task
  if (['verified-focused-v1', 'verified-tests-v1'].includes(strategy)) {
    if (!swe) throw new Error('Verified strategies require a SWE repository')
    const testing =
      '\n\nEvaluation environment:\n- Work in /workspace. This is a source snapshot without Git history. python3 uses the prepared repository source and dependencies.\n- Run focused public tests with orbit-test --timeout 120 --tail 12000 -- <test argv>. It preserves exit status and saves full logs outside the patch. Use python3 -m pytest -p no:cacheprovider <existing-test-path> -q for pytest/Sphinx; use python3 tests/runtests.py <existing-test-module> --settings=test_sqlite --parallel=1 for Django. Inspect actual paths before choosing a test.\n- Check ORBIT_TEST_RESULT: a nonzero exit code is a failure even if some tests passed. Do not pipe tests through tail, ignore failures, or leave generated caches in the patch. Check any tests you add.\n'
    const stopping =
      '\nCompletion criteria:\n- After implementing the minimal fix, run a focused regression for the reported behavior and the affected existing test module. When those checks pass, summarize the actual changes and test results and finish.\n- Expand testing only for a concrete observed failure related to the change. Do not guess unrelated test names or expand to the whole repository after relevant checks pass. If a failure persists, report it accurately instead of claiming success.\n- Official hidden tests run later; do not attempt to access them or claim they passed.\n'
    return task + testing + (strategy === 'verified-focused-v1' ? stopping : '')
  }

  if (strategy !== strategyVersion) throw new Error(`Unknown evaluation strategy: ${strategy}`)
  const environment = swe
    ? 'Use python3, not python. pytest and mpmath are installed. This is a source snapshot without .git history; do not look for Git metadata or run Git history commands.'
    : 'Node.js and Bash are installed. Use node to run JavaScript. This fixture has no Git history.'
  return `${task}\n\nWorking procedure:\n- Work in /workspace. ${environment}\n- Read the relevant code before editing. Use focused searches and bounded reads instead of dumping entire large files.\n- If an exact-text edit fails, re-read the affected file and rebuild the edit from the current exact text, including quotes and whitespace. Do not repeat the unchanged failed operation. Check the resulting file after editing.\n- Follow any requested test-before-edit order. Reproduce the reported behavior, implement a minimal fix, and run focused tests for the changed behavior plus closely related regression tests. Preserve the exit status of test commands; do not hide it with a pipe to tail or a trailing echo.\n- Once those checks pass, summarize the changed files and actual test results and finish. Expand testing only to investigate a concrete failure or an affected dependency; do not keep adding unrelated tests. If blocked, report the blocker and stop rather than repeating the same attempt.\n- Do not claim that independent or hidden evaluation tests passed; they are run separately by the host.\n`
}

export function readRounds(value, fallback) {
  if ((value ?? fallback) === 'unlimited') return 'unlimited'
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

export function readElapsed(value, fallback) {
  if ((value ?? fallback) === 'unlimited') return 'unlimited'
  const elapsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(elapsed) || elapsed < 1 || elapsed > 2_147_453_647)
    throw new Error('Evaluation elapsed time must be a positive integer within the timer range or unlimited')
  return elapsed
}
