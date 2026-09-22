// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command, Flags} from '@oclif/core'
import path from 'node:path'
import process from 'node:process'

import {type AgentOptions, resolveAgentOptions, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadSystemContexts} from '../../core/context.js'
import {
  loadWorkspaceSettingsWithSources,
  Message,
  MessageType,
  OrbitApplicationService,
  Role,
  sessionsDir,
  SqliteProjectStore,
} from '../../core/index.js'
import {agentFlags, toAgentOptions} from '../cli-flags.js'
import {startGuiServer} from '../gui/server.js'
import {productSkillCatalog} from '../skill-catalog.js'

export async function runGuiCommand(options: AgentOptions & {port?: number; version?: string}): Promise<void> {
  const cwd = process.cwd()
  const resolved = await resolveWorkspaceAgentOptions(options, cwd)
  const projectStore = await SqliteProjectStore.open({file: path.join(path.dirname(sessionsDir()), 'projects.sqlite')})
  const service = await OrbitApplicationService.create({
    cwd,
    execution: {
      journalLevel: resolved.journalLevel,
      policy: {generation: 'product-v1', profile: resolved.executionPolicy ?? 'workspace-confirm', roots: [cwd]},
    },
    logLevel: resolved.debug ? 'debug' : 'info',
    model: resolved.model,
    projectStore,
    provider: resolved.provider,
    async resolveProjectRuntime(directory) {
      const loaded = await loadWorkspaceSettingsWithSources(directory)
      const projectResolved = resolveAgentOptions(
        {
          ...options,
          model:
            options.model ??
            loaded.settings.model ??
            (loaded.settings.provider && loaded.settings.provider !== resolved.provider ? undefined : resolved.model),
          provider: options.provider ?? loaded.settings.provider ?? resolved.provider,
        },
        loaded.settings,
      )
      const contexts = await loadSystemContexts(directory)
      const content = contexts.map((item) => item.content).join('\n\n')
      return {
        contextPolicy: projectResolved.settings.contextPolicy,
        cwd: directory,
        execution: {
          journalLevel: projectResolved.journalLevel,
          policy: {
            generation: 'product-v1',
            profile: projectResolved.executionPolicy ?? 'workspace-confirm',
            roots: [directory],
          },
        },
        messages: content ? [new Message(MessageType.Session, {content, role: Role.System})] : [],
        model: {name: projectResolved.model, provider: projectResolved.provider},
        settings: projectResolved.settings,
        skillCatalog: await productSkillCatalog(directory, options.skillRoots),
      }
    },
    settings: resolved.settings,
    skillCatalog: await productSkillCatalog(cwd, options.skillRoots),
    version: options.version,
  }).catch(async (error: unknown) => {
    await projectStore.close()
    throw error
  })
  const server = await startGuiServer({port: options.port, service}).catch(async (error: unknown) => {
    await service.close()
    throw error
  })
  try {
    process.stdout.write(`Orbit GUI: ${server.url}\n`)
    await waitForShutdown()
  } finally {
    await server.close()
    await service.close()
  }
}

export default class Gui extends Command {
  static description = 'Start the local Orbit graphical interface'
  static flags = {
    ...agentFlags,
    port: Flags.integer({
      description: 'Loopback port (uses an available port by default)',
      min: 0,
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Gui)
    try {
      await runGuiCommand({...toAgentOptions(flags), port: flags.port, version: this.config.version})
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'GUI startup failed.')
    }
  }
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      resolve()
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
