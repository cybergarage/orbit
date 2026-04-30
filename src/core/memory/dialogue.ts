// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'

import type {Message} from '../message/index.js'

export class Dialogue {
  public readonly createdAt: Date
  public readonly id: string

  constructor(
    public readonly questions: Message[],
    public readonly answer: Message,
  ) {
    this.createdAt = new Date()
    this.id = randomUUID()
  }

  getAnswer(): Message {
    return this.answer
  }

  getCreatedAt(): Date {
    return this.createdAt
  }

  getId(): string {
    return this.id
  }

  getQuestions(): Message[] {
    return this.questions
  }
}
