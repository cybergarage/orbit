// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Observe sequential snapshots and reply once to each pending approval. */

import type {ApprovalRequest, RunResult, RunSnapshot} from '@cybergarage/orbit'

import {
  FileSessionLogStore,
  loadWorkspaceSettingsSync,
  OrbitApplicationService,
  SessionRepository,
} from '@cybergarage/orbit'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

import {registerDemoModel} from './demo-model.js'

export function examplePaths() {
  return {
    dataDir: path.resolve(process.env.AGENT_DATA_DIR ?? '.agent'),
    workspace: path.resolve(process.env.AGENT_WORKSPACE ?? 'workspace'),
  }
}

export function repositoryFor(dataDir: string): SessionRepository {
  return new SessionRepository({journalRoot: path.join(dataDir, 'runs'), rootDir: path.join(dataDir, 'sessions')})
}

export async function createHost(options: {dataDir: string; demo: boolean; workspace: string}) {
  if (options.demo) {
    registerDemoModel()
    // Agent still discovers ancestor workspace settings. Refuse inherited MCP
    // configuration so the offline demo cannot start external servers.
    if (Object.keys(loadWorkspaceSettingsSync(options.workspace).mcp?.servers ?? {}).length > 0) {
      throw new Error(
        'The offline demo needs a workspace without inherited MCP servers; use a fresh temporary directory.',
      )
    }
  } else if (!process.env.OPENAI_API_KEY || !process.env.ORBIT_MODEL) {
    throw new Error('Set OPENAI_API_KEY and ORBIT_MODEL, or pass --demo.')
  }

  const logs = new FileSessionLogStore({rootDir: path.join(options.dataDir, 'logs')})
  try {
    const service = await OrbitApplicationService.create({
      contextPolicy: {mode: 'disabled'},
      // This example uses explicit instructions. Omit contexts to discover
      // ORBIT.md / AGENTS.md in trusted workspaces instead.
      contexts: [],
      cwd: options.workspace,
      logStore: logs,
      repository: repositoryFor(options.dataDir),
      settings: {
        interruptionPolicy: {mode: 'disabled'},
        model: options.demo ? 'demo-v1' : process.env.ORBIT_MODEL,
        provider: options.demo ? 'orbit-demo' : 'openai',
        providers: options.demo ? {} : {openai: {apiKeyEnv: 'OPENAI_API_KEY'}},
        tools: options.demo ? {exclude: [], include: ['write'], profile: 'none'} : {profile: 'coding'},
      },
    })
    return {
      async close() {
        await service.close()
        // The service borrows this log store; the host owns its final close.
        await logs.close()
      },
      service,
    }
  } catch (error) {
    await logs.close()
    throw error
  }
}

// Polling keeps this small example easy to follow. A GUI can subscribe to
// snapshots and refetch queryRun after reconnects; see docs/gui-integration.md.
export async function waitForRun(
  service: OrbitApplicationService,
  runId: string,
  decide: (request: ApprovalRequest) => Promise<boolean>,
  observe?: (snapshot: RunSnapshot) => void,
): Promise<RunResult> {
  const answered = new Set<string>()
  let sequence = -1
  while (true) {
    const snapshot = await service.queryRun(runId)
    if (!snapshot) throw new Error(`Unknown run: ${runId}`)
    if (snapshot.sequence > sequence) {
      sequence = snapshot.sequence
      observe?.(snapshot)
    }

    if (snapshot.result) return snapshot.result
    for (const request of snapshot.approvals) {
      if (answered.has(request.id)) continue
      const approve = await decide(request)
      try {
        await service.replyApproval(runId, {approve, digest: request.digest, requestId: request.id})
      } catch (error) {
        // A stop or expiry can make the prompt stale while the human answers.
        const fresh = await service.queryRun(runId)
        if (!fresh?.result && fresh?.approvals.some((item) => item.id === request.id)) throw error
      }

      answered.add(request.id)
    }

    await delay(50)
  }
}
