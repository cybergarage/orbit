// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'

import {recoveryObserved} from './cases.mjs'
import {gradeCase, normalizePatch} from './grading.mjs'
import {command} from './host.mjs'

const entry = (exitCode) => ({
  message: {
    payload: {
      input: {command: 'node test.cjs'},
      isError: exitCode !== 0,
      name: 'bash',
      output: {details: {exitCode, stdout: exitCode === 0 ? 'PASS' : ''}},
    },
    type: 'tool',
  },
  type: 'message',
})
describe('E2E host control (no model or Docker)', () => {
  it('separates a runtime failure from a host deadline', async () => {
    const failed = {result: {runtime: {outcome: 'failed', quiescence: true}}}
    expect((await gradeCase('/unused', {}, failed)).status).to.equal('runtime-error')
    expect((await gradeCase('/unused', {}, {...failed, status: 'timeout'})).status).to.equal('timeout')
  })

  it('normalizes patch headers without rewriting source contents', () => {
    const patch =
      'diff --git a/initial/x b/workspace/x\n--- a/initial/x\n+++ b/workspace/x\n+literal a/initial/ and b/workspace/\n'
    expect(normalizePatch(patch)).to.equal(
      'diff --git a/x b/x\n--- a/x\n+++ b/x\n+literal a/initial/ and b/workspace/\n',
    )
  })

  it('requires an observed failed test before a successful rerun', () => {
    expect(recoveryObserved([entry(1), entry(0)])).to.equal(true)
    expect(recoveryObserved([entry(0), entry(1)])).to.equal(false)
    expect(recoveryObserved([entry(0)])).to.equal(false)
    expect(recoveryObserved([entry(null), entry(0)])).to.equal(false)
  })

  it('recognizes a failed test even when a later echo masks the shell exit code', () => {
    const failed = entry(0)
    failed.message.payload.output.details.stderr = 'TypeError: Reduce of empty array with no initial value'
    failed.message.payload.output.details.stdout = 'EXIT CODE: 1'
    expect(recoveryObserved([failed, entry(0)])).to.equal(true)
    expect(recoveryObserved([failed])).to.equal(false)
  })

  it('distinguishes timeout from an ordinary process failure', async () => {
    const timeout = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      allowFailure: true,
      timeoutMs: 100,
    })
    expect(timeout.timedOut).to.equal(true)
    const failure = await command(process.execPath, ['-e', 'process.exit(1)'], {allowFailure: true})
    expect(failure.timedOut).to.equal(false)
    expect(failure.code).to.equal(1)
  })
})
