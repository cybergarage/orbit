// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Memory, MemoryEntry} from './memory.js'

export class PromptMemory implements Memory {
  private readonly entries: MemoryEntry[] = []

  add(entry: MemoryEntry): void {
    this.entries.push(entry)
  }

  query(_question: string): MemoryEntry[] {
    return [...this.entries]
  }
}
