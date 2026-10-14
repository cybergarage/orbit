// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

import type {RuntimeSnapshot} from '../../core/application.js'
import type {TaskExecutor} from './local-scheduler.js'

import {Agent, type AgentOptions} from '../../core/agent.js'
import {FileSessionLogStore} from '../../core/logs/index.js'
import {createMcpToolManager} from '../../core/mcp.js'
import {Message, MessageType} from '../../core/message/message.js'
import {SessionRepository} from '../../core/session/index.js'
import {State} from '../../core/state.js'
import {ToolProfile} from '../../core/tools/index.js'

/** Dedicated read-only agent, with no inherited MCP startup or approval responder. */
export function scheduledExecutor(
  runtime: RuntimeSnapshot,
  journalRoot: string,
  repository = new SessionRepository(),
  createAgent: (options: AgentOptions) => Agent = (options) => new Agent(options),
): TaskExecutor {
  return async (task, requestId, signal) => {
    const previous = await repository.findById(requestId)
    const session = previous
      ? repository.open(previous.file)
      : repository.create({
          cwd: task.workspace,
          id: requestId,
          model: runtime.model,
          originator: 'gui-scheduled',
          provider: runtime.provider,
        })
    const logs = new FileSessionLogStore({rootDir: path.join(journalRoot, 'logs')})
    let agent: Agent | undefined
    try {
      agent = createAgent({
        contextPolicy: {mode: 'disabled'},
        cwd: task.workspace,
        deps: {createMcpToolManager: () => createMcpToolManager({servers: {}})},
        execution: {
          limits: {
            cleanupMs: 5000,
            elapsedMs: 120_000,
            mcpServers: 0,
            modelCalls: 12,
            toolRequests: 64,
            toolRounds: 12,
          },
          policy: {
            decide: (operation) => (operation.effect === 'read' ? 'allow' : 'deny'),
            generation: 'gui-scheduled-read-v1',
            profile: 'workspace-confirm',
            roots: [task.workspace],
          },
        },
        interruptionPolicy: {mode: 'disabled'},
        logStore: logs,
        model: {name: runtime.model, provider: runtime.provider},
        settings: {tools: {exclude: ['bash', 'write', 'edit'], include: ['read', 'list', 'glob', 'grep']}},
        state: new State(session),
        toolProfile: ToolProfile.None,
      })
      const handle = await agent.startRun([new Message(MessageType.User, {content: task.instructions})], {
        requestId,
        signal,
      })
      const result = await handle.finished
      return {
        result: handle.value()?.content || result.reason,
        status:
          !result.quiescence || result.recording.status === 'failed'
            ? 'unknown'
            : result.outcome === 'completed'
              ? 'succeeded'
              : 'failed',
      }
    } finally {
      // Retain the writer and logs if the actual agent cannot confirm cleanup.
      // The durable occurrence becomes unknown and blocks further dispatch.
      await agent?.close()
      await logs.close()
      await session.close()
    }
  }
}
