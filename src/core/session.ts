// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export type SessionOptions = Record<string, never>

export class Session {
  constructor(public readonly options: SessionOptions = {}) {}
}
