// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

describe('compaction interruption and recovery', function () {
  this.timeout(120_000)
  for (const [fixture, minimum] of [
    ['compaction-migration-interruption.mjs', 30],
    ['compaction-save-interruption.mjs', 7],
  ] as const) {
    it('verifies every boundary in ' + fixture, async () => {
      const file = fileURLToPath(new URL('fixtures/' + fixture, import.meta.url))
      const {stdout} = await promisify(execFile)(process.execPath, [file], {timeout: 110_000})
      const result = JSON.parse(stdout)
      expect(result.passed).to.be.at.least(minimum)
    })
  }
})
