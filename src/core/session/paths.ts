// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

export function sessionFilePath(rootDir: string, sessionId: string, createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid session timestamp: ${createdAt}`)

  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const fileTimestamp = date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return path.join(rootDir, year, month, day, `session-${fileTimestamp}-${sessionId}.jsonl`)
}
