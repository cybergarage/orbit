// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  bookContextWindow,
  caseIds,
  caseResolved,
  checkFiles,
  checkFilesAndGrade,
  makeCase,
  runtimePassed,
} from './cases.mjs'

describe('Book workflow fixtures (no inference or Docker)', () => {
  it('uses discovered model capacity without a fixed book context ceiling', () => {
    for (const window of [8192, 262_144, 1_048_576])
      expect(
        bookContextWindow({
          model: 'fixture',
          modelInfo: {'fixture.context_length': window, 'general.architecture': 'fixture'},
        }),
      ).to.equal(window)
  })

  it('rejects unknown or invalid capacity instead of silently using a fixed window', () => {
    for (const window of [undefined, null, 0, -1, 1.5, '262144'])
      expect(() =>
        bookContextWindow({
          model: 'fixture',
          modelInfo: {'fixture.context_length': window, 'general.architecture': 'fixture'},
        }),
      ).to.throw('Unknown model context capacity')
    expect(() => bookContextWindow({model: 'fixture'})).to.throw('Unknown model context capacity')
  })

  it('preserves every vendored file at its recorded source hash', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('source.json', import.meta.url), 'utf8'))
    for (const [name, record] of Object.entries(manifest.files)) {
      const data = await fs.readFile(new URL(name, import.meta.url))
      expect(createHash('sha256').update(data).digest('hex'), name).to.equal(record.sha256)
    }
  })

  it('requires updated Loop progress and rejects checked-off browser claims', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-book-loop-'))
    try {
      const c = await makeCase('loop')
      for (const [name, content] of Object.entries(c.files)) {
        await fs.mkdir(path.dirname(path.join(directory, name)), {recursive: true})
        await fs.writeFile(path.join(directory, name), content)
      }

      let error
      try {
        await checkFiles(directory, c)
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('did not update progress.md')
      await fs.appendFile(
        path.join(directory, 'progress.md'),
        '\nAutomated checks passed; browser checks remain pending.\n',
      )
      await checkFiles(directory, c)
      await fs.appendFile(path.join(directory, 'progress.md'), '\n- [x] Verified basic operation in a browser\n')
      error = undefined
      try {
        await checkFiles(directory, c)
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('unperformed browser checks')
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it('grades Loop artifacts even when progress was not updated', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-book-loop-grade-'))
    try {
      const c = await makeCase('loop')
      for (const [name, content] of Object.entries(c.files)) {
        await fs.mkdir(path.dirname(path.join(directory, name)), {recursive: true})
        await fs.writeFile(path.join(directory, name), content)
      }

      let graded = false
      const result = await checkFilesAndGrade(directory, c, async () => {
        graded = true
        return {passed: true}
      })
      expect(graded).to.equal(true)
      expect(result.fileChecks).to.include({status: 'failed'})
      expect(result.fileChecks.error).to.include('did not update progress.md')
      expect(result.grade.passed).to.equal(true)
      expect(
        caseResolved(
          {result: {runtime: {outcome: 'completed', quiescence: true}}, status: 'completed'},
          result.grade,
          result.fileChecks,
        ),
      ).to.equal(false)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it('keeps Vibe requirements in the prompt and Loop in three documents', async () => {
    const vibe = await makeCase('vibe')
    expect(vibe.files).not.to.have.property('spec.md')
    expect(vibe.files).not.to.have.property('test.md')
    expect(vibe.files).not.to.have.property('progress.md')
    const loop = await makeCase('loop')
    expect(loop.files).to.include.keys('spec.md', 'test.md', 'progress.md')
    expect(loop.prompt).to.include('Repeat implementation')
    expect(loop.files['progress.md']).to.include('three consecutive failures')
  })

  it('reviews SDD before providing the frozen decisions and missing test plan', async () => {
    const review = await makeCase('sdd')
    expect(review.files).not.to.have.property('test.md')
    expect(review.prompt).to.include('Do not change the code')
    expect(review.prompt).not.to.include('Implement the memory matching game')
    const implementation = await makeCase('sdd', {implementation: true})
    expect(implementation.files).to.have.property('test.md')
    expect(implementation.files['spec.md']).to.include('Zero tests do not satisfy completion')
    expect(implementation.prompt).to.include('Implement the memory matching game')
  })

  it('uses identical starter sources and dependencies without solutions', async () => {
    const cases = await Promise.all(caseIds.map((id) => makeCase(id)))
    for (const c of cases) {
      for (const name of ['src/main.ts', 'src/style.css', 'package.json', 'package-lock.json'])
        expect(c.files[name]).to.equal(cases[0].files[name])
      expect(Object.keys(c.files).some((name) => name.includes('solutions'))).to.equal(false)
    }
  })

  it('rejects changed review files, extra artifacts and modified frozen specifications', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-book-unit-'))
    try {
      const c = await makeCase('sdd')
      for (const [name, content] of Object.entries(c.files)) {
        await fs.mkdir(path.dirname(path.join(directory, name)), {recursive: true})
        await fs.writeFile(path.join(directory, name), content)
      }

      await checkFiles(directory, c, true)
      await fs.writeFile(path.join(directory, 'extra.txt'), 'Unexpected review output')
      let error
      try {
        await checkFiles(directory, c, true)
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('Review added file')
      await fs.rm(path.join(directory, 'extra.txt'))
      await fs.writeFile(path.join(directory, 'spec.md'), 'Changed')
      error = undefined
      try {
        await checkFiles(directory, c)
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('Protected file changed')
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it('never treats budget exhaustion or cleanup failure as workflow completion', () => {
    const run = {result: {runtime: {outcome: 'completed', quiescence: true}}, status: 'completed'}
    expect(runtimePassed(run)).to.equal(true)
    expect(runtimePassed({...run, status: 'timeout'})).to.equal(false)
    expect(runtimePassed({...run, result: {...run.result, closeError: 'Failed'}})).to.equal(false)
    expect(runtimePassed({...run, result: {runtime: {outcome: 'budget-exceeded', quiescence: true}}})).to.equal(false)
  })
})
