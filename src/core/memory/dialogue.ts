// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Prompt} from '../models/prompt.js'

export class Dialogue {
  constructor(
    public readonly answer: Prompt,
    public readonly questions: Prompt[],
  ) {}
}
