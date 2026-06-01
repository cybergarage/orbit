// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Flags} from '@oclif/core'

import type {AgentOptions} from '../../core/chat.js'

import {getProvider, isProvider} from '../../core/index.js'

export const agentFlags = {
  'anthropic-api-key-env': Flags.string({
    description: 'Environment variable name for the Anthropic API key',
    required: false,
  }),
  debug: Flags.boolean({
    description: 'Enable debug logging',
    required: false,
  }),
  lang: Flags.string({
    description: 'Output language',
    options: ['en', 'ja'],
    required: false,
  }),
  model: Flags.string({
    description: 'Model name (overrides workspace setting and provider default)',
    required: false,
  }),
  'ollama-host': Flags.string({
    description: 'Ollama host URL',
    required: false,
  }),
  'openai-api-key-env': Flags.string({
    description: 'Environment variable name for the OpenAI API key',
    required: false,
  }),
  provider: Flags.string({
    description: 'LLM provider (overrides workspace setting)',
    options: getProvider(),
    required: false,
  }),
}

export function toAgentOptions(flags: {
  anthropicApiKeyEnv?: string
  debug?: boolean
  lang?: string
  model?: string
  ollamaHost?: string
  openaiApiKeyEnv?: string
  provider?: string
}): AgentOptions {
  return {
    ...(flags.debug ? {debug: true} : {}),
    ...(flags.lang ? {lang: flags.lang} : {}),
    ...(flags.model ? {model: flags.model} : {}),
    ...(isProvider(flags.provider) ? {provider: flags.provider} : {}),
    ...(flags.anthropicApiKeyEnv || flags.ollamaHost || flags.openaiApiKeyEnv
      ? {
          settings: {
            providers: {
              ...(flags.anthropicApiKeyEnv ? {anthropic: {apiKeyEnv: flags.anthropicApiKeyEnv}} : {}),
              ...(flags.ollamaHost ? {ollama: {host: flags.ollamaHost}} : {}),
              ...(flags.openaiApiKeyEnv ? {openai: {apiKeyEnv: flags.openaiApiKeyEnv}} : {}),
            },
          },
        }
      : {}),
  }
}
