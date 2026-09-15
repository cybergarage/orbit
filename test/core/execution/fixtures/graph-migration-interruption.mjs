// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first. The parent provides an isolated, closed v2 Session with real v1/v2 journals.
import fs from 'node:fs'

import {migrateSessionTranscriptV3} from '../../../../dist/core/session/migration.js'
import {SessionRepository} from '../../../../dist/core/session/repository.js'

const [root, file, stopText] = process.argv.slice(2)
const repo = new SessionRepository({rootDir: root})
const scope = repo.scope('fixture')
const stop = Number(stopText)
const descriptors = new Map()
const open = fs.openSync.bind(fs)
const close = fs.closeSync.bind(fs)
fs.openSync = (...args) => {
  const fd = open(...args)
  descriptors.set(fd, String(args[0]))
  return fd
}

fs.closeSync = (fd) => {descriptors.delete(fd); return close(fd)}
let step = 0
const trace = []
const tick = (method, phase, file) => {
  trace.push({file, method, phase}); step++
  if (step === stop) {
    fs.writeSync(1, JSON.stringify({method, phase, step}) + '\n')
    process.kill(process.pid, 'SIGKILL')
  }
}

for (const method of ['writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync']) {
  const original = fs[method].bind(fs)
  fs[method] = (...args) => {
    const file = typeof args[0] === 'number' ? descriptors.get(args[0]) : String(args[0])
    if (!file?.startsWith(root)) return original(...args)
    tick(method, 'before', file)
    const result = original(...args)
    tick(method, 'after', file)
    return result
  }
}

migrateSessionTranscriptV3(scope, file, {allWritersStopped:true,automaticRestartersDisabled:true,exclusiveStorageControl:true})
fs.writeSync(1, JSON.stringify({steps: step, trace}) + '\n')
