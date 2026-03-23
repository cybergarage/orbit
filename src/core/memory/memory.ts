// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Dialogue} from './dialogue.js'

export interface Memory {
  add(entry: Dialogue): void
  query(question: string): Dialogue[]
}
