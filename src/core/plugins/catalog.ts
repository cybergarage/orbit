// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop, no-template-curly-in-string */
import fs from 'node:fs/promises'
import path from 'node:path'

import type {McpServerSettings} from '../settings.js'
import type {SkillRoot} from '../skills/catalog.js'

import {canonicalPath} from '../execution/authorization.js'
import {canonicalJSON, copyJSON} from '../execution/journal.js'
import {SkillCatalog} from '../skills/catalog.js'
import {skillDigest} from '../skills/parser.js'
import {contained, packagePath, readPackageFile} from './files.js'

export const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
const JSON_LIMIT = 1_048_576
export interface PluginInstance {
  directory: string
  id: string
}
export interface PluginDiagnostic {
  code: string
  instance: string
  scope: 'mcp' | 'plugin' | 'server' | 'skills'
  server?: string
}
export interface PluginManifest {
  $schema: string
  author?: {email?: string; name?: string; url?: string}
  description?: string
  homepage?: string
  keywords?: string[]
  license?: string
  name: string
  repository?: string
  version?: string
}
export interface PluginStartup {
  command: string
  cwd: string
  cwdSource: string
  data: string
  dataRoot: string
  digest: string
  id: string
  manifestDigest: string
  mcpDigest: string
  root: string
  server: string
}
export interface PluginInspection {
  complete: boolean
  diagnostics: PluginDiagnostic[]
  plugins: Array<{data: string; digest: string; id: string; manifest: PluginManifest; root: string}>
  servers: Record<string, McpServerSettings>
  skillRoots: SkillRoot[]
}
export interface LoadedPlugins {
  readonly inspection: PluginInspection
  readonly skillCatalog: SkillCatalog
  validate(): Promise<void>
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): value is Record<string, string> =>
  record(value) && Object.values(value).every((v) => typeof v === 'string')
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((k) => allowed.includes(k))
const idPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u

function manifest(value: unknown, report: (code: string) => void): PluginManifest {
  if (
    !record(value) ||
    value.$schema !== PLUGIN_SCHEMA ||
    typeof value.name !== 'string' ||
    value.name.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(value.name) ||
    /--|\.\./u.test(value.name)
  )
    throw new Error('invalid-manifest')
  const allowed = new Set([
    '$schema',
    'author',
    'description',
    'extensions',
    'homepage',
    'keywords',
    'license',
    'name',
    'repository',
    'version',
  ])
  for (const k of Object.keys(value)) if (!allowed.has(k)) report('ignored-manifest-field')
  for (const k of ['version', 'description', 'homepage', 'repository', 'license'])
    if (value[k] !== undefined && typeof value[k] !== 'string') throw new Error('invalid-manifest')
  if (value.author !== undefined && (!strings(value.author) || !keys(value.author, ['name', 'email', 'url'])))
    throw new Error('invalid-manifest')
  if (
    value.keywords !== undefined &&
    (!Array.isArray(value.keywords) || !value.keywords.every((k) => typeof k === 'string'))
  )
    throw new Error('invalid-manifest')
  if (value.extensions !== undefined && !record(value.extensions)) report('ignored-extensions')
  // Client namespaces are intentionally inert, including their unvalidated values.
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => allowed.has(k) && k !== 'extensions'),
  ) as unknown as PluginManifest
}

function validateServer(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error('invalid-server')
  if (value.type === 'stdio') {
    if (
      !keys(value, ['type', 'command', 'args', 'env', 'cwd']) ||
      typeof value.command !== 'string' ||
      !value.command ||
      /[\0\r\n]/u.test(value.command)
    )
      throw new Error('invalid-server')
    const {command} = value
    if (
      !command.startsWith('./') &&
      (/[\\/\s]/u.test(command) ||
        command === '.' ||
        command === '..' ||
        command.includes(':') ||
        command.includes('${'))
    )
      throw new Error('invalid-command')
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((a) => typeof a === 'string')))
      throw new Error('invalid-args')
    if (value.env !== undefined && !strings(value.env)) throw new Error('invalid-env')
    if (
      value.env &&
      Object.keys(value.env).some((k) =>
        ['PLUGIN_DATA', 'PLUGIN_ROOT'].includes(process.platform === 'win32' ? k.toUpperCase() : k),
      )
    )
      throw new Error('reserved-env')
    if (
      value.cwd !== undefined &&
      (typeof value.cwd !== 'string' ||
        (!['./', '${PLUGIN_ROOT}/', '${PLUGIN_DATA}/'].some((prefix) => (value.cwd as string).startsWith(prefix)) &&
          !['${PLUGIN_DATA}', '${PLUGIN_ROOT}'].includes(value.cwd)))
    )
      throw new Error('invalid-cwd')
  } else if (value.type === 'streamable-http' || value.type === 'sse') {
    if (!keys(value, ['type', 'url', 'headers']) || typeof value.url !== 'string') throw new Error('invalid-server')
    const url = new URL(value.url)
    const host = url.hostname.replaceAll(/^\[|\]$/gu, '')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol === 'http:' && host !== 'localhost' && host !== '::1' && !/^127(?:\.\d{1,3}){3}$/u.test(host))
    )
      throw new Error('invalid-url')
    if (value.headers !== undefined) {
      if (!strings(value.headers)) throw new Error('invalid-headers')
      const seen = new Set<string>()
      for (const [k, v] of Object.entries(value.headers)) {
        if (
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(k) ||
          /[^\t\u0020-\u007E\u0080-\u00FF]/u.test(v) ||
          seen.has(k.toLowerCase())
        )
          throw new Error('invalid-headers')
        seen.add(k.toLowerCase())
      }
    }
  } else throw new Error('invalid-transport')
  return value
}

