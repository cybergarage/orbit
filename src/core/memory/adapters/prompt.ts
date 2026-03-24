// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Memory} from '../memory.js'

import {Dialogue} from '../dialogue.js'

export class PromptMemory implements Memory {
  private readonly entries: Dialogue[]

  constructor(entries: Dialogue[] = []) {
    this.entries = [...entries]
  }

  add(entry: Dialogue): void {
    this.entries.push(entry)
  }

  compact(): void {}

  query(_question: string): Dialogue[] {
    return [...this.entries]
  }
}
