// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

import {repo} from './host.mjs'
import {checkDeliverable} from './quality.mjs'
import {preflightRepository} from './repository-checks.mjs'

// Real Docker, no model: fail deliberately to validate the evaluation path.
describe('Verified preflight and quality controls', function () {
  this.timeout(300_000)

  it('rejects installed packages when the target source is missing', async () => {
    const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/preflight-control-'))
    const workspace = path.join(directory, 'source')
    await fs.mkdir(workspace)
    const report = await preflightRepository({
      directory: path.join(directory, 'report'),
      repository: 'pytest-dev/pytest',
      workspace,
    })
    expect(report.passed).to.equal(false)
    expect(report.steps).to.have.length(1)
    expect(report.steps[0].stderr).to.include('Imported installed package instead of target source')
  })

  it('detects failures in modified and added tests and retains every result', async () => {
    const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/quality-control-'))
    const initial = path.join(directory, 'initial')
    const workspace = path.join(directory, 'workspace')
    await fs.mkdir(path.join(initial, 'tests'), {recursive: true})
    await fs.writeFile(path.join(initial, 'tests/test_existing.py'), 'def test_existing():\n    assert True\n')
    await fs.cp(initial, workspace, {recursive: true})
    await fs.writeFile(path.join(workspace, 'tests/test_existing.py'), 'def test_existing():\n    assert False\n')
    await fs.writeFile(path.join(workspace, 'tests/test_added.py'), 'def test_added():\n    assert False\n')
    await fs.mkdir(path.join(workspace, '.pytest_cache'))
    await fs.writeFile(path.join(workspace, '.pytest_cache/README.md'), 'unwanted')
    const report = await checkDeliverable({
      directory: path.join(directory, 'report'),
      initial,
      repository: 'sphinx-doc/sphinx',
      version: '5.0',
      workspace,
    })
    expect(report.status).to.equal('quality-failed')
    expect(report.tests).to.have.length(2)
    expect(report.tests.every((test) => test.status === 'candidate-test-failure')).to.equal(true)
    expect(report.tests.find((test) => test.path === 'tests/test_existing.py').baselineExitCode).to.equal(0)
    expect(report.issues).to.have.length(1)
    expect(await fs.readFile(path.join(workspace, '.pytest_cache/README.md'), 'utf8')).to.equal('unwanted')
  })

  it('reports a baseline failure separately from a candidate-only regression', async () => {
    const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/quality-baseline-control-'))
    const initial = path.join(directory, 'initial')
    const workspace = path.join(directory, 'workspace')
    await fs.mkdir(path.join(initial, 'tests'), {recursive: true})
    await fs.writeFile(path.join(initial, 'tests/test_existing.py'), 'def test_existing():\n    assert False\n')
    await fs.cp(initial, workspace, {recursive: true})
    await fs.appendFile(path.join(workspace, 'tests/test_existing.py'), '\n# Still fails.\n')
    const report = await checkDeliverable({
      directory: path.join(directory, 'report'),
      initial,
      repository: 'sphinx-doc/sphinx',
      version: '5.0',
      workspace,
    })
    expect(report.status).to.equal('baseline-failure')
    expect(report.tests[0]).to.include({baselineExitCode: 1, candidateExitCode: 1, status: 'baseline-failure'})
  })
})
