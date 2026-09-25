// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {normalizePatch} from './grading.mjs'
import {activeContainers, command, digest, docker, image, ollamaMetadata, repo, runAgent, writeJSON} from './host.mjs'
import {preflightRepository, prepareRepositorySource} from './repository-checks.mjs'
import {evaluationPrompt, readRounds} from './strategy.mjs'
import {validateSWECase, verifyPreparedSWECase} from './swe-case.mjs'

const strategy = process.env.ORBIT_E2E_STRATEGY ?? 'baseline'
const rounds = readRounds(process.env.ORBIT_SWE_ROUNDS, 50)
const caseFile = process.env.ORBIT_SWE_CASE
const selected = caseFile ? validateSWECase(JSON.parse(await fs.readFile(path.resolve(caseFile), 'utf8'))) : null
const root = selected ? path.join(repo, 'tmp/e2e/verified', selected.instance_id) : path.join(repo, 'tmp/e2e/swe')
const python = process.env.ORBIT_SWE_PYTHON ?? path.join(repo, 'tmp/e2e/venv/bin/python')
const instanceId = selected?.instance_id ?? 'sympy__sympy-20590'
const harnessCommit = '726c5461e2ef52d83cf1ea2107870a8bb3328d57'
const officialImage =
  selected?.image ??
  'swebench/sweb.eval.x86_64.sympy_1776_sympy-20590@sha256:3a282752833ce34730ee0621e22033501c993f45742775ca57f04c9ff27178a0'
const evalImage = `orbit-swebench/sweb.eval.x86_64.${instanceId.replaceAll('__', '_1776_')}:fixed`
const [action, argument] = process.argv.slice(2)
await fs.mkdir(root, {recursive: true})

