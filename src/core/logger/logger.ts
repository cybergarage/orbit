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
  isDebugEnabled(): boolean
  setDebugEnabled(enabled: boolean): void
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

export function createCompositeLogger(loggers: Logger[]): Logger {
  if (loggers.length === 0) return createNoopLogger()
  if (loggers.length === 1) return loggers[0]
  return new CompositeLogger(loggers)
}

class CompositeLogger implements Logger {
  constructor(private readonly loggers: Logger[]) {}

  get debug(): LogMethod {
    return this.method('debug')
  }

  get error(): LogMethod {
    return this.method('error')
  }

  get fatal(): LogMethod {
    return this.method('fatal')
  }

  get info(): LogMethod {
    return this.method('info')
  }

  get trace(): LogMethod {
    return this.method('trace')
  }

  get warn(): LogMethod {
    return this.method('warn')
  }

  child(bindings: LoggerBindings): Logger {
    return new CompositeLogger(this.loggers.map((logger) => logger.child(bindings)))
  }

  isDebugEnabled(): boolean {
    return this.loggers.some((logger) => logger.isDebugEnabled())
  }

  setDebugEnabled(enabled: boolean): void {
    for (const logger of this.loggers) logger.setDebugEnabled(enabled)
  }

  private method(level: LogLevel): LogMethod {
    return ((fieldsOrMessage: Error | LogFields | string, message?: string) => {
      for (const logger of this.loggers) {
        if (typeof fieldsOrMessage === 'string') logger[level](fieldsOrMessage)
        else logger[level](fieldsOrMessage, message)
      }
    }) as LogMethod
  }
}

class PinoLogger implements Logger {
  constructor(
    private readonly logger: pino.Logger,
    private readonly debugController: PinoDebugController = createPinoDebugController(logger.level as LogLevel),
  ) {
    this.debugController.loggers.add(logger)
    logger.level = this.debugController.level
  }

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
    return new PinoLogger(this.logger.child(bindings), this.debugController)
  }

  isDebugEnabled(): boolean {
    return this.debugController.level === 'debug'
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugController.level = enabled ? 'debug' : 'info'
    for (const logger of this.debugController.loggers) {
      logger.level = this.debugController.level
    }
  }
}

interface PinoDebugController {
  level: LogLevel
  loggers: Set<pino.Logger>
}

function createPinoDebugController(level: LogLevel): PinoDebugController {
  return {
    level,
    loggers: new Set(),
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

  isDebugEnabled(): boolean {
    return false
  }

  setDebugEnabled(): void {}
}
