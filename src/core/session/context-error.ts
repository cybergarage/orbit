// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export class ContextBudgetError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ContextBudgetError'
  }
}
