// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export interface Tokenizer {
  decode(tokens: number[]): string
  encode(text: string): number[]
}