export function expandPluginValue(value: string, root: string, data: string): string {
  return value.replaceAll(/\$\{PLUGIN_(ROOT|DATA)\}/gu, (_match, key: string) => (key === 'ROOT' ? root : data))
}

export function pluginServerName(id: string, server: string): string {
  return `plugin:${id}:${server}`
}

/** Explicit local packages only. Inspection never launches code or creates data directories. */
export class PluginCatalog {
  private readonly dataRoot: string
  private readonly instances: readonly PluginInstance[]

  constructor(instances: readonly PluginInstance[], options: {dataRoot: string}) {
    if (!options.dataRoot || instances.length > 64) throw new Error('Invalid plugin configuration or instance limit')
    this.dataRoot = path.resolve(options.dataRoot)
    const seen = new Set<string>()
    this.instances = instances.map(({directory, id}) => {
      if (!idPattern.test(id) || seen.has(id) || !directory) throw new Error('Invalid or duplicate plugin instance ID')
      seen.add(id)
      return {directory: path.resolve(directory), id}
    })
  }

  async inspect(): Promise<PluginInspection> {
    const result: PluginInspection = {
      complete: true,
      diagnostics: [],
      plugins: [],
      servers: Object.create(null),
      skillRoots: [],
    }
    const dataRoot = await canonicalPath(this.dataRoot)
    for (const instance of this.instances) {
      const report = (scope: PluginDiagnostic['scope'], code: string, server?: string) => {
        result.diagnostics.push({code, instance: instance.id, scope, ...(server === undefined ? {} : {server})})
        if (!code.startsWith('ignored-') && code !== 'unsupported-transport') result.complete = false
      }

      let root: string
      let metadata: PluginManifest
      let manifestDigest: string
      let data: string
      try {
        root = await fs.realpath(instance.directory)
        if (!(await fs.stat(root)).isDirectory() || contained(root, dataRoot)) throw new Error('invalid-root')
        data = await canonicalPath(path.join(dataRoot, instance.id))
        if (!contained(dataRoot, data) || data === dataRoot || contained(root, data))
          throw new Error('invalid-data-root')
        const source = await readPackageFile(root, path.join(root, 'plugin.json'), JSON_LIMIT)
        metadata = manifest(JSON.parse(source), (code) => report('plugin', code))
        manifestDigest = skillDigest(source)
      } catch (error) {
        report(
          'plugin',
          error instanceof Error && error.message === 'Package byte limit exceeded'
            ? 'plugin-byte-limit'
            : 'invalid-plugin',
        )
        continue
      }

      let mcpDigest = ''
      const servers: Array<[string, Record<string, unknown>]> = []
      try {
        const file = path.join(root, 'mcp.json')
        try {
          await fs.lstat(file)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          throw new MissingComponent()
        }

        const source = await readPackageFile(root, file, JSON_LIMIT)
        mcpDigest = skillDigest(source)
        const config: unknown = JSON.parse(source)
        if (
          !record(config) ||
          !keys(config, ['$schema', 'mcpServers']) ||
          config.$schema !== PLUGIN_MCP_SCHEMA ||
          !record(config.mcpServers)
        )
          throw new Error('invalid-mcp')
        if (Object.keys(config.mcpServers).length > 256) throw new Error('server-limit')
        for (const [name, value] of Object.entries(config.mcpServers)) {
          try {
            const checked = validateServer(value)
            if (checked.type === 'stdio') {
              servers.push([name, checked])
            } else {
              report('server', 'unsupported-transport', name)
            }
          } catch {
            report('server', 'invalid-server', name)
          }
        }
      } catch (error) {
        if (!(error instanceof MissingComponent)) {
          const code =
            error instanceof Error && error.message === 'server-limit'
              ? 'server-limit'
              : error instanceof Error && error.message === 'Package byte limit exceeded'
                ? 'mcp-byte-limit'
                : 'invalid-mcp'
          report('mcp', code)
        }
      }

      const digest = skillDigest(canonicalJSON({data, id: instance.id, manifestDigest, mcpDigest, root}))
      result.plugins.push({data, digest, id: instance.id, manifest: metadata, root})
      try {
        const location = path.join(root, 'skills')
        try {
          await fs.lstat(location)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          throw new MissingComponent()
        }

        const directory = await packagePath(root, location, 'directory')
        result.skillRoots.push({directory, id: `plugin-${instance.id}`, plugin: {digest, id: instance.id, root}})
      } catch (error) {
        if (!(error instanceof MissingComponent)) report('skills', 'invalid-skills')
      }

      for (const [name, value] of servers) {
        try {
          const command = value.command as string
          const cwd = (value.cwd as string | undefined) ?? '${PLUGIN_ROOT}'
          const resolvedCwd = await canonicalPath(
            cwd.startsWith('./') ? path.resolve(root, cwd) : expandPluginValue(cwd, root, data),
          )
          if (!contained(cwd.startsWith('${PLUGIN_DATA}') ? data : root, resolvedCwd)) throw new Error('cwd-escape')
          const resolvedCommand = command.startsWith('./')
            ? await packagePath(root, path.resolve(root, command), 'file')
            : command
          const env = Object.fromEntries(
            Object.entries((value.env ?? {}) as Record<string, string>).map(([k, v]) => [
              k,
              expandPluginValue(v, root, data),
            ]),
          )
          result.servers[pluginServerName(instance.id, name)] = {
            args: ((value.args ?? []) as string[]).map((a) => expandPluginValue(a, root, data)),
            command: resolvedCommand,
            env: {...env, PLUGIN_DATA: data, PLUGIN_ROOT: root},
            plugin: {
              command,
              cwd: resolvedCwd,
              cwdSource: cwd,
              data,
              dataRoot,
              digest,
              id: instance.id,
              manifestDigest,
              mcpDigest,
              root,
              server: name,
            },
          }
        } catch {
          report('server', 'invalid-server-path', name)
        }
      }
    }

    return copyJSON(result)
  }

