// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'

import {Client} from '@modelcontextprotocol/sdk/client'
// The runtime ESM export requires the .js suffix even though the lint resolver cannot resolve it.
// eslint-disable-next-line import/no-unresolved
import {getDefaultEnvironment, StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {z} from 'zod'

import type {AgentTool} from './agent.js'
import type {DiagnosticContext, DiagnosticEventBus} from './diagnostics/index.js'
import type {ExecutionPolicy} from './execution/authorization.js'
import type {RunContext} from './execution/run.js'
import type {McpServerSettings, McpSettings} from './settings.js'

import {executePrepared} from './execution/authorization.js'
import {copyJSON} from './execution/journal.js'
import {until} from './execution/run.js'
import {textToolResult} from './tools/definition.js'
import {createSchemaValidator, validateSchemaKeywords} from './tools/schema.js'

export interface McpClient {
  callTool(
    params: {arguments?: Record<string, unknown>; name: string},
    resultSchema?: undefined,
    options?: {signal?: AbortSignal; timeout?: number},
  ): Promise<unknown>
  close(): Promise<void>
  connect(transport: Transport, options?: {signal?: AbortSignal; timeout?: number}): Promise<void>
  listTools(
    params?: undefined,
    options?: {signal?: AbortSignal; timeout?: number},
  ): Promise<{tools: McpToolDefinition[]}>
}

export interface McpToolDefinition {
  description?: string
  inputSchema: Record<string, unknown>
  name: string
}

export interface McpToolManager {
  close(): Promise<void>
  getTools(): Promise<AgentTool[]>
}

export interface McpToolManagerFactoryOptions {
  cwd?: string
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  execution?: {policy: ExecutionPolicy; run: RunContext}
}

export type McpClientFactory = (serverName: string, settings: McpServerSettings) => McpClient
export type McpTransportFactory = (settings: McpServerSettings, options: McpToolManagerFactoryOptions) => Transport

export interface McpToolManagerOptions extends McpToolManagerFactoryOptions {
  clientFactory?: McpClientFactory
  transportFactory?: McpTransportFactory
}

interface McpConnection {
  client: McpClient
  tools: AgentTool[]
}

export function createMcpToolManager(settings?: McpSettings, options: McpToolManagerOptions = {}): McpToolManager {
  return new StdioMcpToolManager(settings, options)
}

export function createMcpClient(): McpClient {
  return new Client({name: 'orbit', version: '0.0.0'})
}

export function createMcpTransport(settings: McpServerSettings, options: McpToolManagerFactoryOptions = {}): Transport {
  return new StdioClientTransport({
    args: settings.args,
    command: settings.command,
    cwd: options.cwd,
    env: options.execution ? {...settings.env} : {...getDefaultEnvironment(), ...settings.env},
  })
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${safeToolName(serverName)}__${safeToolName(toolName)}`
}

class StdioMcpToolManager implements McpToolManager {
  private closed = false
  private closePromise?: Promise<void>
  private connections: McpConnection[] = []
  private toolsPromise?: Promise<AgentTool[]>

  constructor(
    private readonly settings: McpSettings | undefined,
    private readonly options: McpToolManagerOptions,
  ) {}

  close(): Promise<void> {
    this.closed = true
    this.closePromise ??= (async () => {
      const settled = await Promise.allSettled([
        this.toolsPromise?.catch(() => {}),
        ...this.connections.map((connection) => connection.client.close()),
      ])
      const failure = settled.find((entry) => entry.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      this.connections = []
    })()
    return this.closePromise
  }

  getTools(): Promise<AgentTool[]> {
    if (this.closed) return Promise.reject(new Error('MCP manager is closed'))
    this.toolsPromise ??= this.loadTools()
    return this.toolsPromise
  }

  private async connectServer(
    serverName: string,
    serverSettings: McpServerSettings,
    cwd = this.options.cwd,
  ): Promise<McpConnection> {
    if (this.closed) throw new Error('MCP manager is closed')
    const client = (this.options.clientFactory ?? createMcpClient)(serverName, serverSettings)
    if (this.closed) throw new Error('MCP manager is closed')
    const connection: McpConnection = {client, tools: []}
    this.connections.push(connection)
    const transport = (this.options.transportFactory ?? createMcpTransport)(serverSettings, {...this.options, cwd})
    const startedAt = performance.now()
    this.options.diagnostics?.emit({
      ...this.options.diagnosticContext,
      data: {serverName},
      fullData: {
        args: serverSettings.args,
        command: serverSettings.command,
        envNames: Object.keys(serverSettings.env ?? {}),
      },
      level: 'info',
      type: 'mcp.server.connecting',
    })

    try {
      await client.connect(transport, this.requestOptions(startedAt))
      const result = await client.listTools(undefined, this.requestOptions(startedAt))
      this.options.diagnostics?.emit({
        ...this.options.diagnosticContext,
        data: {durationMs: performance.now() - startedAt, serverName, toolCount: result.tools.length},
        fullData: {tools: result.tools.map((tool) => ({description: tool.description, name: tool.name}))},
        level: 'info',
        type: 'mcp.server.connected',
      })
      connection.tools = await Promise.all(
        result.tools.map((remoteTool) => wrapMcpTool(serverName, client, remoteTool, this.options.execution?.run)),
      )
      return connection
    } catch (error) {
      // The manager owns partial connections and closes them through its shared close result.
      const message = error instanceof Error ? error.message : String(error)
      this.options.diagnostics?.emit({
        ...this.options.diagnosticContext,
        data: {durationMs: performance.now() - startedAt, error: message, serverName},
        level: 'error',
        type: 'mcp.server.failed',
      })
      throw new Error(`Failed to initialize MCP server "${serverName}": ${message}`)
    }
  }

  private async loadTools(): Promise<AgentTool[]> {
    const servers = this.settings?.servers
    if (servers === undefined) return []

    const tools: AgentTool[] = []
    if (this.options.execution && Object.keys(servers).length > this.options.execution.run.limits.mcpServers)
      throw new Error('MCP source limit exceeded')
    for (const [serverName, serverSettings] of Object.entries(servers)) {
      // MCP stdio startup is intentionally ordered so partially connected clients remain closable on later failures.
      // eslint-disable-next-line no-await-in-loop
      const connection = await this.managedConnect(serverName, serverSettings)
      tools.push(...connection.tools)
    }

    this.options.diagnostics?.emit({
      ...this.options.diagnosticContext,
      data: {serverCount: Object.keys(servers).length, toolCount: tools.length},
      type: 'mcp.tools.loaded',
    })
    return tools
  }

  private async managedConnect(serverName: string, settings: McpServerSettings): Promise<McpConnection> {
    const {execution} = this.options
    if (!execution) return this.connectServer(serverName, settings)
    const {policy, run} = execution
    const frozen = copyJSON({...settings, env: {...getDefaultEnvironment(), ...settings.env}})
    const id = randomUUID()
    const cwd = await fs.realpath(this.options.cwd ?? process.cwd())
    // Injected transport factories own executable resolution for their backend.
    const executable = this.options.transportFactory
      ? undefined
      : await resolveExecutable(frozen.command, cwd, frozen.env)
    if (executable) frozen.command = executable.file
    let connection: McpConnection | undefined
    const binding = {configuration: frozen, server: serverName, ...(executable ? {executable} : {})}
    const preparation = {
      binding,
      effect: 'mcp' as const,
      execute: async () => {
        const connecting = run.track('mcp-startup', this.connectServer(serverName, frozen, cwd))
        connection = await until(connecting, performance.now() + Math.min(run.remaining(), run.limits.mcpStartupMs))
        return textToolResult('MCP initialized')
      },
      preview: {
        args: frozen.args ?? [],
        command: frozen.command,
        cwd,
        environment: 'redacted; bound to this startup',
        server: serverName,
        warning: 'Starting this MCP process grants its host access; no OS sandbox is supplied.',
      },
      async revalidate() {
        if (!executable) return true
        try {
          return JSON.stringify(await executableIdentity(executable.file)) === JSON.stringify(executable)
        } catch {
          return false
        }
      },
      targets: [cwd],
    }
    const result = await executePrepared(
      run,
      {
        binding,
        cwd,
        effect: 'mcp',
        id,
        input: frozen,
        name: serverName,
        preview: preparation.preview,
        runId: run.id,
        sessionId: run.options.sessionId,
        targets: [cwd],
        variant: 'mcp-startup',
        version: 1,
      },
      preparation,
      policy,
    )
    if (!connection || result.isError) throw new Error('MCP startup denied')
    return connection
  }

  private requestOptions(startedAt: number): {signal?: AbortSignal; timeout?: number} {
    const run = this.options.execution?.run
    return run
      ? {
          signal: run.signal,
          timeout: Math.max(1, Math.min(run.remaining(), run.limits.mcpStartupMs - (performance.now() - startedAt))),
        }
      : {}
  }
}

async function wrapMcpTool(
  serverName: string,
  client: McpClient,
  remoteTool: McpToolDefinition,
  run?: RunContext,
): Promise<AgentTool> {
  const toolName = mcpToolName(serverName, remoteTool.name)
  if (run) validateSchemaKeywords(remoteTool.inputSchema)
  const validate = run ? await createSchemaValidator(remoteTool.inputSchema) : undefined

  return {
    description: remoteTool.description ?? `MCP tool ${remoteTool.name} from ${serverName}.`,
    getName(suffix?: string) {
      return suffix ? `tool:${suffix}` : 'tool'
    },
    inputSchema: remoteTool.inputSchema,
    async invoke(input, options) {
      if (validate && !validate(input).valid) throw new Error('MCP input does not match its catalog schema')
      return client.callTool(
        {
          arguments: isRecord(input) ? input : {},
          name: remoteTool.name,
        },
        undefined,
        {signal: options?.signal, ...(run ? {timeout: Math.max(1, run.remaining())} : {})},
      )
    },
    name: toolName,
    schema: validate
      ? z.unknown().refine((input) => validate(input).valid, 'MCP input does not match its catalog schema')
      : z.unknown(),
    source: {kind: 'mcp', server: serverName, tool: remoteTool.name},
  }
}

function safeToolName(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9_-]/gu, '_').replace(/^_+/u, '')
  return safe.length > 0 ? safe : 'mcp'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function executableIdentity(
  file: string,
): Promise<{device: number; file: string; inode: number; modified: number; size: number}> {
  const resolved = await fs.realpath(file)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('MCP executable is not a file')
  await fs.access(resolved, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
  return {device: stat.dev, file: resolved, inode: stat.ino, modified: stat.mtimeMs, size: stat.size}
}

async function resolveExecutable(command: string, cwd: string, env: Record<string, string>) {
  const environmentPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  const candidates =
    path.isAbsolute(command) || command.includes('/') || command.includes('\\')
      ? [path.resolve(cwd, command)]
      : environmentPath
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.resolve(cwd, directory, command))
  const extensions =
    process.platform === 'win32' && !path.extname(command)
      ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')]
      : ['']
  for (const candidate of candidates)
    for (const extension of extensions) {
      try {
        // Resolve without starting a process, before asking for startup permission.
        // eslint-disable-next-line no-await-in-loop
        return await executableIdentity(candidate + extension)
      } catch {
        /* Try the next explicit PATH candidate. */
      }
    }

  throw new Error('Cannot resolve the configured MCP executable')
}
