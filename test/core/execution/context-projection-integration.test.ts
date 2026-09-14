// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const child = promisify(execFile)
describe('verified context owned integration', () => {
  for (const mode of ['budgeted', 'unbudgeted', 'compaction', 'direct-tool'])
    it('preserves Agent/Graph approve, deny, cancel and replay with ' + mode, async () => {
      const result = await child(
        process.execPath,
        ['--loader', './test/alias-loader.mjs', 'test/core/execution/fixtures/verified-interrupted-context.mjs'],
        {
          env: {
            ...process.env,
            ORBIT_ROOT: process.cwd(),
            ORBIT_SOURCE: '1',
            TS_NODE_PROJECT: 'tsconfig.test.json',
            ...(mode === 'unbudgeted' ? {UNBUDGETED: '1'} : {}),
            ...(mode === 'compaction' ? {COMPACT: '1'} : {}),
            ...(mode === 'direct-tool' ? {DIRECT: '1'} : {}),
          },
          timeout: 45_000,
        },
      )
      const report = JSON.parse(result.stdout)
      expect(report.results).to.have.length(6)
      expect(report.results.every((r: {second: string}) => r.second === 'completed')).equal(true)
    })
})
