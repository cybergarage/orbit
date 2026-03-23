// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export interface Dialogue {
  answer: string
  question: string
}

export interface Memory {
  add(entry: Dialogue): void
  query(question: string): Dialogue[]
}