async function grade(predictions) {
  const runId = `orbit-${predictions === 'gold' ? 'gold' : 'prediction'}-${randomUUID()}`
  const container = `sweb.eval.${instanceId}.${runId}`
  const endpoint = (await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim()
  const installed = await command(python, [
    '-c',
    'import importlib.metadata as m; print(m.distribution("swebench").read_text("direct_url.json") or "{}")',
  ])
  const source = JSON.parse(installed.stdout)
  const sourcePath = source.url?.startsWith('file:') ? new URL(source.url).pathname : null
  if (!sourcePath || (await command('git', ['rev-parse', 'HEAD'], {cwd: sourcePath})).stdout.trim() !== harnessCommit)
    throw new Error('Install SWE-bench from the pinned local source checkout documented in docs/e2e-evaluation.md')
  const version = await command(python, ['-c', 'import swebench; print(swebench.__version__)'])
  if (version.stdout.trim() !== '4.1.0') throw new Error('SWE-bench 4.1.0 is required')
  // The official image is amd64. Pull explicitly before the pinned harness
  // looks it up, so Apple Silicon uses Docker emulation rather than an ARM pull.
  await docker(['pull', '--platform', 'linux/amd64', officialImage], {
    log: path.join(root, `${runId}-pull.log`),
    timeoutMs: 1_200_000,
  })
  await docker(['tag', officialImage, evalImage])
  const imageInfo = JSON.parse((await docker(['image', 'inspect', evalImage])).stdout)[0]
  const dataset = JSON.parse(await fs.readFile(path.join(root, 'dataset.json'), 'utf8'))
  activeContainers.add(container)
  let execution
  try {
    execution = await command(
      python,
      [
        '-m',
        'swebench.harness.run_evaluation',
        '--dataset_name',
        path.join(root, 'instance.json'),
        '--predictions_path',
        predictions,
        '--instance_ids',
        instanceId,
        '--max_workers',
        '1',
        '--run_id',
        runId,
        '--timeout',
        '600',
        '--cache_level',
        'instance',
        '--namespace',
        'orbit-swebench',
        '--instance_image_tag',
        'fixed',
      ],
      {
        allowFailure: true,
        cwd: root,
        env: {...process.env, DOCKER_HOST: endpoint},
        log: path.join(root, `${runId}.log`),
        timeoutMs: 900_000,
      },
    )
  } finally {
    await docker(['rm', '-f', container], {allowFailure: true})
    activeContainers.delete(container)
  }

  const model =
    predictions === 'gold'
      ? 'gold'
      : JSON.parse((await fs.readFile(predictions, 'utf8')).trim()).model_name_or_path.replaceAll('/', '__')
  const reportFile = path.join(root, 'logs/run_evaluation', runId, model, instanceId, 'report.json')
  let report
  try {
    report = JSON.parse(await fs.readFile(reportFile, 'utf8'))
  } catch {
    /* Missing reports are not success. */
  }

  let aggregate
  try {
    aggregate = JSON.parse(await fs.readFile(path.join(root, `${model}.${runId}.json`), 'utf8'))
  } catch {
    /* A missing aggregate cannot prove an empty-patch disposition. */
  }

  const emptyPatch = aggregate?.empty_patch_ids?.includes(instanceId) === true
  const status = execution.timedOut
    ? 'environment-error'
    : report?.[instanceId]
      ? report[instanceId].resolved
        ? 'resolved'
        : 'unresolved'
      : emptyPatch && execution.code === 0
        ? 'unresolved'
        : 'grading-error'
  const record = {
    aggregate,
    aggregateFile: aggregate ? `${model}.${runId}.json` : null,
    dataset,
    datasetFileSha256: digest(await fs.readFile(path.join(root, 'instance.json'))),
    evaluationPlatform: 'linux/amd64 (Docker emulation on ARM64)',
    gradingDisposition: emptyPatch ? 'skipped-empty-patch' : 'evaluated-or-error',
    harnessCommit,
    harnessInstallation: {sourceCommit: harnessCommit, sourceType: 'local checkout'},
    harnessVersion: '4.1.0',
    imageDigests: imageInfo.RepoDigests,
    imageId: imageInfo.Id,
    imageReference: officialImage,
    predictionsSha256: predictions === 'gold' ? null : digest(await fs.readFile(predictions)),
    processExit: execution.code,
    report,
    reportFile: report ? path.relative(root, reportFile) : null,
    runId,
    status,
  }
  await writeJSON(path.join(root, `${runId}.json`), record)
  if (predictions === 'gold' && status === 'resolved') await writeJSON(path.join(root, 'gold-verified.json'), record)
  console.log(JSON.stringify(record, null, 2))
  if (['environment-error', 'grading-error'].includes(status) || (predictions === 'gold' && status !== 'resolved'))
    process.exitCode = 1
}

switch (action) {
  case 'gold': {
    await grade('gold')

    break
  }

  case 'prepare': {
    if (selected) await writeJSON(path.join(root, 'dataset.json'), selected)
    await command(python, [path.join(repo, 'e2e/prepare-swe.py')], {
      cwd: root,
      log: path.join(root, 'prepare.log'),
      timeoutMs: 300_000,
    })
    console.log('Prepared one pinned instance. Run gold before solve.')

    break
  }

  case 'solve': {
    const gold = JSON.parse(await fs.readFile(path.join(root, 'gold-verified.json'), 'utf8'))
    if (
      gold.status !== 'resolved' ||
      gold.datasetFileSha256 !== digest(await fs.readFile(path.join(root, 'instance.json')))
    )
      throw new Error('Verify the current dataset with the reference patch first')
    const [instance] = JSON.parse(await fs.readFile(path.join(root, 'instance.json'), 'utf8'))
    verifyPreparedSWECase(instance, selected, instanceId)
    const model = argument ?? 'ornith-1.5:9b'
    const directory = path.join(root, `solve-${model.replaceAll(':', '-')}-${randomUUID()}`)
    await fs.mkdir(directory)
    const pristine = path.join(directory, 'pristine')
    await fs.mkdir(pristine)
    // A source archive at base_commit carries neither repository history nor the
    // reference/test patches. Only this directory is passed into the agent.
    const archive = path.join(directory, 'source.tar.gz')
    const url = `https://codeload.github.com/${instance.repo}/tar.gz/${instance.base_commit}`
    const response = await fetch(url, {signal: AbortSignal.timeout(120_000)})
    if (!response.ok) throw new Error(`Source archive: ${response.status}`)
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()))
    await command('tar', ['-xzf', archive, '--strip-components=1', '-C', pristine])
    const preparation = selected ? await prepareRepositorySource(pristine, instance.repo, selected.version) : []
    let preflight
    if (selected) {
      preflight = await preflightRepository({
        directory: path.join(directory, 'preflight'),
        repository: instance.repo,
        workspace: pristine,
      })
      if (!preflight.passed) {
        await writeJSON(path.join(directory, 'metadata.json'), {
          dataset: gold.dataset,
          preflight,
          preparation,
          runStatus: 'environment-error',
        })
        throw new Error(`Repository preflight failed before model execution: ${directory}`)
      }
    }

    const metadata = await ollamaMetadata(model)
    const runDirectory = path.join(directory, 'agent')
    const run = await runAgent({
      directory: runDirectory,
      model,
      numCtx: 32_768,
      prompt: evaluationPrompt(
        `Resolve the following issue in the repository at /workspace. Inspect the code, implement a minimal fix and run relevant tests. Do not retrieve solutions from the network. Do not alter existing tests to hide failures.\n\n${instance.problem_statement}`,
        {strategy, swe: true},
      ),
      rounds,
      strategy,
      think: process.env.ORBIT_SWE_THINK === 'true',
      timeoutMs: 900_000,
      workspace: pristine,
    })
    const diff = await command(
      'git',
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--binary',
        '--',
        'initial',
        'workspace',
      ],
      {allowFailure: true, cwd: runDirectory},
    )
    if (![0, 1].includes(diff.code)) throw new Error(`Patch extraction failed: ${diff.stderr}`)
    const patch = normalizePatch(diff.stdout)
    const prediction = {
      instance_id: instanceId,
      model_name_or_path: `orbit-${model.replaceAll(':', '-')}`,
      model_patch: patch,
    }
    await fs.writeFile(path.join(directory, 'predictions.jsonl'), JSON.stringify(prediction) + '\n')
    await fs.writeFile(path.join(directory, 'patch.diff'), patch)
    await writeJSON(path.join(directory, 'metadata.json'), {
      config: run.config,
      dataset: gold.dataset,
      elapsedMs: run.elapsedMs,
      harnessSha256: digest(await fs.readFile(new URL(import.meta.url))),
      imageId: JSON.parse((await docker(['image', 'inspect', image])).stdout)[0].Id,
      metadata,
      metrics: run.metrics,
      orbitCommit: (await command('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      preflight,
      preparation,
      runStatus: run.status,
      runtimeOutcome: run.result?.runtime?.outcome,
      sourceArchiveSha256: digest(await fs.readFile(archive)),
      usage: run.usage,
      usageComplete: run.usageComplete,
      workingTree: (await command('git', ['status', '--short'])).stdout,
    })
    console.log(
      JSON.stringify({
        directory,
        patchBytes: Buffer.byteLength(patch),
        runStatus: run.status,
        runtimeOutcome: run.result?.runtime?.outcome,
      }),
    )

    break
  }

  default: {
    if (action === 'grade' && argument) {
      await grade(path.resolve(argument))
    } else {
      throw new Error('Usage: npm run eval:swebench -- prepare | gold | solve [model] | grade <predictions.jsonl>')
    }
  }
}
