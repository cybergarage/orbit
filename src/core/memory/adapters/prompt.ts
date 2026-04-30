// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../../message/index.js'
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

  query(_question: string): Message[] {
    return this.entries.flatMap((entry) => [...entry.getQuestions(), entry.getAnswer()])
  }
}
