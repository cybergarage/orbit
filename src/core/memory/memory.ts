// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export interface MemoryEntry {
  question: string
  answer: string
}

export interface Memory {
  add(entry: MemoryEntry): void
  query(question: string): MemoryEntry[]
}