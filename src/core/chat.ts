// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Flags} from '@oclif/core'

import {DEFAULT_MODELS, type Provider} from './agent.js'
import {loadWorkspaceSettings, type WorkspaceSettings} from './settings.js'

export const LANG_INSTRUCTIONS: Record<string, string> = {
  en: 'IMPORTANT: You MUST respond in English only. Do not use any other language, regardless of the language used in the rest of this prompt or in the user message.',
  ja: 'IMPORTANT: You MUST respond in Japanese only. Do not use any other language, regardless of the language used in the rest of this prompt or in the user message.',
}

export const agentFlags = {
  lang: Flags.string({
    description: 'Output language',
    options: ['en', 'ja'],
    required: false,
  }),
  model: Flags.string({
    description: 'Model name (overrides workspace setting and provider default)',
    required: false,
  }),
  provider: Flags.string({
    description: 'LLM provider (overrides workspace setting)',
    options: ['ollama', 'anthropic', 'openai'],
    required: false,
  }),
}

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

export interface AgentFlagOptions {
  lang?: string
  model?: string
  provider?: Provider
}

export function buildSystemPrompt(contextText: string, lang?: string): string | undefined {
  const langInstruction = lang ? LANG_INSTRUCTIONS[lang] : undefined
  if (!contextText && !langInstruction) return undefined
  if (!contextText) return langInstruction
  if (!langInstruction) return contextText
  return `${langInstruction}\n\n${contextText}`
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
