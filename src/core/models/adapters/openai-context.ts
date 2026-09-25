// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ModelContextInfo} from '../context-capacity.js'

import {unknownModelContextInfo} from '../context-capacity.js'

// Official model specifications checked 2026-09-25. Exact IDs only: do not infer
// limits for fine-tunes, arbitrary snapshots, or similarly named future models.
// Sources and maintenance policy: docs/model-context-capacity.md.
const limits: Readonly<Record<string, readonly [number, number]>> = {
  'gpt-4.1': [1_047_576, 32_768],
  'gpt-4.1-2025-04-14': [1_047_576, 32_768],
  'gpt-4o': [128_000, 16_384],
  'gpt-4o-2024-08-06': [128_000, 16_384],
  'gpt-4o-2024-11-20': [128_000, 16_384],
  'gpt-4o-mini': [128_000, 16_384],
  'gpt-4o-mini-2024-07-18': [128_000, 16_384],
  'gpt-5-mini': [400_000, 128_000],
  'gpt-5.2': [400_000, 128_000],
  'gpt-5.4': [1_050_000, 128_000],
}

export function openAIContextInfo(model: string, runtimeContextWindow: null | number): ModelContextInfo {
  const limit = Object.hasOwn(limits, model) ? limits[model] : undefined
  return {
    ...unknownModelContextInfo(),
    ...(limit ? {contextWindow: limit[0], maxOutputTokens: limit[1], source: 'catalog' as const} : {}),
    runtimeContextWindow,
  }
}
