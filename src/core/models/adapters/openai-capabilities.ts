// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Exact, documented Chat Completions + function-calling compatibility. This is not
// a list of available models: ModelCatalog intersects it with authenticated GET /models.
// Do not infer tools support from context size or future ID prefixes.
// Maintenance sources and exclusions: docs/model-catalog.md.
const toolModels = new Set([
  'gpt-4.1',
  'gpt-4.1-2025-04-14',
  'gpt-4o',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'gpt-4o-mini',
  'gpt-4o-mini-2024-07-18',
  'gpt-5-mini',
  'gpt-5.2',
  'gpt-5.4',
])
export function supportsOpenAIChatTools(model: string): boolean {
  return toolModels.has(model)
}
