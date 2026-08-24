// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {AsyncLocalStorage} from 'node:async_hooks'

import type {LogCorrelation} from './records.js'

const logContext = new AsyncLocalStorage<LogCorrelation>()

export function getLogContext(): LogCorrelation {
  return {...logContext.getStore()}
}

export function runWithLogContext<T>(correlation: LogCorrelation, operation: () => T): T {
  return logContext.run({...logContext.getStore(), ...correlation}, operation)
}
