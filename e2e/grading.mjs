// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises'
import path from 'node:path'

import {recoveryObserved} from './cases.mjs'
import {gradeWorkspace} from './host.mjs'

export function normalizePatch(patch) {
  return patch
    .split('\n')
    .map((line) => {
      if (!/^(diff --git |--- |\+\+\+ |Binary files )/.test(line)) return line
      return line
        .replaceAll('a/initial/', 'a/')
        .replaceAll('b/workspace/', 'b/')
        .replaceAll('a/workspace/', 'a/')
        .replaceAll('b/initial/', 'b/')
    })
    .join('\n')
}

export async function gradeCase(directory, c, run) {
  const runtimeOutcome = run.result?.runtime?.outcome
  const infrastructureError = ['environment-error', 'timeout'].includes(run.status)
  if (
    infrastructureError ||
    run.error ||
    run.result?.error ||
    run.result?.closeError ||
    !run.result?.runtime?.quiescence ||
    !['budget-exceeded', 'completed'].includes(runtimeOutcome)
  ) {
    return {
      passed: false,
      reason:
        run.error ??
        run.result?.error ??
        run.result?.closeError ??
        (infrastructureError
          ? 'Host deadline or environment failure'
          : `Runtime did not complete cleanly: ${runtimeOutcome ?? 'missing'}`),
      status: infrastructureError ? run.status : 'runtime-error',
    }
  }

  let grade
  let passed = false
  try {
    if (c.expectedAnswer) {
      const names = await fs.readdir(path.join(directory, 'workspace'))
      passed = (run.result.answer ?? '').includes(c.expectedAnswer) && names.length === Object.keys(c.files).length
      for (const [name, text] of Object.entries(c.files)) passed &&= (await regularText(directory, name)) === text
    } else {
      grade = await gradeWorkspace(directory, c.grader)
      if (grade.timedOut || grade.code === 125)
        return {grade, passed: false, reason: 'Grader failed to execute or timed out', status: 'grading-error'}
      passed = grade.code === 0 && grade.markerObserved
      for (const name of c.protectedFiles ?? []) passed &&= (await regularText(directory, name)) === c.files[name]
      if (c.recovery) passed &&= recoveryObserved(run.result.entries)
    }
  } catch (error) {
    return {grade, passed: false, reason: String(error), status: 'unresolved'}
  }

  return {
    grade,
    passed,
    reason:
      runtimeOutcome === 'completed'
        ? passed
          ? 'Independent checks passed'
          : 'Independent checks failed'
        : `Runtime outcome: ${runtimeOutcome}`,
    runtimeOutcome,
    status: passed && runtimeOutcome === 'completed' ? 'resolved' : 'unresolved',
  }
}

async function regularText(directory, name) {
  const file = path.join(directory, 'workspace', name)
  if (!(await fs.lstat(file)).isFile()) throw new Error(`Expected regular file: ${name}`)
  return fs.readFile(file, 'utf8')
}
