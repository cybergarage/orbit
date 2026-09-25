// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

import {cases} from './cases.mjs'
import {gradeCase} from './grading.mjs'
import {command, docker, image, ollamaMetadata, repo, runAgent, writeJSON} from './host.mjs'
import {evaluationPrompt, readRounds, strategyVersion} from './strategy.mjs'

const strategy = process.env.ORBIT_E2E_STRATEGY ?? strategyVersion
const rounds = readRounds(process.env.ORBIT_E2E_ROUNDS, 12)
const models = (process.env.ORBIT_E2E_MODELS ?? 'gemma4:12b,ornith-1.5:9b').split(',')
const repetitions = Number(process.env.ORBIT_E2E_REPETITIONS ?? 3)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw new Error('Repetitions must be between 1 and 10')
const selected = cases.filter((c) => !process.env.ORBIT_E2E_CASE || c.id === process.env.ORBIT_E2E_CASE)
if (selected.length === 0) throw new Error('Unknown E2E case')
const root = path.join(repo, 'tmp/e2e/runs', new Date().toISOString().replaceAll(':', '-') + '-small')
const results = []

describe('Ollama coding E2E (real models, Docker)', function () {
  // Host commands and the Run own deadlines and cleanup. A Mocha timeout does
  // not cancel an async test and could otherwise overlap the next trial.
  this.timeout(0)

  before(async () => {
    await fs.mkdir(root, {recursive: true})
    const metadata = []
    for (const model of models) metadata.push(await ollamaMetadata(model))
    await writeJSON(path.join(root, 'environment.json'), {
      arch: process.arch,
      date: new Date().toISOString(),
      docker: JSON.parse((await docker(['version', '--format', '{{json .}}'])).stdout),
      image: JSON.parse((await docker(['image', 'inspect', image])).stdout)[0].Id,
      models: metadata,
      node: process.version,
      orbitCommit: (await command('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      platform: process.platform,
      workingTree: (await command('git', ['status', '--short'])).stdout,
    })
    console.log(`Artifacts: ${root}`)
  })

  after(async () => {
    await writeJSON(path.join(root, 'summary.json'), {planned: models.length * repetitions * selected.length, results})
  })
  for (const model of models)
    for (const c of selected)
      for (let repetition = 0; repetition < repetitions; repetition++) {
        it(`${model} / ${c.id} / ${repetition + 1}`, async () => {
          const directory = path.join(root, `${model.replaceAll(':', '-')}-${c.id}-${repetition + 1}`)
          const run = await runAgent({
            directory,
            files: c.files,
            model,
            prompt: evaluationPrompt(c.prompt, {strategy}),
            rounds,
            strategy,
          })
          const checked = await gradeCase(directory, c, run)
          const {grade} = checked
          const row = {
            artifactPassed: checked.passed,
            caseId: c.id,
            directory: path.basename(directory),
            elapsedMs: run.elapsedMs,
            metrics: run.metrics,
            model,
            promptSha256: run.config.promptSha256,
            reason: checked.reason,
            repetition,
            rounds,
            runtimeOutcome: run.result?.runtime?.outcome,
            status: checked.status,
            strategy,
            usage: run.usage,
            usageComplete: run.usageComplete,
          }
          results.push(row)
          await writeJSON(path.join(directory, 'grade.json'), {grade, row})
          await writeJSON(path.join(root, 'summary.json'), {
            planned: models.length * repetitions * selected.length,
            results,
          })
          expect(row.status, JSON.stringify(row)).to.equal('resolved')
        })
      }
})
