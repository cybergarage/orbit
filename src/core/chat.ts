// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {selectOllamaModel} from './models/adapters/ollama.js'
import {DEFAULT_MODELS, type ProviderName} from './models/index.js'
import {createProvider} from './models/provider.js'
import {loadWorkspaceSettings, mergeWorkspaceSettings, type WorkspaceSettings} from './settings.js'

export interface AgentOptions {
  debug?: boolean
  executionPolicy?: 'unrestricted' | 'workspace-confirm'
  journalLevel?: 'file-and-directory-sync' | 'file-sync'
  lang?: string
  model?: string
  provider?: ProviderName
  settings?: WorkspaceSettings
  skillRoots?: string[]
}

export interface ResolvedAgentOptions {
  debug?: boolean
  executionPolicy?: 'unrestricted' | 'workspace-confirm'
  journalLevel?: 'file-and-directory-sync' | 'file-sync'
  lang?: string
  model: string
  provider: ProviderName
  settings: WorkspaceSettings
}

export function resolveAgentOptions(options: AgentOptions, settings: WorkspaceSettings = {}): ResolvedAgentOptions {
  const mergedSettings = mergeWorkspaceSettings(settings, options.settings)
  const provider = options.provider ?? mergedSettings.provider ?? 'ollama'
  const model = options.model ?? mergedSettings.model ?? DEFAULT_MODELS[provider]
  if (model === undefined) throw new Error(`No model specified for provider: ${provider}`)

  return {
    ...(options.debug === undefined ? {} : {debug: options.debug}),
    ...(options.executionPolicy === undefined ? {} : {executionPolicy: options.executionPolicy}),
    ...(options.journalLevel === undefined ? {} : {journalLevel: options.journalLevel}),
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
  const mergedSettings = mergeWorkspaceSettings(settings, options.settings)
  const provider = options.provider ?? mergedSettings.provider ?? 'ollama'
  if (provider !== 'ollama') return resolveAgentOptions(options, settings)

  const requestedModel = options.model ?? mergedSettings.model
  const providerSettings = mergeWorkspaceSettings(mergedSettings, {provider})
  const model = await ollamaModelSelector(createProvider('ollama', providerSettings), {
    ...(requestedModel === undefined ? {} : {requestedModel}),
  })
  return resolveAgentOptions({...options, model, provider}, settings)
}
