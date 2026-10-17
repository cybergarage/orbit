// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

import type {InitializationProfile} from '../core/maintenance/initialization.js'

import {logsDir, sessionsDir} from '../core/app.js'

/** Shared CLI/embedded-GUI profile. Never discovers or resets Electron data. */
export function orbitInitializationProfile(settingsFiles: string[] = []): InitializationProfile {
  const logRoot = logsDir()
  const sessionRoot = sessionsDir()
  const root = path.dirname(sessionRoot)
  return {
    cacheRoots: [], // Embedded GUI has no app-owned persistent browser cache.
    ownedRoots: [...new Set([path.dirname(logRoot), root])],
    preservedPaths: [],
    scheduledRoots: [path.join(root, 'gui-scheduled')],
    settingsFiles,
    stores: [
      {journalRoot: path.join(root, 'runs'), logRoot, projectFile: path.join(root, 'projects.sqlite'), sessionRoot},
    ],
  }
}
