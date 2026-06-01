// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {DEFAULT_MODELS, type Provider} from './models/index.js'
import {loadWorkspaceSettings, mergeWorkspaceSettings, type WorkspaceSettings} from './settings.js'

export interface AgentOptions {
  debug?: boolean
  lang?: string
  model?: string
  provider?: Provider
  settings?: WorkspaceSettings
}

export interface ResolvedAgentOptions {
  debug?: boolean
  lang?: string
  model: string
  provider: Provider
  settings: WorkspaceSettings
}

export function resolveAgentOptions(options: AgentOptions, settings: WorkspaceSettings = {}): ResolvedAgentOptions {
  const mergedSettings = mergeWorkspaceSettings(settings, options.settings)
  const provider = options.provider ?? mergedSettings.provider ?? 'ollama'
  const model = options.model ?? mergedSettings.model ?? DEFAULT_MODELS[provider]

  return {
    ...(options.debug === undefined ? {} : {debug: options.debug}),
    lang: options.lang,
    model,
    provider,
    settings: mergeWorkspaceSettings(mergedSettings, {model, provider}),
  }
}

export async function resolveWorkspaceAgentOptions(
  options: AgentOptions,
  cwd: string,
  settingsLoader: typeof loadWorkspaceSettings = loadWorkspaceSettings,
): Promise<ResolvedAgentOptions> {
  const settings = await settingsLoader(cwd)
  return resolveAgentOptions(options, settings)
}
