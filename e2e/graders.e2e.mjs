// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

import {cases} from './cases.mjs'
import {gradeWorkspace, repo} from './host.mjs'

// No inference: test the independent judges against known positive/negative controls.
describe('Independent Docker graders', function () {
  this.timeout(0)
  for (const c of cases.filter((item) => item.grader)) {
    it(`rejects the original broken ${c.id} fixture`, async () => {
      const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/grader-'))
      await fs.mkdir(path.join(directory, 'workspace'))
      for (const [name, value] of Object.entries(c.files))
        await fs.writeFile(path.join(directory, 'workspace', name), value)
      const grade = await gradeWorkspace(directory, c.grader)
      expect(grade.timedOut).to.equal(false)
      expect(grade.code).to.equal(1)
      expect(grade.markerObserved).to.equal(false)
    })
  }

  it('accepts working code and rejects a premature successful exit', async () => {
    const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/grader-'))
    await fs.mkdir(path.join(directory, 'workspace'))
    const file = path.join(directory, 'workspace/math.cjs')
    await fs.writeFile(file, 'exports.add=(a,b)=>a+b')
    const good = await gradeWorkspace(directory, cases[1].grader)
    expect(good.code).to.equal(0)
    expect(good.markerObserved).to.equal(true)
    await fs.writeFile(file, 'process.exit(0)')
    const bad = await gradeWorkspace(directory, cases[1].grader)
    expect(bad.code).to.equal(0)
    expect(bad.markerObserved).to.equal(false)
  })
})
