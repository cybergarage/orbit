// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import envPaths from 'env-paths'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface AppConfig {
  appName?: string
  dotAppDirName?: string
}

export let APP_NAME = 'orbit'
export let DOT_APP_DIR_NAME = `.${APP_NAME}`

export function setAppName(appName: string): void {
  APP_NAME = appName
  DOT_APP_DIR_NAME = `.${APP_NAME}`
}

export function setDotAppDirName(dotAppDirName: string): void {
  DOT_APP_DIR_NAME = dotAppDirName
}

export function configureApp(config: AppConfig): void {
  if (config.appName !== undefined) setAppName(config.appName)
  if (config.dotAppDirName !== undefined) setDotAppDirName(config.dotAppDirName)
}

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
