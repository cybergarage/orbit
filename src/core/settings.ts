// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {DOT_APP_DIR_NAME, SETTINGS_FILE_NAME} from './app.js'
import {getProvider, isProvider, type ProviderName} from './models/provider.js'
import {type BuiltinToolSelection, isBuiltinToolName, isToolProfile} from './tools/index.js'
import {LocalWorkspaceLocator} from './workspace.js'

export interface ProviderConnectionSettings {
  apiKey?: string
  apiKeyEnv?: string
  host?: string
}

export type ProviderSettings = Record<string, ProviderConnectionSettings | undefined>

export interface McpServerSettings {
  args?: string[]
  command: string
  env?: Record<string, string>
}

export interface McpSettings {
  servers?: Record<string, McpServerSettings>
}

export type ToolSettings = BuiltinToolSelection

export interface WorkspaceSettings {
  mcp?: McpSettings
  model?: string
  provider?: ProviderName
  providers?: ProviderSettings
  tools?: ToolSettings
}

export interface WorkspaceSettingsSource {
  file: string
  settings: WorkspaceSettings
}

export interface ResolvedWorkspaceSettings {
  settings: WorkspaceSettings
  sources: WorkspaceSettingsSource[]
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return undefined
    throw error
  }
}

function readIfExistsSync(file: string): string | undefined {
  try {
    return fsSync.readFileSync(file, 'utf8')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return undefined
    throw error
  }
}

export async function loadWorkspaceSettings(startDir = process.cwd()): Promise<WorkspaceSettings> {
  return (await loadWorkspaceSettingsWithSources(startDir)).settings
}

export async function loadWorkspaceSettingsWithSources(startDir = process.cwd()): Promise<ResolvedWorkspaceSettings> {
  const mergedSettings: WorkspaceSettings = {}
  const sources: WorkspaceSettingsSource[] = []
  const directories = await new LocalWorkspaceLocator({start: startDir}).directories()

  for (const dir of directories) {
    const preferredFile = path.join(dir, DOT_APP_DIR_NAME, SETTINGS_FILE_NAME)
    const fallbackFile = path.join(dir, SETTINGS_FILE_NAME)
    // eslint-disable-next-line no-await-in-loop
    const preferredRaw = await readIfExists(preferredFile)
    // eslint-disable-next-line no-await-in-loop
    const fallbackRaw = preferredRaw === undefined ? await readIfExists(fallbackFile) : undefined
    const raw = preferredRaw ?? fallbackRaw
    if (raw === undefined) continue

    const file = preferredRaw === undefined ? fallbackFile : preferredFile

    const settings = parseWorkspaceSettings(raw, file)
    sources.push({file, settings})
    mergeWorkspaceSettingsInto(mergedSettings, settings)
  }

  return {settings: mergedSettings, sources}
}

export function loadWorkspaceSettingsSync(startDir = process.cwd()): WorkspaceSettings {
  return loadWorkspaceSettingsWithSourcesSync(startDir).settings
}

export function loadWorkspaceSettingsWithSourcesSync(startDir = process.cwd()): ResolvedWorkspaceSettings {
  const mergedSettings: WorkspaceSettings = {}
  const sources: WorkspaceSettingsSource[] = []
  const directories = workspaceDirectoriesSync(startDir)

  for (const dir of directories) {
    const preferredFile = path.join(dir, DOT_APP_DIR_NAME, SETTINGS_FILE_NAME)
    const fallbackFile = path.join(dir, SETTINGS_FILE_NAME)
    const preferredRaw = readIfExistsSync(preferredFile)
    const fallbackRaw = preferredRaw === undefined ? readIfExistsSync(fallbackFile) : undefined
    const raw = preferredRaw ?? fallbackRaw
    if (raw === undefined) continue

    const file = preferredRaw === undefined ? fallbackFile : preferredFile
    const settings = parseWorkspaceSettings(raw, file)
    sources.push({file, settings})
    mergeWorkspaceSettingsInto(mergedSettings, settings)
  }

  return {settings: mergedSettings, sources}
}

export function mergeWorkspaceSettings(...settings: Array<undefined | WorkspaceSettings>): WorkspaceSettings {
  const mergedSettings: WorkspaceSettings = {}

  for (const setting of settings) {
    if (setting === undefined) continue
    mergeWorkspaceSettingsInto(mergedSettings, setting)
  }

  return mergedSettings
}

function isWorkspaceDirectorySync(file: string): boolean {
  try {
    return fsSync.statSync(file).isDirectory()
  } catch {
    return false
  }
}

function workspaceDirectoriesSync(startDir: string): string[] {
  const dirs: string[] = []
  let dir = path.resolve(startDir)

  while (true) {
    if (isWorkspaceDirectorySync(path.join(dir, DOT_APP_DIR_NAME))) dirs.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return dirs.reverse()
}

function parseWorkspaceSettings(raw: string, file: string): WorkspaceSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
    throw new Error(`Invalid workspace settings in ${file}: ${message}`)
  }

  return validateWorkspaceSettings(parsed, file)
}

function validateWorkspaceSettings(parsed: unknown, file: string): WorkspaceSettings {
  if (!isRecord(parsed)) {
    throw new Error(`Invalid workspace settings in ${file}: settings must be an object.`)
  }

  const {mcp, model, provider, providers, tools} = parsed
  const providerOptions = getProvider().join(', ')

  if (provider !== undefined && !isProvider(provider)) {
    throw new Error(`Invalid workspace settings in ${file}: provider must be one of ${providerOptions}.`)
  }

  if (model !== undefined && typeof model !== 'string') {
    throw new Error(`Invalid workspace settings in ${file}: model must be a string.`)
  }

  return {
    ...(typeof model === 'string' ? {model} : {}),
    ...(isProvider(provider) ? {provider} : {}),
    ...(providers === undefined ? {} : {providers: validateProviderSettings(providers, file)}),
    ...(mcp === undefined ? {} : {mcp: validateMcpSettings(mcp, file)}),
    ...(tools === undefined ? {} : {tools: validateToolSettings(tools, file)}),
  }
}

