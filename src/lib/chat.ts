// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Flags} from '@oclif/core'

import type {Provider} from './agent.js'

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
    description: 'Model name (overrides provider default)',
    required: false,
  }),
  provider: Flags.string({
    default: 'ollama',
    description: 'LLM provider',
    options: ['ollama', 'anthropic', 'openai'],
  }),
}

export interface AgentOptions {
  lang?: string
  model?: string
  provider: Provider
}

export function buildSystemPrompt(contextText: string, lang?: string): string | undefined {
  const langInstruction = lang ? LANG_INSTRUCTIONS[lang] : undefined
  if (!contextText && !langInstruction) return undefined
  if (!contextText) return langInstruction
  if (!langInstruction) return contextText
  return `${langInstruction}\n\n${contextText}`
}
