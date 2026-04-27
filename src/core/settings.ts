// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import {DOT_APP_DIR_NAME} from './app.js'
import {getProvider, isProvider, type Provider} from './models/index.js'
import {findWorkspaceRoot} from './workspace.js'

export interface WorkspaceSettings {
  model?: string
  provider?: Provider
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

export async function loadWorkspaceSettings(startDir: string): Promise<WorkspaceSettings> {
  const root = await findWorkspaceRoot(startDir)
  const preferredFile = path.join(root, DOT_APP_DIR_NAME, 'settings.json')
  const fallbackFile = path.join(root, 'settings.json')
  const files = [preferredFile, fallbackFile]
  const [preferredRaw, fallbackRaw] = await Promise.all(files.map(async (file) => readIfExists(file)))
  const matches = [
    {file: preferredFile, raw: preferredRaw},
    {file: fallbackFile, raw: fallbackRaw},
  ]

  for (const {file, raw} of matches) {
    if (!raw) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid workspace settings in ${file}: ${message}`)
    }

    const settings = parsed as Record<string, unknown>
    const {provider} = settings
    const {model} = settings
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
    }
  }

  return {}
}
