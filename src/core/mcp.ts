// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'

import {Client} from '@modelcontextprotocol/sdk/client'
import {getDefaultEnvironment, StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio'
import {z} from 'zod'

import type {AgentTool} from './agent.js'
import type {McpServerSettings, McpSettings} from './settings.js'

export interface McpClient {
  callTool(params: {arguments?: Record<string, unknown>; name: string}): Promise<unknown>
  close(): Promise<void>
  connect(transport: Transport): Promise<void>
  listTools(): Promise<{tools: McpToolDefinition[]}>
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
    env: {...getDefaultEnvironment(), ...settings.env},
  })
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${safeToolName(serverName)}__${safeToolName(toolName)}`
}

class StdioMcpToolManager implements McpToolManager {
  private connections: McpConnection[] = []
  private toolsPromise?: Promise<AgentTool[]>

  constructor(
    private readonly settings: McpSettings | undefined,
    private readonly options: McpToolManagerOptions,
  ) {}

  async close(): Promise<void> {
    const settledToolsPromise = this.toolsPromise
    this.toolsPromise = undefined
    if (settledToolsPromise !== undefined) {
      await settledToolsPromise.catch(() => {})
    }

    const {connections} = this
    this.connections = []
    await Promise.all(connections.map((connection) => connection.client.close()))
  }

  getTools(): Promise<AgentTool[]> {
    this.toolsPromise ??= this.loadTools()
    return this.toolsPromise
  }

  private async connectServer(serverName: string, serverSettings: McpServerSettings): Promise<McpConnection> {
    const client = (this.options.clientFactory ?? createMcpClient)(serverName, serverSettings)
    const transport = (this.options.transportFactory ?? createMcpTransport)(serverSettings, this.options)

    try {
      await client.connect(transport)
      const result = await client.listTools()
      return {
        client,
        tools: result.tools.map((remoteTool) => wrapMcpTool(serverName, client, remoteTool)),
      }
    } catch (error) {
      await client.close().catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to initialize MCP server "${serverName}": ${message}`)
    }
  }

  private async loadTools(): Promise<AgentTool[]> {
    const servers = this.settings?.servers
    if (servers === undefined) return []

    const tools: AgentTool[] = []
    for (const [serverName, serverSettings] of Object.entries(servers)) {
      // MCP stdio startup is intentionally ordered so partially connected clients remain closable on later failures.
      // eslint-disable-next-line no-await-in-loop
      const connection = await this.connectServer(serverName, serverSettings)
      this.connections.push(connection)
      tools.push(...connection.tools)
    }

    return tools
  }
}

function wrapMcpTool(serverName: string, client: McpClient, remoteTool: McpToolDefinition): AgentTool {
  const toolName = mcpToolName(serverName, remoteTool.name)

  return {
    description: remoteTool.description ?? `MCP tool ${remoteTool.name} from ${serverName}.`,
    getName(suffix?: string) {
      return suffix ? `tool:${suffix}` : 'tool'
    },
    inputSchema: remoteTool.inputSchema,
    async invoke(input) {
      return client.callTool({
        arguments: isRecord(input) ? input : {},
        name: remoteTool.name,
      })
    },
    name: toolName,
    schema: z.unknown(),
  }
}

function safeToolName(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9_-]/gu, '_').replace(/^_+/u, '')
  return safe.length > 0 ? safe : 'mcp'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
