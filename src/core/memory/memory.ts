// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Prompt} from '../models/prompt.js'

export interface Dialogue {
  answer: Prompt
  questions: Prompt[]
}

export interface Memory {
  add(entry: Dialogue): void
  query(question: string): Dialogue[]
}
