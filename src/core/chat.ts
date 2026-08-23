// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {selectOllamaModel} from './models/adapters/ollama.js'
import {DEFAULT_MODELS, type ProviderName} from './models/index.js'
import {createProvider} from './models/provider.js'
import {loadWorkspaceSettings, mergeWorkspaceSettings, type WorkspaceSettings} from './settings.js'

export interface AgentOptions {
  debug?: boolean
  lang?: string
  model?: string
  provider?: ProviderName
  settings?: WorkspaceSettings
}

export interface ResolvedAgentOptions {
  debug?: boolean
  lang?: string
  model: string
  provider: ProviderName
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
  ollamaModelSelector: typeof selectOllamaModel = selectOllamaModel,
): Promise<ResolvedAgentOptions> {
  const settings = await settingsLoader(cwd)
  const resolved = resolveAgentOptions(options, settings)
  if (resolved.provider !== 'ollama') return resolved

  const requestedModel = options.model ?? mergeWorkspaceSettings(settings, options.settings).model
  const model = await ollamaModelSelector(createProvider('ollama', resolved.settings), {
    defaultModel: DEFAULT_MODELS.ollama,
    ...(requestedModel === undefined ? {} : {requestedModel}),
  })
  return resolveAgentOptions({...options, model}, settings)
}
