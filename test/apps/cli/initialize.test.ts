// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stub} from 'sinon'

import Initialize from '../../../src/apps/cli/initialize.js'
import {orbitInitializationProfile} from '../../../src/apps/initialization.js'
import {planInitialization} from '../../../src/core/maintenance/initialization.js'

describe('initialization CLI', () => {
  it('shares the GUI profile, includes schedules, requires declarations and previews without modification', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-init-cli-'))
    const home = stub(os, 'homedir').returns(root)
    const previous = process.env.ORBIT_LOG_DIR
    process.env.ORBIT_LOG_DIR = path.join(root, '.orbit', 'logs')
    const output: string[] = []
    const logger = stub(Initialize.prototype, 'log').callsFake((value) => {
      output.push(String(value))
    })
    try {
      for (const mode of ['settings', 'data', 'all'] as const) {
        // Sequential CLI invocations share the output capture.
        // eslint-disable-next-line no-await-in-loop
        await Initialize.run([mode, '--dry-run'])
        expect(JSON.parse(output.at(-1)!)).deep.equal(planInitialization(orbitInitializationProfile(), mode))
      }

      expect(JSON.parse(output.at(-1)!).targets.some((t: {path: string}) => t.path.endsWith('gui-scheduled'))).equal(
        true,
      )
      try {
        await Initialize.run(['data', '--confirm-initialize'])
        throw new Error('Expected rejection')
      } catch (error) {
        expect(String(error)).contains('offline declarations')
      }

      expect(fs.existsSync(path.join(root, '.orbit'))).equal(false)
    } finally {
      logger.restore()
      home.restore()
      if (previous === undefined) delete process.env.ORBIT_LOG_DIR
      else process.env.ORBIT_LOG_DIR = previous
      fs.rmSync(root, {force: true, recursive: true})
    }
  })
})
