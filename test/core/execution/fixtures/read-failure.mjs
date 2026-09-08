// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// A separate process contains the intentionally unreleased unknown operation.
import fs from 'node:fs/promises'
import path from 'node:path'

import {Agent, MemorySessionLogStore, Message, MessageType, ToolProfile} from '../../../../dist/core/index.js'
const [root, code] = process.argv.slice(2)
const file = path.join(root, 'sample.txt')
const originalReadFile = fs.readFile
fs.readFile = async function (target, ...args) {
  if (target === file) throw Object.assign(new Error('Injected settled read error'), {code})
  return originalReadFile.call(this, target, ...args)
}

let calls = 0
const agent = new Agent({
  cwd: root,
  deps: {
    createModel: () => ({
      getModel: () => 'fixture',
      getName: () => 'model',
      getProvider: () => 'ollama',
      async invoke() {
        return new Message(
          MessageType.Assistant,
          ++calls === 1
            ? {payload: {toolCalls: [{id: 'read', input: {path: 'sample.txt'}, name: 'read'}]}}
            : {content: 'Reported failed read.'},
        )
      },
    }),
  },
  logStore: new MemorySessionLogStore(),
  toolProfile: ToolProfile.Coding,
})
try {
  const result = await (await agent.startRun([new Message(MessageType.User, {content: 'Read fixture'})])).finished
  let closeIncomplete = false
  try {
    await agent.close()
  } catch (error) {
    if (!error.report?.incomplete) throw error
    closeIncomplete = true
  }

  console.log(
    JSON.stringify({
      calls,
      closeIncomplete,
      outcome: result.outcome,
      quiescence: result.quiescence,
      reason: result.reason,
      statuses: result.operations.map((operation) => operation.status),
    }),
  )
} finally {
  fs.readFile = originalReadFile
}
