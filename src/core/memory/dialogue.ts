// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Prompt} from '../models/prompt.js'

export class Dialogue {
  constructor(
    public readonly questions: Prompt[],
    public readonly answer: Prompt,
  ) {}

  getAnswer(): Prompt {
    return this.answer
  }

  getQuestions(): Prompt[] {
    return this.questions
  }
}
