// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

const providers = ['anthropic', 'ollama', 'openai'] as const

export type Provider = (typeof providers)[number]

export function getProvider(): Provider[] {
  return [...providers]
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && providers.includes(value as Provider)
}
