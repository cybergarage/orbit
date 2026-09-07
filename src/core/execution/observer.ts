// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {LogFields, Logger, LogLevel, LogMethod} from '../logger/index.js'

/** Operational logging is optional; journal acknowledgements use a different path. */
export function isolateLogger(logger: Logger, failed: () => void): Logger {
  const method =
    (level: LogLevel): LogMethod =>
    (fields: Error | LogFields | string, message?: string) => {
      try {
        const result = typeof fields === 'string' ? logger[level](fields) : logger[level](fields, message)
        Promise.resolve(result).catch(failed)
      } catch {
        failed()
      }
    }

  return {
    child(bindings) {
      try {
        return isolateLogger(logger.child(bindings), failed)
      } catch {
        failed()
        return isolateLogger(logger, failed)
      }
    },
    debug: method('debug'),
    error: method('error'),
    fatal: method('fatal'),
    info: method('info'),
    isDebugEnabled() {
      try {
        return logger.isDebugEnabled()
      } catch {
        failed()
        return false
      }
    },
    setDebugEnabled(enabled) {
      try {
        logger.setDebugEnabled(enabled)
      } catch {
        failed()
      }
    },
    trace: method('trace'),
    warn: method('warn'),
  }
}