  async load(existing?: SkillCatalog): Promise<LoadedPlugins> {
    const inspected = await this.inspect()
    const binding = canonicalJSON(inspected)
    const skillCatalog = existing ? existing.withRoots(inspected.skillRoots) : new SkillCatalog(inspected.skillRoots)
    return {
      get inspection() {
        return copyJSON(inspected)
      },
      skillCatalog,
      validate: async () => {
        if (canonicalJSON(await this.inspect()) !== binding)
          throw new Error('Plugin catalog changed; reload before starting a Run')
      },
    }
  }

  async readResource(id: string, relative: string, limit = 65_536): Promise<string> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > JSON_LIMIT || !relative || path.isAbsolute(relative))
      throw new Error('Invalid resource request')
    const inspected = await this.inspect()
    const plugin = inspected.plugins.find((p) => p.id === id)
    if (!plugin) throw new Error('Plugin is unavailable')
    const file = path.resolve(plugin.root, relative)
    if (!contained(plugin.root, file)) throw new Error('Package resource escapes')
    return readPackageFile(plugin.root, file, limit)
  }
}
class MissingComponent extends Error {}

/** Validate package bindings again immediately before a managed startup. */
export async function validatePluginStartup(plugin: PluginStartup, command: string): Promise<boolean> {
  try {
    if (
      (await fs.realpath(plugin.root)) !== plugin.root ||
      !contained(plugin.dataRoot, await canonicalPath(plugin.data)) ||
      (await canonicalPath(plugin.dataRoot)) !== plugin.dataRoot
    )
      return false
    if (
      skillDigest(await readPackageFile(plugin.root, path.join(plugin.root, 'plugin.json'), JSON_LIMIT)) !==
        plugin.manifestDigest ||
      skillDigest(await readPackageFile(plugin.root, path.join(plugin.root, 'mcp.json'), JSON_LIMIT)) !==
        plugin.mcpDigest
    )
      return false
    const sourceCwd = plugin.cwdSource.startsWith('./')
      ? path.resolve(plugin.root, plugin.cwdSource)
      : expandPluginValue(plugin.cwdSource, plugin.root, plugin.data)
    if ((await fs.realpath(sourceCwd)) !== plugin.cwd) return false
    const cwd = await fs.realpath(plugin.cwd)
    if (cwd !== plugin.cwd || ![plugin.root, plugin.data].some((root) => contained(root, cwd))) return false
    if (plugin.command.startsWith('./') &&
      (await packagePath(plugin.root, path.resolve(plugin.root, plugin.command), 'file')) !== command) return false
    return true
  } catch {
    return false
  }
}
