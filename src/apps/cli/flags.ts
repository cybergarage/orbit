// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Flags} from '@oclif/core'

import type {AgentOptions} from '../../core/chat.js'

import {getProvider, isProvider} from '../../core/models/index.js'

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
    options: getProvider(),
    required: false,
  }),
}

export function toAgentOptions(flags: {lang?: string; model?: string; provider?: string}): AgentOptions {
  return {
    ...(flags.lang ? {lang: flags.lang} : {}),
    ...(flags.model ? {model: flags.model} : {}),
    ...(isProvider(flags.provider) ? {provider: flags.provider} : {}),
  }
}
