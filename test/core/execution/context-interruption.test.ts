// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

describe('compaction interruption and recovery', function () {
  this.timeout(120_000)
  for (const fixture of ['compaction-migration-interruption.mjs', 'compaction-save-interruption.mjs']) {
    it('verifies every boundary in ' + fixture, async () => {
      const file = fileURLToPath(new URL('fixtures/' + fixture, import.meta.url))
      const {stdout} = await promisify(execFile)(process.execPath, [file], {timeout: 110_000})
      const result = JSON.parse(stdout)
      const boundaries = result.boundaries as {file?: string; kind?: string; method: string; phase: string;}[]
      expect(boundaries).not.empty
      if (fixture.includes('migration')) {
        expect(result.passed).equal(boundaries.length)
        for (const method of ['writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync'])
          for (const phase of ['before', 'after'])
            expect(
              boundaries.some((b) => b.method === method && b.phase === phase),
              method + ' ' + phase,
            ).equal(true)
        expect(boundaries.some((b) => b.method === 'fsyncSync' && b.file?.endsWith('.jsonl'))).equal(true)
      } else {
        expect(result.passed).equal(boundaries.length + 1)
        expect(result.syncFailure).equal(true)
        for (const method of ['append', 'sync'])
          for (const phase of ['before', 'after'])
            expect(
              boundaries.some((b) => b.method === method && b.phase === phase && b.kind === 'file'),
              method + ' ' + phase,
            ).equal(true)
        // Directory barriers belong only to the supported strong acknowledgement path.
        expect(boundaries.some((b) => b.kind === 'directory')).equal(process.platform !== 'win32')
      }
    })
  }
})
