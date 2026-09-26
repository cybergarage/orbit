// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

// Set before dynamically importing host.mjs, which resolves its image at import.
process.env.ORBIT_E2E_IMAGE ??= 'orbit-e2e:book-agent'
const {command, docker, image, ollamaMetadata, repo, runAgent, writeJSON} = await import('../host.mjs')
const {bookContextWindow, caseIds, caseResolved, checkFiles, checkFilesAndGrade, makeCase, runtimePassed, source} =
  await import('./cases.mjs')
const {gradeBook} = await import('./grade.mjs')
const {readElapsed, readRounds} = await import('../strategy.mjs')
const selected = process.env.ORBIT_E2E_CASE ? [process.env.ORBIT_E2E_CASE] : caseIds
if (selected.some((id) => !caseIds.includes(id))) throw new Error('Unknown book case')
const repetitions = Number(process.env.ORBIT_E2E_REPETITIONS ?? 1)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw new Error('Repetitions must be between 1 and 10')
const models = (process.env.ORBIT_E2E_MODELS ?? 'ornith-1.5:9b').split(',')
const rounds = readRounds(process.env.ORBIT_E2E_ROUNDS, 'unlimited')
const timeoutMs = readElapsed(process.env.ORBIT_BOOK_ELAPSED_MS, 'unlimited')
const root = path.join(repo, 'tmp/e2e/runs', new Date().toISOString().replaceAll(':', '-') + '-book')
const results = []
const contextWindows = new Map()

describe('Book workflows (real Orbit/Ollama, isolated game/browser containers)', function () {
  this.timeout(0)

  before(async () => {
    await fs.mkdir(root, {recursive: true})
    const metadata = []
    for (const model of models) {
      const info = await ollamaMetadata(model)
      const contextWindow = bookContextWindow(info)
      contextWindows.set(model, contextWindow)
      metadata.push({...info, requestedContextWindow: contextWindow})
      console.log(`Model context: ${model} = ${contextWindow} tokens (review and implementation)`)
    }

    await writeJSON(path.join(root, 'environment.json'), {
      agentImage: JSON.parse((await docker(['image', 'inspect', image])).stdout)[0].Id,
      graderImage: JSON.parse(
        (await docker(['image', 'inspect', process.env.ORBIT_BOOK_GRADER_IMAGE ?? 'orbit-e2e:book-grader'])).stdout,
      )[0].Id,
      models: metadata,
      node: process.version,
      orbitCommit: (await command('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      source,
      workingTree: (await command('git', ['status', '--short'])).stdout,
    })
    console.log(`Artifacts: ${root}`)
  })
  for (const model of models)
    for (const id of selected)
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        it(`${model} / ${id} / ${repetition}`, async () => {
          const directory = path.join(root, `${model.replaceAll(/[^a-zA-Z0-9.-]/g, '-')}-${id}-${repetition}`)
          await fs.mkdir(directory, {recursive: true})
          const row = {checks: 'not-run', directory, id, model, repetition, status: 'environment-error'}
          try {
            let review
            if (id === 'sdd') {
              const c = await makeCase(id)
              review = await runAgent({
                directory: path.join(directory, 'review'),
                files: c.files,
                model,
                numCtx: contextWindows.get(model),
                prompt: c.prompt,
                rounds,
                strategy: 'book-sdd-review-v1',
                timeoutMs,
              })
              row.review = {elapsedMs: review.elapsedMs, status: review.status, usage: review.usage}
              row.status = 'unresolved'
              if (!runtimePassed(review) || !review.result.answer?.trim())
                throw new Error('Specification review did not complete')
              await checkFiles(path.join(directory, 'review/workspace'), c, true)
            }

            const c = await makeCase(id, {implementation: true})
            const prompt =
              (review
                ? `Prior review (advisory):\n${review.result.answer}\n\nThe host adopted only the fixed decisions now recorded in spec.md and supplied test.md. Do not change these files.\n\n`
                : '') + c.prompt
            const run = await runAgent({
              directory: path.join(directory, 'implementation'),
              files: c.files,
              model,
              numCtx: contextWindows.get(model),
              prompt,
              rounds,
              strategy: `book-${id}-v1`,
              timeoutMs,
            })
            row.run = {
              elapsedMs: run.elapsedMs,
              metrics: run.metrics,
              outcome: run.result?.runtime?.outcome,
              promptSha256: run.config.promptSha256,
              status: run.status,
              usage: run.usage,
              usageComplete: run.usageComplete,
            }
            row.status = ['environment-error', 'timeout'].includes(run.status) ? run.status : 'unresolved'
            const {fileChecks, grade} = await checkFilesAndGrade(
              path.join(directory, 'implementation/workspace'),
              c,
              () => gradeBook(path.join(directory, 'implementation')),
            )
            row.fileChecks = fileChecks
            await writeJSON(path.join(directory, 'grade.json'), grade)
            row.checks = grade.passed ? 'passed' : 'failed'
            if (grade.timedOut || grade.code === 125) row.status = 'grading-error'
            else if (caseResolved(run, grade, fileChecks)) row.status = 'resolved'
          } catch (error) {
            row.error = String(error)
          } finally {
            results.push(row)
            await writeJSON(path.join(directory, 'result.json'), row)
            await writeJSON(path.join(root, 'summary.json'), {
              planned: selected.length * models.length * repetitions,
              results,
            })
          }

          expect(row.status, JSON.stringify(row)).to.equal('resolved')
        })
      }
})
