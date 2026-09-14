// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

/** Retain failed closes until explicit cleanup confirms that the handles settled. */
export class EvidenceHandles {
  private readonly failed = new Set<() => Promise<void>>()

  check(): void {
    if (this.failed.size > 0) throw new Error('Context evidence cleanup remains unconfirmed')
  }

  async close(close: () => Promise<void>): Promise<void> {
    try {
      await close()
    } catch (error) {
      this.failed.add(close)
      throw error
    }
  }

  ownedIO(io = fs): typeof fs {
    return {
      ...io,
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await io.open(...args)
        const close = handle.close.bind(handle)
        handle.close = () => this.close(close)
        return handle
      },
    }
  }

  async settle(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.failed].map(async (close) => {
        await close()
        this.failed.delete(close)
      }),
    )
    if (results.some((r) => r.status === 'rejected')) throw new Error('Context evidence cleanup remains unconfirmed')
  }
}

/** Compare detectable replacements within this operation; not physical media identity. */
export async function evidencePath(file: string, io = fs): Promise<string> {
  const values = []
  let current = path.resolve(file)
  if ((await io.realpath(current)) !== current) throw new Error('Context evidence path alias changed')
  while (true) {
    // Each ancestor must refer to the same directory before and after the read.
    // eslint-disable-next-line no-await-in-loop
    const stat = await io.lstat(current)
    if (stat.isSymbolicLink() || (current !== file && !stat.isDirectory()))
      throw new Error('Context evidence path identity changed')
    values.push([
      current,
      stat.dev,
      stat.ino,
      current === file ? stat.size : null,
      current === file ? stat.mtimeMs : null,
      current === file ? stat.nlink : null,
    ])
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return JSON.stringify(values)
}
