// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {DEFAULT_MODELS, type Provider} from './models/index.js'
import {loadWorkspaceSettings, type WorkspaceSettings} from './settings.js'

export interface AgentOptions {
  lang?: string
  model?: string
  provider?: Provider
}

export interface ResolvedAgentOptions {
  lang?: string
  model: string
  provider: Provider
}

export function resolveAgentOptions(options: AgentOptions, settings: WorkspaceSettings = {}): ResolvedAgentOptions {
  const provider = options.provider ?? settings.provider ?? 'ollama'

  return {
    lang: options.lang,
    model: options.model ?? settings.model ?? DEFAULT_MODELS[provider],
    provider,
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
