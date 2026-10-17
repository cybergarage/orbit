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
    if (error.cause?.code === 'ECONNREFUSED' && !env.ORBIT_TEST_OLLAMA_MODEL?.trim()) return
    throw error
  }

  if (!response.ok) throw new Error(`Local Ollama model discovery failed: HTTP ${response.status}`)
  const {models} = await response.json()
  const names = [...new Set(models.map((model) => model.model || model.name).filter(Boolean))]
  const requested = env.ORBIT_TEST_OLLAMA_MODEL?.trim()
  const installed = requested && names.find((name) => name === requested || name === `${requested}:latest`)
  if (requested && !installed) throw new Error('The requested ORBIT_TEST_OLLAMA_MODEL is not installed locally')

  for (const model of installed ? [installed] : names) {
    const details = await request('http://127.0.0.1:11434/api/show', {
      body: JSON.stringify({model}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    })
    if (!details.ok) throw new Error(`Local Ollama capability discovery failed: HTTP ${details.status}`)
    if ((await details.json()).capabilities?.includes('tools')) return model
  }

  if (requested) throw new Error('The requested ORBIT_TEST_OLLAMA_MODEL does not report tool support')
}
