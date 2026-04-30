// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'
import type {Dialogue} from './dialogue.js'

export interface Memory {
  add(entry: Dialogue): void
  compact(): void
  query(question: string): Message[]
}
