// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Agent, compileProcessorGraph, MemorySessionLogStore, Message, MessageType, type Session, State} from '../../../src/core/index.js'

/** Real managed v1/v2/v1 Runs with a fixed model and a pure Graph adapter. */
export async function seedMaintenanceGraph(session: Session, root: string): Promise<string> {
  const agent = new Agent({
    cwd: root, deps: {createModel: () => ({getModel: () => 'fixed', getName: () => 'fixed', getProvider: () => 'ollama',
      invoke: async () => new Message(MessageType.Assistant, {content: 'fixed answer'})})}, logStore: new MemorySessionLogStore(), state: new State(session),
    toolProfile: 'none',
  })
  try {
    await (await agent.startRun([new Message(MessageType.User, {content: 'before'})])).finished
    const graph = await compileProcessorGraph({edges: [{from: 'copy', id: 'end', to: 'done'}], entry: 'copy', id: 'maintenance',
      nodes: [{adapter: 'copy', id: 'copy'}], terminals: [{id: 'done', outcome: 'completed'}]},
    [{id: 'copy', inputSchema: {}, invoke: (input) => input, kind: 'transform', outputSchema: {}, version: '1'}])
    const run = await agent.startGraphRun(graph, {fixed: true})
    if ((await run.finished).outcome !== 'completed') throw new Error('Fixture Graph did not complete')
    await (await agent.startRun([new Message(MessageType.User, {content: 'after'})])).finished
    return run.id
  } finally {await agent.close()}
}
