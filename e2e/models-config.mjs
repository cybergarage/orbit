// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export function cloudModelConfig(provider, env = process.env) {
  const prefix = `ORBIT_TEST_${provider.toUpperCase()}`
  const apiKeyEnv = `${prefix}_API_KEY`
  if (!env[apiKeyEnv]?.trim()) return
  return {model: env[`${prefix}_MODEL`]?.trim() || undefined, settings: {providers: {[provider]: {apiKeyEnv}}}}
}

// Probe only the local default endpoint; ordinary provider settings are not loaded.
export async function localOllamaModel(env = process.env, request = fetch) {
  let response
  try {
    response = await request('http://127.0.0.1:11434/api/tags', {signal: AbortSignal.timeout(3000)})
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return
    throw error
  }

  if (!response.ok) throw new Error(`Local Ollama model discovery failed: HTTP ${response.status}`)
  const {models} = await response.json()
  const names = models.map((model) => model.model || model.name).filter(Boolean)
  const requested = env.ORBIT_TEST_OLLAMA_MODEL?.trim()
  if (requested) {
    const installed = names.find((name) => name === requested || name === `${requested}:latest`)
    if (!installed) throw new Error('The requested ORBIT_TEST_OLLAMA_MODEL is not installed locally')
    return installed
  }

  return names[0]
}
