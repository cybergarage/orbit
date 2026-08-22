// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Command, Flags} from '@oclif/core'
import process from 'node:process'

import {type AgentOptions, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {createLogger, OrbitApplicationService} from '../../core/index.js'
import {agentFlags, toAgentOptions} from '../cli-flags.js'
import {startGuiServer} from '../gui/server.js'

export async function runGuiCommand(options: AgentOptions & {port?: number; version?: string}): Promise<void> {
  const cwd = process.cwd()
  const resolved = await resolveWorkspaceAgentOptions(options, cwd)
  const logger = createLogger({destination: process.stderr, level: resolved.debug ? 'debug' : 'info'})
  const service = await OrbitApplicationService.create({
    cwd,
    logger,
    model: resolved.model,
    provider: resolved.provider,
    settings: resolved.settings,
    version: options.version,
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
