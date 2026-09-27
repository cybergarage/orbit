// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {recoveryObserved} from './cases.mjs'
import {excludeGeneratedPatch, gradeCase, normalizePatch} from './grading.mjs'
import {command} from './host.mjs'
import {checkDeliverable, inspectDeliverable, testCommand} from './quality.mjs'
import {prepareRepositorySource, repositoryProfile} from './repository-checks.mjs'
import {sourceFingerprint} from './source-fingerprint.mjs'
import {evaluationPrompt, readElapsed, readRounds, summarizeEvents} from './strategy.mjs'
import {validateSWECase, verifyPreparedSWECase} from './swe-case.mjs'

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
  it('changes the agent source fingerprint when the source changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-fingerprint-'))
    try {
      for (const file of [
        'bin/build-gui.mjs',
        'e2e/source-fingerprint.mjs',
        'e2e/worker.mjs',
        'package-lock.json',
        'package.json',
        'src/core/agent.ts',
        'tsconfig.json',
      ]) {
        await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true})
        await fs.writeFile(path.join(root, file), 'initial')
      }

      const before = await sourceFingerprint(root)
      await fs.writeFile(path.join(root, 'src/core/agent.ts'), 'changed')
      expect(await sourceFingerprint(root)).not.to.equal(before)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('rejects invalid budgets rather than disabling the limit', () => {
    expect(readRounds(undefined, 30)).to.equal(30)
    expect(readRounds('50', 30)).to.equal(50)
    expect(readRounds('101', 30, Number.MAX_SAFE_INTEGER)).to.equal(101)
    expect(readRounds('unlimited', 30)).to.equal('unlimited')
    expect(readRounds(undefined, 'unlimited')).to.equal('unlimited')
    expect(readRounds(undefined, 'unlimited', Number.MAX_SAFE_INTEGER)).to.equal('unlimited')
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '', '101'])
      expect(() => readRounds(value, 30)).to.throw('Evaluation rounds')
  })

  it('validates elapsed overrides and runs unlimited commands without a timer', async () => {
    expect(readElapsed(undefined, 'unlimited')).to.equal('unlimited')
    expect(readElapsed('900000', 'unlimited')).to.equal(900_000)
    for (const value of ['0', '-1', 'Infinity', 'NaN', '1.5', '', '2147453648'])
      expect(() => readElapsed(value, 'unlimited')).to.throw('Evaluation elapsed')
    const result = await command(process.execPath, ['-e', 'setTimeout(()=>{},50)'], {timeoutMs: 'unlimited'})
    expect(result.code).to.equal(0)
    expect(result.timedOut).to.equal(false)
    expect(result.timeoutMs).to.equal('unlimited')
  })

  it('preserves baseline instructions and refuses unknown strategies', () => {
    expect(evaluationPrompt('Read only.', {strategy: 'baseline'})).to.equal('Read only.')
    expect(() => evaluationPrompt('Read only.', {strategy: 'typo'})).to.throw('Unknown evaluation strategy')
  })

  it('isolates stopping instructions from the Verified test-runner control', () => {
    const control = evaluationPrompt('Fix issue.', {strategy: 'verified-tests-v1', swe: true})
    const focused = evaluationPrompt('Fix issue.', {strategy: 'verified-focused-v1', swe: true})
    const explicit = evaluationPrompt('Fix issue.', {strategy: 'verified-focused-v2', swe: true})
    expect(focused.startsWith(control)).to.equal(true)
    expect(explicit.startsWith(focused)).to.equal(true)
    expect(explicit).to.include('very next response a final answer with no tool calls')
    expect(control).to.include('orbit-test')
    expect(control).not.to.include('Completion criteria:')
    expect(focused).to.include('Completion criteria:')
    expect(() => evaluationPrompt('Fix issue.', {strategy: 'verified-focused-v1'})).to.throw('require a SWE repository')
  })

  it('counts interrupted requests without inventing response timings', () => {
    const failure = {data: {durationMs: 3, input: {path: 'a'}, isError: true, name: 'edit'}, type: 'tool.completed'}
    const metrics = summarizeEvents([
      {type: 'model.request.started'},
      {type: 'context.compaction.started'},
      {type: 'context.summary.started'},
      {data: {durationMs: 4}, type: 'context.summary.failed'},
      {type: 'context.summary.started'},
      {data: {durationMs: 5}, type: 'context.summary.completed'},
      {type: 'context.compaction.completed'},
      {data: {reason: 'summary-invalid-json'}, type: 'context.compaction.failed'},
      {data: {reason: 'summary-invalid-json'}, type: 'context.compaction.skipped'},
      {data: {durationMs: 7, providerMetadata: {evalDurationNs: 2_000_000}}, type: 'model.response.completed'},
      failure,
      failure,
      {type: 'model.request.started'},
    ])
    expect(metrics.modelCallsStarted).to.equal(2)
    expect(metrics.modelCallsCompleted).to.equal(1)
    expect(metrics.ollamaEvalMs).to.equal(2)
    expect(metrics.modelWallMs).to.equal(7)
    expect(metrics.repeatedFailedCalls).to.equal(1)
    expect(metrics.toolErrors).to.equal(2)
    expect(metrics.compactionsStarted).to.equal(1)
    expect(metrics.compactionsCompleted).to.equal(1)
    expect(metrics.compactionsFailed).to.equal(1)
    expect(metrics.compactionsSkipped).to.equal(1)
    expect(metrics.compactionFailureReasons).to.deep.equal({'summary-invalid-json': 1})
    expect(metrics.summaryAttempts).to.equal(2)
    expect(metrics.summaryFailures).to.equal(1)
    expect(metrics.summaryValidationFailures).to.equal(1)
    expect(metrics.summaryWallMs).to.equal(9)
  })

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

  it('excludes generated test artifacts from the submitted patch while keeping source edits', () => {
    const patch =
      'diff --git a/.pytest_cache/README.md b/.pytest_cache/README.md\nnew file mode 100644\n+cache\n' +
      'diff --git a/src/mark.py b/src/mark.py\n--- a/src/mark.py\n+++ b/src/mark.py\n+fix\n' +
      'diff --git a/testing/test_mark.py b/testing/test_mark.py\n--- a/testing/test_mark.py\n+++ b/testing/test_mark.py\n+test\n'
    const filtered = excludeGeneratedPatch(patch)
    expect(filtered.excludedPaths).to.deep.equal(['.pytest_cache/README.md'])
    expect(filtered.patch).to.include('diff --git a/src/mark.py b/src/mark.py')
    expect(filtered.patch).to.include('diff --git a/testing/test_mark.py b/testing/test_mark.py')
    expect(filtered.patch).not.to.include('.pytest_cache')
    expect(
      excludeGeneratedPatch('diff --git "a/path with space/.pytest_cache/README.md" "b/path with space/.pytest_cache/README.md"\n+cache\n')
        .patch,
    ).to.equal('')
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

  it('prepares only the supported source version without overwriting an existing module', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-source-'))
    try {
      await fs.mkdir(path.join(root, 'src/_pytest'), {recursive: true})
      const prepared = await prepareRepositorySource(root, 'pytest-dev/pytest', '7.2')
      expect(prepared).to.have.length(1)
      expect(await fs.readFile(path.join(root, prepared[0].path), 'utf8')).to.include('7.2.0')
      let error
      try {
        await prepareRepositorySource(root, 'pytest-dev/pytest', '7.2')
      } catch (error_) {
        error = error_
      }

      expect(error.code).to.equal('EEXIST')
      expect(() => repositoryProfile('unknown/repo')).to.throw('No preflight profile')
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('preserves a failing test exit code when displaying only the log tail', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-test-'))
    try {
      const result = await command(
        'python3',
        [
          'e2e/orbit-test.py',
          '--log-dir',
          root,
          '--tail',
          '20',
          '--',
          'python3',
          '-c',
          'print("x" * 5000); raise SystemExit(7)',
        ],
        {allowFailure: true},
      )
      expect(result.code).to.equal(7)
      expect(result.stdout.length).to.be.lessThan(1000)
      const report = JSON.parse(result.stdout.split('ORBIT_TEST_RESULT ')[1])
      expect(report.exitCode).to.equal(7)
      expect((await fs.readFile(report.log, 'utf8')).length).to.equal(5001)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('terminates timed out test processes and records a distinct timeout result', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-test-'))
    try {
      const result = await command(
        'python3',
        [
          'e2e/orbit-test.py',
          '--log-dir',
          root,
          '--timeout',
          '0.1',
          '--',
          'python3',
          '-c',
          'import time; time.sleep(30)',
        ],
        {allowFailure: true},
      )
      expect(result.code).to.equal(124)
      expect(JSON.parse(result.stdout.split('ORBIT_TEST_RESULT ')[1]).timedOut).to.equal(true)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('finds added failing-test candidates and generated files without following symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-quality-'))
    try {
      const initial = path.join(root, 'initial')
      const workspace = path.join(root, 'workspace')
      await fs.mkdir(initial)
      const noTests = await checkDeliverable({
        directory: path.join(root, 'report'),
        initial,
        repository: 'django/django',
        workspace: initial,
      })
      expect(noTests.status).to.equal('not-measured')
      const missing = await checkDeliverable({
        directory: path.join(root, 'missing-report'),
        initial,
        repository: 'django/django',
        workspace: path.join(root, 'absent'),
      })
      expect(missing.status).to.equal('environment-error')
      expect(JSON.parse(await fs.readFile(path.join(root, 'missing-report/quality.json'), 'utf8')).error).to.include(
        'ENOENT',
      )
      await fs.mkdir(path.join(workspace, 'tests'), {recursive: true})
      await fs.writeFile(path.join(workspace, 'tests/test_added.py'), 'assert False')
      await fs.mkdir(path.join(workspace, '.pytest_cache'))
      await fs.writeFile(path.join(workspace, '.pytest_cache/README.md'), 'cache')
      await fs.symlink('/missing/outside', path.join(workspace, 'external'))
      const changes = await inspectDeliverable(initial, workspace, 'sphinx-doc/sphinx')
      expect(changes.find((change) => change.path === 'tests/test_added.py')).to.include({
        isTest: true,
        status: 'added',
      })
      expect(changes.find((change) => change.path === '.pytest_cache/README.md').unwanted).to.equal(true)
      expect(changes.find((change) => change.path === 'external').kind).to.equal('symlink')
      expect(testCommand('django/django', 'tests/bulk_create/tests.py')[2]).to.equal('bulk_create.tests')
      expect(() => testCommand('django/django', 'tests/../test_escape.py')).to.throw()
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  describe('Pinned SWE case isolation', () => {
    const selected = {
      base_commit: 'b'.repeat(40),
      dataset: 'princeton-nlp/SWE-bench_Verified',
      image: 'swebench/sweb.eval.x86_64.owner_1776_repo-1@sha256:' + 'c'.repeat(64),
      instance_id: 'owner__repo-1',
      revision: 'a'.repeat(40),
      split: 'test',
    }

    it('rejects mutable image tags and images for a different problem', () => {
      expect(validateSWECase(selected)).to.equal(selected)
      expect(() => validateSWECase({...selected, image: selected.image.split('@')[0] + ':latest'})).to.throw()
      expect(() => validateSWECase({...selected, instance_id: 'owner__repo-2'})).to.throw()
      expect(() => validateSWECase({...selected, revision: 'main'})).to.throw()
    })

    it('rejects prepared source from a different instance or base commit before solving', () => {
      expect(() => verifyPreparedSWECase(selected, selected, selected.instance_id)).not.to.throw()
      expect(() =>
        verifyPreparedSWECase({...selected, base_commit: 'd'.repeat(40)}, selected, selected.instance_id),
      ).to.throw()
      expect(() => verifyPreparedSWECase(selected, selected, 'owner__repo-2')).to.throw()
    })
  })
})
