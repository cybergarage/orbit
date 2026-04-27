// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import envPaths from 'env-paths'
import fs from 'node:fs/promises'
import path from 'node:path'

export const APP_NAME = 'orbit'
export const DOT_APP_DIR_NAME = `.${APP_NAME}`

export function getPaths() {
  return envPaths(APP_NAME, {suffix: ''})
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, {recursive: true})
}

export function sessionsDir(): string {
  const p = getPaths()
  return path.join(p.data, 'sessions')
}
