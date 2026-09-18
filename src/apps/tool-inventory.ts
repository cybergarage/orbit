// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Flags} from '@oclif/core'

import {loadWorkspaceSettings} from '../core/settings.js'
import {formatToolInventory, inspectTools} from '../core/tools/inventory.js'
import {confirmOperation} from './approval.js'

export const inventoryFlags = {
  connect: Flags.boolean({description: 'Start configured MCP servers to discover tools, subject to execution policy'}),
  'execution-policy': Flags.string({
    default: 'workspace-confirm',
    description: 'MCP startup policy',
    options: ['workspace-confirm', 'unrestricted'],
  }),
  json: Flags.boolean({description: 'Print JSON metadata'}),
}

export async function runInventoryCommand(
  view: 'mcp' | 'tools',
  flags: {connect: boolean; 'execution-policy': string; json: boolean},
): Promise<{complete: boolean; output: string}> {
  const controller = new AbortController()
  const stop = () => controller.abort('user')
  process.on('SIGINT', stop)
  try {
    const inventory = await inspectTools({
      approve: (request) => confirmOperation(request, controller.signal),
      connect: flags.connect,
      cwd: process.cwd(),
      executionPolicy: flags['execution-policy'] as 'unrestricted' | 'workspace-confirm',
      settings: await loadWorkspaceSettings(),
      signal: controller.signal,
    })
    const value = view === 'mcp' ? {...inventory, tools: undefined} : inventory
    return {
      complete: inventory.complete,
      output: flags.json ? JSON.stringify(value) : formatToolInventory(inventory, view),
    }
  } finally {
    process.removeListener('SIGINT', stop)
  }
}
