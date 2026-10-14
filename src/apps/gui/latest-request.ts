// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Prevent older reads from replacing a newer authoritative response. */
export class LatestRequest {
  private revision = 0

  invalidate(): void {
    this.revision++
  }

  async read<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    const revision = ++this.revision
    try {
      const value = await load()
      if (revision === this.revision) apply(value)
    } catch (error) {
      if (revision === this.revision) throw error
    }
  }
}
