// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'

import type {Prompt} from '../models/prompt.js'

export class Dialogue {
  public readonly createdAt: Date
  public readonly id: string

  constructor(
    public readonly questions: Prompt[],
    public readonly answer: Prompt,
  ) {
    this.createdAt = new Date()
    this.id = randomUUID()
  }

  getAnswer(): Prompt {
    return this.answer
  }

  getCreatedAt(): Date {
    return this.createdAt
  }

  getId(): string {
    return this.id
  }

  getQuestions(): Prompt[] {
    return this.questions
  }
}
