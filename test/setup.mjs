// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const testLogRoot = path.join(os.tmpdir(), `orbit-test-logs-${process.pid}`)
process.env.ORBIT_LOG_DIR = testLogRoot

export const mochaHooks = {
  afterAll() {
    fs.rmSync(testLogRoot, {force: true, recursive: true})
  },
}
