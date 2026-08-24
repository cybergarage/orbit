// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import envPaths from 'env-paths'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface AppConfig {
  appName?: string
}

export let APP_NAME = 'orbit'
export let DOT_APP_DIR_NAME = `.${APP_NAME}`
export const SETTINGS_FILE_NAME = 'settings.json'

export function setAppName(appName: string): void {
  APP_NAME = appName
  DOT_APP_DIR_NAME = `.${APP_NAME}`
}

export function configureApp(config: AppConfig): void {
  if (config.appName !== undefined) setAppName(config.appName)
}

export function getPaths() {
  return envPaths(APP_NAME, {suffix: ''})
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, {recursive: true})
}

export function sessionsDir(): string {
  return path.join(os.homedir(), DOT_APP_DIR_NAME, 'sessions')
}

export function logsDir(): string {
  return path.join(os.homedir(), DOT_APP_DIR_NAME, 'logs')
}
