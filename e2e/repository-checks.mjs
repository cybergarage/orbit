// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {activeContainers, docker, image, repo, writeJSON} from './host.mjs'

export function repositoryProfile(repository) {
  const profiles = {
    'django/django': {
      modules: ['django'],
      smoke: ['python3', 'tests/runtests.py', 'utils_tests.test_timezone', '--settings=test_sqlite', '--parallel=1'],
    },
    'pytest-dev/pytest': {
      modules: ['pytest', '_pytest'],
      smoke: ['python3', '-m', 'pytest', '-p', 'no:cacheprovider', 'testing/test_compat.py', '-q'],
    },
    'sphinx-doc/sphinx': {
      modules: ['sphinx'],
      smoke: ['python3', '-m', 'pytest', '-p', 'no:cacheprovider', 'tests/test_config.py', '-q'],
    },
  }
  if (!profiles[repository]) throw new Error(`No preflight profile for ${repository}`)
  return profiles[repository]
}

export async function repositoryChecks({directory, steps, workspace}) {
  await fs.mkdir(directory, {recursive: true})
  const name = `orbit-check-${randomUUID()}`
  activeContainers.add(name)
  let report
  try {
    const execution = await docker(
      [
        'run',
        '--rm',
        '--name',
        name,
        '--init',
        '--network',
        'none',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '256',
        '--memory',
        '4g',
        '--cpus',
        '2',
        '--mount',
        `type=bind,src=${path.resolve(workspace)},dst=/fixture,readonly`,
        '--mount',
        `type=bind,src=${path.join(repo, 'e2e/repository-check.py')},dst=/repository-check.py,readonly`,
        '--entrypoint',
        'python3',
        image,
        '/repository-check.py',
        JSON.stringify({steps}),
      ],
      {allowFailure: true, log: path.join(directory, 'console.log'), timeoutMs: 300_000},
    )
    report = execution.code === 0 && !execution.timedOut ? {...JSON.parse(execution.stdout), execution} : {execution, passed: false, status: 'environment-error'};
    report.imageId = JSON.parse((await docker(['image', 'inspect', image])).stdout)[0].Id
  } catch (error) {
    report = {error: String(error), passed: false, status: 'environment-error'}
  } finally {
    const removed = await docker(['rm', '-f', name], {allowFailure: true})
    if (removed.code === 0 || removed.stderr.includes('No such container')) activeContainers.delete(name)
    else report = {...report, cleanupError: removed.stderr, passed: false, status: 'environment-error'}
  }

  await writeJSON(path.join(directory, 'report.json'), report)
  return report
}

export async function preflightRepository({directory, repository, workspace}) {
  const profile = repositoryProfile(repository)
  const code =
    'import importlib,json,pathlib,sys; paths={n:str(pathlib.Path(importlib.import_module(n).__file__).resolve()) for n in sys.argv[1:]}; print(json.dumps(paths)); assert all(p.startswith("/workspace/") for p in paths.values()), "Imported installed package instead of target source"'
  return repositoryChecks({
    directory,
    steps: [
      {argv: ['python3', '-c', code, ...profile.modules], name: 'source-imports'},
      {argv: ['python3', '-m', 'pip', 'freeze'], name: 'dependencies'},
      {argv: profile.smoke, name: 'public-smoke'},
    ],
    workspace,
  })
}

// A Git source archive omits setuptools-scm's generated version module.
// Prepare it before the initial snapshot so setup is not counted as an agent edit.
export async function prepareRepositorySource(workspace, repository, version) {
  if (repository !== 'pytest-dev/pytest') return []
  if (version !== '7.2') throw new Error('Source preparation supports only the pinned pytest 7.2 case')
  const relative = 'src/_pytest/_version.py'
  const content =
    '# Generated evaluation setup metadata; no issue solution.\nversion = "7.2.0"\nversion_tuple = (7, 2, 0)\n'
  await fs.writeFile(path.join(workspace, relative), content, {flag: 'wx'})
  return [{content, path: relative, reason: 'setuptools-scm version module omitted from source archive'}]
}
