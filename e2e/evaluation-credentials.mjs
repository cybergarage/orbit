// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function credentialName(provider) {
  if (!['anthropic', 'openai'].includes(provider)) throw new Error('Unsupported cloud provider')
  return `ORBIT_TEST_${provider.toUpperCase()}_API_KEY`
}

export async function stageCredential(provider, env = process.env) {
  const key = env[credentialName(provider)]
  if (!key?.trim()) throw new Error('Missing dedicated cloud evaluation credential')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-evaluation-key-'))
  await fs.chmod(directory, 0o700)
  const file = path.join(directory, 'key')
  try {
    // Private parent protects the host copy; the container's node user must read
    // the root-owned copy and unlink it from its own /credential directory.
    await fs.writeFile(file, key, {mode: 0o644})
    await fs.chmod(file, 0o644)
    return {cleanup: () => fs.rm(directory, {force: true, recursive: true}), file}
  } catch (error) {
    await fs.rm(directory, {force: true, recursive: true})
    throw error
  }
}

export async function consumeCredential(file, provider) {
  let key
  try {
    key = await fs.readFile(file, 'utf8')
  } finally {
    await fs.rm(file, {force: true})
  }

  if (!key?.trim()) throw new Error('Empty cloud evaluation credential')
  return {[credentialName(provider)]: key}
}
