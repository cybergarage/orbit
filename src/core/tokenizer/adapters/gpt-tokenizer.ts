// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {decode, encode} from 'gpt-tokenizer'

import type {Tokenizer} from '../tokenizer.js'

export class GptTokenizer implements Tokenizer {
  decode(tokens: number[]): string {
    return decode(tokens)
  }

  encode(text: string): number[] {
    return encode(text)
  }
}
