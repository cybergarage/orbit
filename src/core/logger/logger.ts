// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {DestinationStream} from 'pino'

import pino from 'pino'

export type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn'
export type LogValue = boolean | Error | LogValue[] | null | number | string | undefined | {[key: string]: LogValue}
export type LogFields = Record<string, LogValue>
export type LoggerBindings = LogFields

export type LogMethod = {
  (message: string): void
  (fields: Error | LogFields, message?: string): void
}

export interface Logger {
  child(bindings: LoggerBindings): Logger
  debug: LogMethod
  error: LogMethod
  fatal: LogMethod
  info: LogMethod
  trace: LogMethod
  warn: LogMethod
}

export interface LoggerOptions {
  bindings?: LoggerBindings
  destination?: DestinationStream
  level?: LogLevel
  name?: string
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const loggerOptions: pino.LoggerOptions = {
    level: options.level ?? 'info',
    ...(options.name === undefined ? {} : {name: options.name}),
    ...(options.bindings === undefined ? {} : {base: options.bindings}),
  }

  return new PinoLogger(
    options.destination === undefined ? pino(loggerOptions) : pino(loggerOptions, options.destination),
  )
}

export function createNoopLogger(): Logger {
  return new NoopLogger()
}

class PinoLogger implements Logger {
  constructor(private readonly logger: pino.Logger) {}

  get debug(): LogMethod {
    return this.logger.debug.bind(this.logger) as LogMethod
  }

  get error(): LogMethod {
    return this.logger.error.bind(this.logger) as LogMethod
  }

  get fatal(): LogMethod {
    return this.logger.fatal.bind(this.logger) as LogMethod
  }

  get info(): LogMethod {
    return this.logger.info.bind(this.logger) as LogMethod
  }

  get trace(): LogMethod {
    return this.logger.trace.bind(this.logger) as LogMethod
  }

  get warn(): LogMethod {
    return this.logger.warn.bind(this.logger) as LogMethod
  }

  child(bindings: LoggerBindings): Logger {
    return new PinoLogger(this.logger.child(bindings))
  }
}

class NoopLogger implements Logger {
  readonly debug: LogMethod = () => {}
  readonly error: LogMethod = () => {}
  readonly fatal: LogMethod = () => {}
  readonly info: LogMethod = () => {}
  readonly trace: LogMethod = () => {}
  readonly warn: LogMethod = () => {}

  child(): Logger {
    return this
  }
}
