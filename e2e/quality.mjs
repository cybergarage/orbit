// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {digest, writeJSON} from './host.mjs'
import {prepareRepositorySource, repositoryChecks, repositoryProfile} from './repository-checks.mjs'

async function inventory(root, relative = '') {
  const files = new Map()
  for (const entry of await fs.readdir(path.join(root, relative), {withFileTypes: true})) {
    const name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) {
      for (const [key, value] of await inventory(root, name)) files.set(key, value)
    } else if (entry.isSymbolicLink()) {
      files.set(name, {hash: await fs.readlink(path.join(root, name)), kind: 'symlink'})
    } else if (entry.isFile()) {
      files.set(name, {hash: digest(await fs.readFile(path.join(root, name))), kind: 'file'})
    } else files.set(name, {hash: '', kind: 'special'})
  }

  return files
}

export async function inspectDeliverable(initial, workspace, repository) {
  repositoryProfile(repository)
  const before = await inventory(initial)
  const after = await inventory(workspace)
  const changes = []
  for (const name of [...new Set([...after.keys(), ...before.keys()])].sort()) {
    if (JSON.stringify(before.get(name)) === JSON.stringify(after.get(name))) continue
    const kind = after.get(name)?.kind ?? before.get(name).kind
    const status = before.has(name) ? (after.has(name) ? 'modified' : 'deleted') : 'added'
    const isTest = /^(tests|testing)\/(.*\/)?test[^/]*\.py$/.test(name)
    const unwanted =
      /(^|\/)(\.pytest_cache|__pycache__|\.hypothesis|\.DS_Store|\.coverage|htmlcov|.*\.egg-info)(\/|$)|\.(pyc|pyo)$/.test(
        name,
      )
    changes.push({isTest, kind, path: name, status, unwanted})
  }

  return changes
}

export function testCommand(repository, file) {
  if (!/^(tests|testing)\/(.*\/)?test[^/]*\.py$/.test(file) || file.split('/').includes('..'))
    throw new Error(`Not a supported public test path: ${file}`)
  if (repository === 'django/django')
    return [
      'python3',
      'tests/runtests.py',
      file
        .replace(/^tests\//, '')
        .replace(/\.py$/, '')
        .replaceAll('/', '.'),
      '--settings=test_sqlite',
      '--parallel=1',
    ]
  repositoryProfile(repository)
  return ['python3', '-m', 'pytest', '-p', 'no:cacheprovider', file, '-q']
}

export async function checkDeliverable({directory, initial, repository, version, workspace}) {
  await fs.mkdir(directory, {recursive: true})
  const changes = await inspectDeliverable(initial, workspace, repository)
  const issues = changes.filter(
    (change) => change.unwanted || change.kind !== 'file' || (change.isTest && change.status === 'deleted'),
  )
  const tests = changes.filter((change) => change.isTest && change.kind === 'file' && change.status !== 'deleted')
  const report = {changes, issues, officialScore: 'independent', status: 'not-measured', tests: []}
  for (const [label, source] of [
    ['baseline', initial],
    ['candidate', workspace],
  ]) {
    const selected = label === 'baseline' ? tests.filter((test) => test.status === 'modified') : tests
    if (selected.length === 0) continue
    const prepared = path.join(directory, `${label}-source`)
    await fs.cp(source, prepared, {recursive: true, verbatimSymlinks: true})
    if (repository === 'pytest-dev/pytest') {
      try {
        await fs.lstat(path.join(prepared, 'src/_pytest/_version.py'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await prepareRepositorySource(prepared, repository, version)
      }
    }

    report[label] = await repositoryChecks({
      continueOnFailure: true,
      directory: path.join(directory, label),
      steps: selected.map((test) => ({argv: testCommand(repository, test.path), name: test.path})),
      workspace: prepared,
    })
  }

  for (const test of tests) {
    const candidate = report.candidate?.steps?.find((step) => step.name === test.path)
    const baseline = report.baseline?.steps?.find((step) => step.name === test.path)
    let status = candidate?.exitCode === 0 ? 'passed' : 'candidate-test-failure'
    if (!candidate || candidate.timedOut || (test.status === 'modified' && (!baseline || baseline.timedOut)))
      status = 'environment-error'
    else if (baseline && baseline.exitCode !== 0) status = 'baseline-failure'
    report.tests.push({
      baselineExitCode: baseline?.exitCode,
      candidateExitCode: candidate?.exitCode,
      path: test.path,
      status,
    })
  }

  if (report.tests.some((test) => test.status === 'environment-error')) report.status = 'environment-error'
  else if (issues.length > 0 || report.tests.some((test) => test.status === 'candidate-test-failure'))
    report.status = 'quality-failed'
  else if (report.tests.some((test) => test.status === 'baseline-failure')) report.status = 'baseline-failure'
  else if (tests.length > 0) report.status = 'passed'
  if (report.baseline?.status === 'environment-error' || report.candidate?.status === 'environment-error')
    report.status = 'environment-error'
  await writeJSON(path.join(directory, 'quality.json'), report)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifest, agent, output] = process.argv.slice(2)
  if (!manifest || !agent || !output)
    throw new Error('Usage: node e2e/quality.mjs <case.json> <agent-directory> <output-directory>')
  const selected = JSON.parse(await fs.readFile(manifest, 'utf8'))
  const report = await checkDeliverable({
    directory: path.resolve(output),
    initial: path.resolve(agent, 'initial'),
    repository: selected.repo,
    version: selected.version,
    workspace: path.resolve(agent, 'workspace'),
  })
  console.log(JSON.stringify({issues: report.issues, status: report.status, tests: report.tests}))
}