function validateProviderSettings(value: unknown, file: string): ProviderSettings {
  if (!isRecord(value)) {
    throw new Error(`Invalid workspace settings in ${file}: providers must be an object.`)
  }

  const settings: ProviderSettings = {}
  for (const [provider, providerSettings] of Object.entries(value)) {
    if (!isProvider(provider)) {
      throw new Error(`Invalid workspace settings in ${file}: providers.${provider} is not supported.`)
    }

    if (!isRecord(providerSettings)) {
      throw new Error(`Invalid workspace settings in ${file}: providers.${provider} must be an object.`)
    }

    settings[provider] = validateProviderConnectionSettings(providerSettings, file, provider)
  }

  return settings
}

function validateProviderConnectionSettings(
  value: Record<string, unknown>,
  file: string,
  provider: string,
): ProviderConnectionSettings {
  const {apiKey, apiKeyEnv, host} = value
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new Error(`Invalid workspace settings in ${file}: providers.${provider}.apiKey must be a string.`)
  }

  if (apiKeyEnv !== undefined && typeof apiKeyEnv !== 'string') {
    throw new Error(`Invalid workspace settings in ${file}: providers.${provider}.apiKeyEnv must be a string.`)
  }

  if (host !== undefined && typeof host !== 'string') {
    throw new Error(`Invalid workspace settings in ${file}: providers.${provider}.host must be a string.`)
  }

  return {
    ...(typeof apiKey === 'string' ? {apiKey} : {}),
    ...(typeof apiKeyEnv === 'string' ? {apiKeyEnv} : {}),
    ...(typeof host === 'string' ? {host} : {}),
  }
}

function validateMcpSettings(value: unknown, file: string): McpSettings {
  if (!isRecord(value)) {
    throw new Error(`Invalid workspace settings in ${file}: mcp must be an object.`)
  }

  const {servers} = value
  if (servers !== undefined && !isRecord(servers)) {
    throw new Error(`Invalid workspace settings in ${file}: mcp.servers must be an object.`)
  }

  return {
    ...(servers === undefined ? {} : {servers: validateMcpServers(servers, file)}),
  }
}

function validateMcpServers(value: Record<string, unknown>, file: string): Record<string, McpServerSettings> {
  const servers: Record<string, McpServerSettings> = {}

  for (const [name, server] of Object.entries(value)) {
    if (!isRecord(server)) {
      throw new Error(`Invalid workspace settings in ${file}: mcp.servers.${name} must be an object.`)
    }

    const {args, command, env} = server
    if (typeof command !== 'string') {
      throw new TypeError(`Invalid workspace settings in ${file}: mcp.servers.${name}.command must be a string.`)
    }

    if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))) {
      throw new Error(`Invalid workspace settings in ${file}: mcp.servers.${name}.args must be an array of strings.`)
    }

    if (env !== undefined && !isStringRecord(env)) {
      throw new Error(`Invalid workspace settings in ${file}: mcp.servers.${name}.env must be an object of strings.`)
    }

    servers[name] = {
      command,
      ...(Array.isArray(args) ? {args} : {}),
      ...(isStringRecord(env) ? {env} : {}),
    }
  }

  return servers
}

function validateToolSettings(value: unknown, file: string): ToolSettings {
  if (!isRecord(value)) throw new Error(`Invalid workspace settings in ${file}: tools must be an object.`)
  const {exclude, include, profile} = value
  if (profile !== undefined && !isToolProfile(profile)) {
    throw new Error(`Invalid workspace settings in ${file}: tools.profile must be coding or none.`)
  }

  return {
    ...(profile === undefined ? {} : {profile}),
    ...(include === undefined ? {} : {include: validateBuiltinToolNames(include, file, 'include')}),
    ...(exclude === undefined ? {} : {exclude: validateBuiltinToolNames(exclude, file, 'exclude')}),
  }
}

function validateBuiltinToolNames(value: unknown, file: string, field: 'exclude' | 'include') {
  if (!Array.isArray(value) || value.some((name) => !isBuiltinToolName(name))) {
    throw new Error(`Invalid workspace settings in ${file}: tools.${field} must contain built-in tool names.`)
  }

  return value
}

function mergeWorkspaceSettingsInto(target: WorkspaceSettings, source: WorkspaceSettings): void {
  Object.assign(target, {
    ...(source.model === undefined ? {} : {model: source.model}),
    ...(source.provider === undefined ? {} : {provider: source.provider}),
    ...(source.providers === undefined ? {} : {providers: mergeProviderSettings(target.providers, source.providers)}),
    ...(source.mcp === undefined ? {} : {mcp: mergeMcpSettings(target.mcp, source.mcp)}),
    ...(source.tools === undefined ? {} : {tools: {...target.tools, ...source.tools}}),
  })
}

function mergeProviderSettings(current: ProviderSettings | undefined, next: ProviderSettings): ProviderSettings {
  const result: ProviderSettings = {...current}
  for (const [name, settings] of Object.entries(next)) {
    if (settings !== undefined) result[name] = {...current?.[name], ...settings}
  }

  return result
}

function mergeMcpSettings(current: McpSettings | undefined, next: McpSettings): McpSettings {
  return {
    ...current,
    ...(next.servers === undefined
      ? {}
      : {
          servers: {
            ...current?.servers,
            ...Object.fromEntries(
              Object.entries(next.servers).map(([name, server]) => [name, {...current?.servers?.[name], ...server}]),
            ),
          },
        }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}
