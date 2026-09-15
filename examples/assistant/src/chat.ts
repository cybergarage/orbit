// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- This single-user terminal deliberately serializes input and runs. */
/* eslint-disable no-unmodified-loop-condition -- Terminal close/SIGINT callbacks update quitting. */

import {randomUUID} from 'node:crypto'
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- Available on Node 20.19, though marked experimental there.
import {createInterface} from 'node:readline/promises'
import {parseArgs} from 'node:util'

import {createHost, examplePaths, waitForRun} from './host.js'

const {values} = parseArgs({options: {demo: {type: 'boolean'}, resume: {type: 'string'}}})
const host = await createHost({...examplePaths(), demo: values.demo ?? false})
const terminal = createInterface({input: process.stdin, output: process.stdout})
let activeRun: string | undefined
let quitting = false
terminal.on('close', () => {
  quitting = true
  if (activeRun) host.service.cancelRun(activeRun)
})
terminal.on('SIGINT', () => {
  quitting = true
  if (activeRun) host.service.cancelRun(activeRun)
  terminal.close()
})
try {
  const thread = values.resume ? await host.service.resumeSession(values.resume) : host.service.createThread()
  console.log(`Session: ${thread.id}\nUse /exit to quit. Ctrl+C requests stop and shutdown.`)
  if (values.demo) console.log('Offline demo: say hello, write-demo, or wait-demo.')
  while (!quitting) {
    const content = await terminal.question('You: ').catch(() => '')
    if (quitting || content === '/exit') break
    if (!content.trim()) continue
    // Save this request ID in your transport's delivery record before dispatch
    // when implementing reconnect/retry outside this local terminal example.
    const started = await host.service.startRun(thread.id, content, randomUUID())
    if (started.kind === 'command') {
      console.log(started.response)
      continue
    }

    activeRun = started.runId
    const result = await waitForRun(host.service, started.runId, async (request) => {
      console.log('Approval preview:', JSON.stringify(request.preview, null, 2))
      if (quitting) return false
      const answer = await terminal.question('Approve this operation? [y/N] ').catch(() => 'n')
      return answer.trim().toLowerCase() === 'y'
    })
    activeRun = undefined
    const message = host.service.getThread(thread.id)?.messages.at(-1)
    if (message) console.log(`Assistant: ${message.content}`)
    console.log(`Run: ${result.outcome}`)
    if (result.outcome !== 'completed') console.log(JSON.stringify(result, null, 2))
    if (result.outcome === 'incomplete') break
  }
} finally {
  terminal.close()
  await host.close()
}
