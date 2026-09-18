// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import process from 'node:process'

import type {AgentTool} from '../agent.js'
import type {ApprovalRequest, RunLimits, RunResult} from '../execution/run.js'
import type {McpToolManager, McpToolManagerOptions} from '../mcp.js'
import type {McpSettings, WorkspaceSettings} from '../settings.js'
import type {ToolSource} from './definition.js'

import {copyJSON, MemoryExecutionJournal} from '../execution/journal.js'
import {RunExecutionError, RunSupervisor} from '../execution/run.js'
import {createMcpToolManager} from '../mcp.js'
import {createBuiltinTools, ToolProfile} from './builtins/index.js'
import {adaptInvokableTool} from './compatibility.js'
import {ToolRegistry} from './registry.js'

export interface ToolInventory {
  complete: boolean
  inspection?: RunResult
  issues: string[]
  servers: {name: string; status: 'discovered' | 'failed' | 'not-connected'; toolCount: null | number}[]
  tools: {availability: 'registered'; description: string; name: string; source: ToolSource}[]
}

export interface ToolInventoryOptions {
  approve?: (request: ApprovalRequest) => Promise<boolean>
  connect?: boolean
  cwd?: string
  executionPolicy?: 'unrestricted' | 'workspace-confirm'
  limits?: Partial<RunLimits>
  settings?: WorkspaceSettings
  signal?: AbortSignal
  tools?: AgentTool[]
}

/** Inspect metadata without constructing a model or invoking a tool. */
export async function inspectTools(
  options: ToolInventoryOptions = {},
  createManager: (settings: McpSettings, options: McpToolManagerOptions) => McpToolManager = createMcpToolManager,
): Promise<ToolInventory> {
  options.signal?.throwIfAborted()
  const settings = copyJSON({mcp: options.settings?.mcp ?? {}, tools: options.settings?.tools ?? {}})
  let registry = new ToolRegistry()
  for (const definition of createBuiltinTools({
    ...settings.tools,
    profile: settings.tools.profile ?? ToolProfile.Coding,
  }))
    registry.register(definition)
  for (const [index, tool] of (options.tools ?? []).entries())
    registry.register(adaptInvokableTool(tool, tool.source ?? {id: `agent:${index}`, kind: 'custom'}))
  const result: ToolInventory = {
    complete: false,
    issues: [],
    servers: Object.keys(settings.mcp?.servers ?? {}).map((name) => ({name, status: 'not-connected', toolCount: null})),
    tools: [],
  }
  const updateTools = () => {
    const snapshot = registry.snapshot()
    result.tools = snapshot.specs().map(({description, name}) => ({
      availability: 'registered',
      description,
      name,
      source: {...snapshot.get(name)!.source},
    }))
  }

  updateTools()
  if (!options.connect || result.servers.length === 0) {
    result.complete = result.servers.length === 0
    if (!result.complete) result.issues.push('MCP tools are unknown until discovery. Use --connect to inspect them.')
    return result
  }

  const supervisor = new RunSupervisor()
  const id = randomUUID()
  const journal = new MemoryExecutionJournal(id)
  const managers: McpToolManager[] = []
  const cwd = options.cwd ?? process.cwd()
  const policy = {generation: 'product-v1', profile: options.executionPolicy ?? 'workspace-confirm', roots: [cwd]}
  try {
    const handle = await supervisor.startRun({
      async cleanup() {
        const settled = await Promise.allSettled(managers.map((manager) => manager.close()))
        if (settled.some((entry) => entry.status === 'rejected')) throw new Error('MCP inspection cleanup failed')
      },
      configuration: {cwd, policy, purpose: 'tool-inventory'},
      async execute(run) {
        if (result.servers.length > run.limits.mcpServers) throw new Error('MCP source limit exceeded')
        for (const server of result.servers) {
          run.check()
          const manager = createManager(
            {servers: {[server.name]: settings.mcp!.servers![server.name]}},
            {
              cwd,
              execution: {policy, run},
            },
          )
          managers.push(manager)
          try {
            // Startup remains ordered and uses the same managed authorization as Agent runs.
            // eslint-disable-next-line no-await-in-loop
            const tools = await run.wait('inventory-discovery', manager.getTools())
            const candidate = new ToolRegistry()
            const previous = registry.snapshot()
            for (const spec of previous.specs()) candidate.register(previous.get(spec.name)!)
            for (const tool of tools)
              candidate.register(adaptInvokableTool(tool, tool.source ?? {kind: 'mcp', server: server.name}))
            registry = candidate
            server.status = 'discovered'
            server.toolCount = tools.length
          } catch {
            server.status = 'failed'
            result.issues.push(`MCP discovery failed or was denied for ${JSON.stringify(server.name)}.`)
            throw new Error('MCP discovery failed')
          }
        }

        await run.ready(registry.snapshot().specs())
      },
      input: {connect: true},
      journal: async () => journal,
      limits: options.limits,
      async onApproval(request) {
        const approve = (await options.approve?.(request)) ?? false
        await supervisor.replyApproval(request.runId, {
          approve,
          digest: request.digest,
          requestId: request.id,
          responderScope: 'tool-inventory',
        })
      },
      requestId: randomUUID(),
      responderScope: 'tool-inventory',
      sessionId: id,
      signal: options.signal,
    })
    result.inspection = await handle.finished
    if (!result.inspection.quiescence) throw new RunExecutionError(result.inspection)
    result.complete = result.inspection.outcome === 'completed'
    if (!result.complete) result.issues.push(`Inspection ${result.inspection.outcome}; ${result.inspection.reason}.`)
    updateTools()
    return result
  } finally {
    await closeInspection(supervisor, journal)
  }
}

async function closeInspection(supervisor: RunSupervisor, journal: MemoryExecutionJournal): Promise<void> {
  const closed = await supervisor.close()
  if (closed.incomplete && closed.results[0]) throw new RunExecutionError(closed.results[0])
  if (closed.incomplete) throw new Error('MCP inspection admission is incomplete')
  await journal.close()
}

export function formatToolInventory(inventory: ToolInventory, view: 'mcp' | 'tools'): string {
  const lines =
    view === 'tools'
      ? inventory.tools.map(
          (tool) =>
            `${JSON.stringify(tool.name)} [${tool.source.kind}${tool.source.kind === 'mcp' ? `:${JSON.stringify(tool.source.server)}` : tool.source.kind === 'custom' ? `:${JSON.stringify(tool.source.id)}` : ''}] ${tool.availability} ${JSON.stringify(tool.description)}`,
        )
      : inventory.servers.map(
          (server) => `${JSON.stringify(server.name)} ${server.status} tools=${server.toolCount ?? 'unknown'}`,
        )
  if (lines.length === 0) lines.push(view === 'tools' ? 'No tools registered.' : 'No MCP servers configured.')
  if (view === 'tools') lines.push('Registered tools remain subject to execution policy and per-call validation.')
  if (inventory.inspection)
    lines.push(`Discovery: ${inventory.inspection.outcome} (in-memory journal; connections closed after inspection).`)
  lines.push(...inventory.issues)
  return lines.join('\n')
}
