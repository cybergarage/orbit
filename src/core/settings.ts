// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {DOT_APP_DIR_NAME, SETTINGS_FILE_NAME} from './app.js'
import {getProvider, isProvider, type Provider} from './models/index.js'
import {findWorkspaceDirectories} from './workspace.js'

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

export async function loadWorkspaceSettings(startDir = process.cwd()): Promise<WorkspaceSettings> {
  const mergedSettings: WorkspaceSettings = {}
  const directories = await findWorkspaceDirectories(startDir)

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

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid workspace settings in ${file}: ${message}`)
    }

    const parsedSettings = parsed as Record<string, unknown>
    const {provider} = parsedSettings
    const {model} = parsedSettings
    const providerOptions = getProvider().join(', ')

    if (provider !== undefined && !isProvider(provider)) {
      throw new Error(`Invalid workspace settings in ${file}: provider must be one of ${providerOptions}.`)
    }

    if (model !== undefined && typeof model !== 'string') {
      throw new Error(`Invalid workspace settings in ${file}: model must be a string.`)
    }

    Object.assign(mergedSettings, {
      ...(typeof model === 'string' ? {model} : {}),
      ...(isProvider(provider) ? {provider} : {}),
    })
  }

  return mergedSettings
}
